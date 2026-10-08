function parseJSON(text) {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(stripped); } catch { throw new Error('AI 没有返回有效方案，请重试。'); }
}
function text(value, cap = 4000) { if (typeof value !== 'string' || !value.trim() || value.length > cap) throw new Error('方案文字不完整或过长。'); return value.trim(); }
function texts(values, max) { if (!Array.isArray(values) || !values.length || values.length > max) throw new Error('方案条目不完整。'); return values.map(v => text(v)); }
function validatePlan(data) {
  if (!Array.isArray(data?.steps) || !data.steps.length || data.steps.length > 8) throw new Error('执行方案需要 1–8 个步骤。');
  return { steps: data.steps.map(s => ({ task: text(s.task), acceptance: texts(s.acceptance, 10) })) };
}
function validateLesson(data) {
  if (!Array.isArray(data?.stages) || !data.stages.length || data.stages.length > 12) throw new Error('教案环节不完整。');
  const stages = data.stages.map(s => { if (!Number.isInteger(s.minutes) || s.minutes < 1 || s.minutes > 40) throw new Error('环节时间无效。');
    return { title: text(s.title, 120), minutes: s.minutes, activity: text(s.activity), question: text(s.question) }; });
  if (stages.reduce((sum, s) => sum + s.minutes, 0) !== 40) throw new Error('环节总时长应为40分钟，请重新生成。');
  if (!Array.isArray(data.sourceQuotes) || data.sourceQuotes.length > 30) throw new Error('引用记录无效。');
  return { title: text(data.title, 160), objectives: texts(data.objectives, 10), stages, sourceQuotes: data.sourceQuotes.map(q => text(q)), reviewNotes: texts(data.reviewNotes, 20) };
}
function validateRobot(data) {
  const color = data?.color || [0.16, 0.55, 0.72], scale = data?.scale ?? 1;
  if (!Array.isArray(color) || color.length !== 3 || color.some(c => !Number.isFinite(c) || c < 0 || c > 1) || !Number.isFinite(scale) || scale < .25 || scale > 3) throw new Error('配色或尺寸无效，请重试。');
  return { color, scale };
}
module.exports = { parseJSON, validatePlan, validateLesson, validateRobot };
