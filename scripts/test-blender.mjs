#!/usr/bin/env node
// Real Blender executor contract. Synthetic chunks; no model/provider claim.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { parseC2BChunks } = require('../dist/packages/chunk-parser/src/index.js');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'c2b-blender-'));
const chunks = parseC2BChunks(fs.readFileSync(path.join(root, 'examples/sofa_chunks.py'), 'utf8'));
if (chunks.length !== 6) throw new Error('Sofa fixture must contain six parsed chunks');
fs.writeFileSync(path.join(output, 'chunks.json'), JSON.stringify(chunks));
console.log('Testing parser → real Blender executor. Synthetic fixture, no LLM, no bridge transport or GUI.');
const result = spawnSync(process.env.C2B_BLENDER_EXE || 'blender', [
  '--background', '--factory-startup', '--python-exit-code', '1',
  '--python', path.join(root, 'tests/blender/headless_contract.py'), '--', root, output,
], { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
if (result.error || result.status !== 0) {
  console.error(result.error?.message || result.stdout + result.stderr);
  console.error(`Diagnostic artifacts: ${output}`);
  process.exitCode = 1;
} else {
  const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
  if (!report.ok || report.checks.length < 6 || report.checks.some(c => !c.ok)) throw new Error('Incomplete Blender verification');
  console.log(JSON.stringify(report, null, 2));
  console.log(`Artifacts: ${output}`);
  if (process.env.C2B_TEST_ARTIFACTS) {
    fs.mkdirSync(process.env.C2B_TEST_ARTIFACTS, { recursive: true });
    for (const name of ['report.json', 'sofa.blend', 'sofa.png']) {
      fs.copyFileSync(path.join(output, name), path.join(process.env.C2B_TEST_ARTIFACTS, name));
    }
  }
}
