import test from "node:test";
import assert from "node:assert/strict";
import { C2BChunkStream, MarkdownFenceStream, parseC2BChunks, extractPythonBlocks, sha256 } from "../src/index.js";

const CHUNK_A = `# C2B:CHUNK setup
import bpy
# C2B:END
`;

test("case 1: complete chunk is emitted once", () => {
  const chunks = parseC2BChunks(CHUNK_A);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].name, "setup");
  assert.match(chunks[0].code, /import bpy/);
  assert.equal(chunks[0].code.includes("C2B:END"), false);
});

test("case 2: marker split across mutations still parses", () => {
  const s = new C2BChunkStream();
  // marker itself is torn in half mid-stream
  const parts = ["# C2B:CH", "UNK setup\nimport bpy\n# C2B:E", "ND\n"];
  let acc = "";
  let got: string[] = [];
  for (const p of parts) {
    acc += p;
    const r = s.push(acc);
    got = got.concat(r.chunks.map((c) => c.name));
    // a torn marker must never produce a bogus chunk
    assert.ok(!got.includes("CH"));
  }
  const flushed = s.flush();
  const all = got.concat(flushed.chunks.map((c) => c.name));
  assert.deepEqual(all, ["setup"]);
});

test("case 2b: name is never truncated by a partial marker", () => {
  const s = new C2BChunkStream();
  const got = [
    ...s.push("# C2B:CHUNK set").chunks,
    ...s.push("# C2B:CHUNK setup\n").chunks,
    ...s.push("# C2B:CHUNK setup\nimport bpy\n").chunks,
    ...s.push("# C2B:CHUNK setup\nimport bpy\n# C2B:END\n").chunks,
    ...s.flush().chunks,
  ];
  assert.equal(got.length, 1);
  assert.equal(got[0].name, "setup");
  assert.match(got[0].code, /import bpy/);
});

test("case 3: C2B:END inside a python string does not terminate the chunk", () => {
  const text = [
    "# C2B:CHUNK tricky",
    'note = """',
    "# C2B:END",
    '"""',
    "other = '# C2B:END'",
    "import bpy",
    "# C2B:END",
    "",
  ].join("\n");
  const chunks = parseC2BChunks(text);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].name, "tricky");
  assert.match(chunks[0].code, /import bpy/);
  assert.match(chunks[0].code, /# C2B:END/);
});

test("case 4: repeated mutations do not re-emit the same chunk", () => {
  const s = new C2BChunkStream();
  const acc = ["# C2B:CHUNK base\n", "import bpy\n", "# C2B:END\n"];
  let total = 0;
  let text = "";
  for (let i = 0; i < 3; i++) {
    text += acc[i];
    total += s.push(text).chunks.length;
    total += s.push(text).chunks.length; // duplicate mutation
  }
  assert.equal(total, 1, "chunk must be emitted exactly once");
});

test("case 4b: identical code in two chunks is not deduped away", () => {
  const text = "# C2B:CHUNK a\nx=1\n# C2B:END\n# C2B:CHUNK b\nx=1\n# C2B:END\n";
  const chunks = parseC2BChunks(text);
  assert.equal(chunks.length, 2);
  assert.deepEqual(
    chunks.map((c) => c.name),
    ["a", "b"],
  );
});

test("case 5: multiple chunks stream in order with incremental emission", () => {
  const s = new C2BChunkStream();
  const stream = [
    "# C2B:CHUNK setup\nimport bpy\n# C2B:END\n",
    "# C2B:CHUNK base\nbpy.ops.mesh.primitive_cube_add()\n# C2B:END\n",
    "# C2B:CHUNK arms\nbpy.ops.mesh.primitive_cube_add()\n# C2B:END\n",
  ];
  let text = "";
  const emitted: string[] = [];
  for (const part of stream) {
    text += part;
    emitted.push(...s.push(text).chunks.map((c) => c.name));
  }
  // first chunk is available while the rest are still "being generated"
  assert.deepEqual(emitted, ["setup", "base", "arms"]);
  assert.equal(s.flush().chunks.length, 0);
});

test("case 6: regeneration (replaced text) resets the parser", () => {
  const s = new C2BChunkStream();
  let text = "# C2B:CHUNK base\nimport bpy\n# C2B:END\n";
  assert.equal(s.push(text).chunks.length, 1);
  text = "# C2B:CHUNK base\nbpy.ops.mesh.primitive_cube_add(size=2)\n# C2B:END\n";
  const r = s.push(text);
  assert.equal(r.chunks.length, 1, "regenerated chunk is a new chunk");
  assert.match(r.chunks[0].code, /size=2/);
});

test("case 7: generation stopped - incomplete chunk is discarded", () => {
  const s = new C2BChunkStream();
  let text = "# C2B:CHUNK setup\nimport bpy\n# C2B:END\n# C2B:CHUNK cushions\n";
  assert.equal(s.push(text).chunks.length, 1);
  text += "def make_cushion(";
  assert.equal(s.push(text).chunks.length, 0);
  const flushed = s.flush();
  assert.equal(flushed.chunks.length, 0, "incomplete chunk must not execute");
  assert.equal(flushed.insideChunk, true, "pending chunk is reported as incomplete");
});

test("mode metadata is captured", () => {
  const s = new C2BChunkStream();
  const r = s.push("# C2B:MODE PATCH\n# C2B:CHUNK r1\nx=1\n# C2B:END\n");
  assert.equal(r.mode, "PATCH");
});

test("fence parser: emits a block only when the closing fence is complete", () => {
  const s = new MarkdownFenceStream();
  let text = "```python\nimport bpy\n";
  assert.equal(s.push(text).length, 0);
  text += "bpy.ops.mesh.primitive_cube_add()\n```";
  assert.equal(s.push(text).length, 0, "closing fence without newline is not final");
  text += "\n";
  const out = s.push(text);
  assert.equal(out.length, 1);
  assert.match(out[0].code, /primitive_cube_add/);
  assert.equal(s.flush().length, 0);
});

test("fence parser: python blocks only", () => {
  const md = ["Some text", "", "```javascript", "console.log(1)", "```", "", "```python", "import bpy", "```", ""].join("\n");
  const blocks = extractPythonBlocks(md);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /import bpy/);
});

test("hash is stable", () => {
  assert.equal(sha256("abc"), sha256("abc"));
  assert.notEqual(sha256("abc"), sha256("abd"));
});
