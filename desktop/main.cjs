const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createAuth } = require('./auth.cjs');
const product = require('./product.json');
if (process.env.DESKTOP_TEST_DATA) app.setPath('userData', process.env.DESKTOP_TEST_DATA);
const { validatePlan, validateLesson, validateRobot, parseJSON } = require('./contracts.cjs');
let win, auth, activeChild, outputDir, workingDir, blenderPath, lastResult, plan, building = false;
const runtime = app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.join(__dirname, 'runtime');
function event(data) { if (win && !win.isDestroyed()) win.webContents.send('progress', data); }
function prefsFile() { return path.join(app.getPath('userData'), 'preferences.json'); }
function savePrefs() { fs.writeFileSync(prefsFile(), JSON.stringify({ outputDir, workingDir, blenderPath }), { mode: 0o600 }); }
function discoverBlender() {
  const candidates = process.platform === 'darwin' ? ['/Applications/Blender.app/Contents/MacOS/Blender'] :
    process.platform === 'win32' ? ['G:/blender.exe', 'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe', 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe'] : ['/usr/bin/blender'];
  return candidates.find(p => fs.existsSync(p)) || '';
}
async function pickDirectory(kind) {
  const result = await dialog.showOpenDialog(win, { title: kind === 'workspace' ? '选择你的项目文件夹' : '选择成果保存位置', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled) return null;
  if (kind === 'workspace') workingDir = result.filePaths[0]; else outputDir = result.filePaths[0];
  savePrefs(); return result.filePaths[0];
}
function runProcess(bin, args, options = {}) {
  if (activeChild) throw new Error('已有任务正在运行，请先等待完成。');
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: options.cwd || outputDir, env: { ...process.env, ...options.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    activeChild = child; let stdout = '', stderr = '', settled = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('任务超时，请检查后重试。')); }, options.timeout || 180000);
    function finish(error, value) { if (settled) return; settled = true; clearTimeout(timer); activeChild = null; error ? reject(error) : resolve(value); }
    child.on('error', () => finish(new Error('启动失败，请检查程序位置。')));
    child.stdout.on('data', part => { const text = part.toString(); stdout = (stdout + text).slice(-200000); /* Raw process output stays in the main process; it may contain secrets. */ });
    child.stderr.on('data', part => { stderr = (stderr + part.toString()).slice(-10000); });
    child.on('close', code => finish(code !== 0 ? new Error(`执行未完成 (${code})。${(options.env?.ACCESS_TOKEN ? stderr.split(options.env.ACCESS_TOKEN).join('[REDACTED]') : stderr).slice(-600)}`) : null, { stdout, stderr, code }));
    if (options.stdin) child.stdin.end(options.stdin); else child.stdin.end();
  });
}
async function generate(payload) {
  if (activeChild) throw new Error('已有任务正在执行。');
  const instructions = product.kind === 'agent' ?
    'Return JSON only: {"steps":[{"task":"one focused implementation step","acceptance":["observable acceptance criteria"]}]}. Max 8 steps. No commands, no credentials. The user will review before execution.' :
    product.kind === 'teacher' ?
      '你是语文教研助手。仅输出JSON：{"title":"课程名","objectives":["可评价目标"],"stages":[{"title":"环节","minutes":10,"activity":"具体师生活动","question":"关键问题"}],"sourceQuotes":["只逐字引用用户提供的教材原文，未提供时空数组"],"reviewNotes":["来源和教师需复核项"]}。环节总时长40分钟。不要编造教材引文、课程标准出处或实际用户效果。' :
      'Return JSON only for an articulated robot recipe: {"color":[0.16,0.55,0.72],"scale":1}. Color components 0..1, scale .25..3. Design the requested palette and size; only this hard-surface robot recipe is currently supported.';
  event({ stage: 'thinking', text: 'AI 正在整理你的任务…' });
  const result = await auth.generate({ model: payload.model, input: payload.input, instructions }, delta => event({ stage: 'thinking', text: delta }));
  const data = parseJSON(result.text);
  if (product.kind === 'agent') { plan = validatePlan(data); lastResult = { type: 'plan', data: plan, usage: result.usage }; }
  if (product.kind === 'teacher') {
    const lesson = validateLesson(data);
    const source = String(payload.source || '').replace(/\s/g, '');
    if (lesson.sourceQuotes.some(q => !source.includes(q.replace(/\s/g, '')))) throw new Error('AI 引文未能在提供的原文中找到，请补充原文或重新生成。');
    lastResult = { type: 'lesson', data: lesson, usage: result.usage };
  }
  if (product.kind === 'blender') { lastResult = { type: 'robot', data: validateRobot(data), usage: result.usage }; }
  return lastResult;
}
async function buildRobot(options) {
  if (building) throw new Error('资产正在生成，请等待完成。');
  if (!blenderPath || !fs.existsSync(blenderPath)) throw new Error('请先选择已安装的 Blender。');
  if (!outputDir) throw new Error('请先选择成果保存位置。');
  const destination = path.join(outputDir, 'Chat2Blend-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(destination, { recursive: true });
  const config = path.join(destination, 'build.json');
  fs.writeFileSync(config, JSON.stringify({ output: destination, options: validateRobot(options || {}) }));
  building = true;
  const child = spawn(blenderPath, ['--factory-startup', '--python', path.join(runtime, 'scripts', 'build-asset.py'), '--', config], { windowsHide: false, stdio: 'ignore' });
  // Blender stays visible and editable. Completion comes from the written manifest, not process exit.
  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = () => { if (!finished) { finished = true; building = false; clearInterval(poll); clearTimeout(timer); reject(new Error('Blender 未完成资产生成，请检查窗口中的错误。')); } };
    const poll = setInterval(() => {
      const manifest = path.join(destination, 'asset.json');
      if (!fs.existsSync(manifest)) return;
      try {
        const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (!Object.values(data.checks).every(Boolean)) return fail();
        if (!fs.existsSync(path.join(destination, 'robot.glb'))) return;
        finished = true; building = false; clearInterval(poll); clearTimeout(timer);
        lastResult = { type: 'asset', data, directory: destination }; resolve(lastResult);
      } catch { /* Manifest may be in the middle of an atomic completion. */ }
    }, 500);
    const timer = setTimeout(fail, 120000);
    child.on('error', fail); child.on('exit', fail);
    event({ stage: 'building', text: '已打开 Blender：部件 → UV → 贴图 → 骨骼 → 动作 → 导出' });
  });
}
async function executePlan(model) {
  if (!plan || !workingDir) throw new Error('请先选择项目，生成并审阅执行步骤。');
  const core = require(path.join(runtime, 'agent-core.cjs'));
  const record = core.createRunRecord({ runId: 'desktop-' + Date.now(), pairId: 'desktop-oauth-codex', goal: 'Desktop reviewed plan',
    context: { id: workingDir, root: workingDir, source: 'user' } });
  const store = new core.RunStore(path.join(app.getPath('userData'), 'runs'));
  const started = Date.now();
  try {
    for (const [index, step] of plan.steps.entries()) {
      event({ stage: 'executing', text: `正在执行 ${index + 1}/${plan.steps.length}：${step.task}` });
      const token = await auth.accessToken();
      const task = `${step.task}\nAcceptance:\n${step.acceptance.join('\n')}\nExecute only this step. Run relevant tests and report their output.`;
      const outcome = await runProcess(process.execPath, [path.join(runtime, 'openai', 'codex', 'bin', 'codex.js'), 'exec', '--json', '--cd', workingDir,
        '--sandbox', 'workspace-write', '--model', model,
        '-c', 'model_provider="openai_chatgpt_plan"', '-c', 'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
        '-c', 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
        '-c', 'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
        '-c', 'model_providers.openai_chatgpt_plan.wire_api="responses"',
        '-c', 'model_providers.openai_chatgpt_plan.requires_openai_auth=false',
        '-c', 'model_providers.openai_chatgpt_plan.supports_websockets=false', '-'],
      { cwd: workingDir, env: { ELECTRON_RUN_AS_NODE: '1', ACCESS_TOKEN: token }, stdin: task, timeout: 600000 });
      const events = outcome.stdout.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      if (events.some(e => e.type === 'error' || e.type === 'turn.failed') || !events.some(e => e.type === 'turn.completed')) throw new Error('执行器没有完成这一轮，请查看进度记录。');
      record.metrics.harnessRuns++; record.metrics.harnessInstruction.bytes += Buffer.byteLength(task);
      record.receipts.push({ receiptId: 'step-' + index, runId: record.runId, iteration: index, status: 'success', exitStatus: '0', changedFiles: [], tests: null,
        testsPassed: null, commands: [], errors: [], summary: 'Codex process completed; acceptance requires review.', durationMs: Date.now() - started, at: new Date().toISOString() });
    }
    record.status = 'done'; record.finishedAt = new Date().toISOString(); record.metrics.elapsedMs = Date.now() - started;
    store.save(record); lastResult = { type: 'execution', data: { runId: record.runId, steps: record.metrics.harnessRuns, elapsedMs: record.metrics.elapsedMs,
      acceptance: '请查看项目改动和测试结果，确认是否达到验收条件。' } }; return lastResult;
  } catch (error) { record.status = 'error'; record.finishedAt = new Date().toISOString(); record.error = error.message.slice(0, 600); store.save(record); throw error; }
}
async function exportLesson() {
  if (lastResult?.type !== 'lesson') throw new Error('请先生成教案。');
  const result = await dialog.showSaveDialog(win, { defaultPath: path.join(outputDir, 'lesson.pptx'), filters: [{ name: 'PowerPoint', extensions: ['pptx'] }] });
  if (result.canceled) return null;
  const PptxGenJS = require('pptxgenjs'); const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; pptx.author = 'AI Teacher Coach'; pptx.subject = '请教师复核后使用';
  const lesson = lastResult.data;
  const pages = [{ title: lesson.title, text: lesson.objectives.join('\n') }, ...lesson.stages.map(s => ({ title: `${s.title} · ${s.minutes}分钟`, text: `${s.activity}\n\n关键问题：${s.question}` })),
    { title: '原文与复核', text: [...lesson.sourceQuotes, ...lesson.reviewNotes].join('\n') }];
  for (const p of pages) { const slide = pptx.addSlide(); slide.background = { color: 'F3F5F1' };
    slide.addText(p.title, { x: 0.7, y: 0.5, w: 12, h: 1, fontSize: 28, color: '164C3B', bold: true, fontFace: 'Microsoft YaHei' });
    slide.addText(p.text, { x: 0.7, y: 1.8, w: 11.8, h: 4.8, fontSize: 19, color: '243B32', breakLine: false, fit: 'shrink', fontFace: 'Microsoft YaHei' }); }
  await pptx.writeFile({ fileName: result.filePath });
  return result.filePath;
}
app.whenReady().then(async () => {
  app.setName(product.name);
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  outputDir = path.join(app.getPath('documents'), product.name); fs.mkdirSync(outputDir, { recursive: true });
  try { const saved = JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); outputDir = saved.outputDir || outputDir; workingDir = saved.workingDir; blenderPath = saved.blenderPath; } catch {}
  blenderPath ||= discoverBlender();
  auth = createAuth({ dir: path.join(app.getPath('userData'), 'chatgpt'), name: product.name, secure: safeStorage, openExternal: url => shell.openExternal(url) });
  win = new BrowserWindow({ width: 1240, height: 880, minWidth: 820, minHeight: 650, backgroundColor: '#F5F4F0', title: product.name,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ipcMain.handle('action', async (ipcEvent, method, payload) => {
    if (ipcEvent.sender !== win.webContents || !ipcEvent.senderFrame.url.startsWith('file:')) throw new Error('Invalid caller');
    try {
      let value;
      switch (method) {
        case 'status': value = { product, account: auth.session(), outputDir, workingDir, blenderPath }; break;
        case 'signIn': value = await auth.signIn(); break;
        case 'logout': value = auth.logout(); break;
        case 'models': value = await auth.models(); break;
        case 'usage': await shell.openExternal('https://chatgpt.com/#settings/Usage'); value = true; break;
        case 'directory': value = await pickDirectory(payload); break;
        case 'blender': { const selected = await dialog.showOpenDialog(win, { title: '选择 Blender 程序', properties: ['openFile'] }); if (!selected.canceled) { blenderPath = selected.filePaths[0]; if (process.platform === 'darwin' && blenderPath.endsWith('.app')) blenderPath = path.join(blenderPath, 'Contents/MacOS/Blender'); savePrefs(); } value = blenderPath; break; }
        case 'generate': value = await generate(payload); break;
        case 'buildRobot': value = await buildRobot(payload); break;
        case 'execute': value = await executePlan(payload); break;
        case 'exportPpt': value = await exportLesson(); break;
        case 'openOutput': value = await shell.openPath(lastResult?.directory || outputDir); break;
        case 'save': { const file = path.join(outputDir, 'result-' + Date.now() + '.json'); if (!lastResult) throw new Error('尚无成果'); fs.writeFileSync(file, JSON.stringify(lastResult, null, 2)); value = file; break; }
        default: throw new Error('未知操作。');
      }
      return { ok: true, value };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  await win.loadFile(path.join(__dirname, 'index.html'));
  if (process.env.DESKTOP_SMOKE_OUT) {
    setTimeout(async () => { fs.writeFileSync(process.env.DESKTOP_SMOKE_OUT, (await win.webContents.capturePage()).toPNG()); app.quit(); }, 2500);
  }
});
app.on('window-all-closed', () => { auth?.cancelLogin(); activeChild?.kill(); app.quit(); });
