/* Renderer has no Node access. All user text is rendered as textContent. */
const $ = id => document.getElementById(id);
let state, result, busy = false;
const examples = {
 agent:{type:'plan',data:{steps:[{task:'梳理当前项目的登录流程和错误提示',acceptance:['识别现有入口与失败场景','不修改业务数据']},{task:'改善首次使用引导并验证',acceptance:['新用户能找到入口','保留错误后的重试路径']}]}},
 teacher:{type:'lesson',data:{title:'《师说》：论证与师道',objectives:['找出文章中心论点，并用原文说明','比较古今学习情境，提出自己的论证'],stages:[{title:'情境导入',minutes:5,activity:'提出“谁可以成为老师”，学生写下判断理由。',question:'判断老师的依据是什么？'},{title:'文本研读',minutes:15,activity:'小组寻找论点与证据，教师核对原文。',question:'作者如何支持“无贵无贱”？'},{title:'讨论与表达',minutes:15,activity:'根据真实学习情境写短论证，互相指出证据不足。',question:'怎样让观点得到证据支持？'},{title:'出口评价',minutes:5,activity:'写下论点、一条证据与仍有疑问的问题。',question:'今天哪条证据改变了你的判断？'}],sourceQuotes:[],reviewNotes:['这是固定示例，未调用 AI。','请教师对照教材版本和学生学情复核。']}},
 blender:{type:'robot',data:{color:[0.16,0.55,0.72],scale:1}}
};
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function status(text,error=false){$('progress').textContent=text;$('progress').style.color=error?'#a04332':'';}
async function action(method,payload){return window.desktop.call(method,payload);}
async function task(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){status(e.message,true);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
function showResult(value,sample=false){result=value;$('empty').hidden=true;$('result-content').replaceChildren();$('result-badge').textContent=sample?'固定示例 · 未调用 AI':'已生成 · 请审阅';$('result-actions').hidden=sample;$('execute').hidden=value.type!=='plan';$('ppt').hidden=value.type!=='lesson';
 const add=(title,lines)=>{const c=node('div',undefined,'card');c.append(node('h3',title));for(const line of lines)c.append(node('p',line));$('result-content').append(c);};
 if(value.type==='plan'){value.data.steps.forEach((s,i)=>add(`${i+1}. ${s.task}`,s.acceptance.map(a=>'验收：'+a)));add('执行前确认',['选择的项目文件将被修改。请检查以上步骤，并保留项目版本。执行器结束后仍需审查实际改动与测试。']);}
 if(value.type==='lesson'){add(value.data.title,value.data.objectives);value.data.stages.forEach(s=>add(`${s.title} · ${s.minutes}分钟`,[s.activity,'关键问题：'+s.question]));add('引文与教师复核',[...value.data.sourceQuotes,...value.data.reviewNotes]);}
 if(value.type==='robot')add('机械机器人方案',['配色：'+value.data.color.map(c=>Math.round(c*255)).join(' / '),'尺寸：'+value.data.scale+' 倍','可继续生成真实资产；固定示例也可以直接生成。']);
 if(value.type==='asset'){add('资产已导出',Object.entries(value.data.checks).map(([k,v])=>(v?'✓ ':'× ')+({"separate_parts": "独立部件检查", "uv_nonempty": "UV 已展开", "uv_in_bounds": "UV 在有效范围内", "all_vertices_weighted": "全部顶点已绑定", "rig_moves_geometry": "骨骼能够驱动模型", "texture_files": "贴图文件完整"}[k]||k)));add('保存与使用',[value.directory,'robot.blend：在 Blender 中编辑；robot.glb：导入支持 glTF 的引擎或查看器。','19 个独立部件、15 根骨骼和挥手动作；材质含基础色、粗糙度和法线贴图。','机械刚性绑定；法线贴图为平面切线法线，不包含高模烘焙细节。']);}
 if(value.type==='execution')add('执行结束，等待验收',[`步骤：${value.data.steps} · 用时：${Math.round(value.data.elapsedMs/1000)}秒`,value.data.acceptance]);
 status(sample?'示例仅供了解流程；点击生成方案才会请求 AI。':'成果已准备好，请审阅。');}
async function refresh(){state=await action('status');$('account').textContent=state.account.connected?`${state.account.email || '已登录'} · ${state.account.sharing?'已授权套餐使用，实际可用性以生成结果为准':'尚未授权套餐使用'}`:'尚未登录。使用官方授权页，应用不会索取你的密码。';$('login').hidden=state.account.connected;$('logout').hidden=!state.account.connected;$('output').textContent=state.outputDir;$('workspace').textContent=state.workingDir||'请先选择项目文件夹。执行会修改其中的文件，请先保留版本记录。';$('blender-location').textContent=state.blenderPath||'未找到 Blender，请选择已安装的程序。';}
async function loadModels(){const models=await action('models');$('model').replaceChildren(...models.map(m=>{const o=node('option',m.name||m.slug);o.value=m.slug;return o;}));if(!models.length)throw new Error('账户未返回可用模型，请检查授权与额度。');}
async function init(){await refresh();const p=state.product;$('app-name').textContent=p.name;$('headline').textContent=p.headline;$('description').textContent=p.description;$('tagline').textContent=p.tagline;$('category').textContent=p.category;$('prompt').value=p.prompt;document.title=p.name;$('source-wrap').hidden=p.kind!=='teacher';$('workspace-row').hidden=p.kind!=='agent';$('blender-row').hidden=p.kind!=='blender';$('robot-controls').hidden=p.kind!=='blender';if(state.account.sharing)try{await loadModels();}catch(e){status(e.message,true);}}
$('login').onclick=()=>task(async()=>{status('已打开官方授权页，请在浏览器完成登录后返回。');await action('signIn');await refresh();await loadModels();status('登录已完成，可以创建任务。');});
$('logout').onclick=()=>task(async()=>{await action('logout');await refresh();$('model').replaceChildren(node('option','登录后选择'));status('已退出登录。');});
$('usage').onclick=()=>task(()=>action('usage'));
$('directory').onclick=()=>task(async()=>{await action('directory','output');await refresh();});
$('workspace-pick').onclick=()=>task(async()=>{await action('directory','workspace');await refresh();});
$('blender-pick').onclick=()=>task(async()=>{await action('blender');await refresh();});
$('open-output').onclick=()=>task(()=>action('openOutput'));
$('sample').onclick=()=>showResult(examples[state.product.kind],true);
$('generate').onclick=()=>task(async()=>{if(!$('model').value)throw new Error('请先使用 ChatGPT 登录并选择模型。');const source=$('source').value;showResult(await action('generate',{model:$('model').value,input:$('prompt').value+(source?'\n教材原文：\n'+source:''),source}));});
$('build').onclick=()=>task(async()=>{const c=$('color').value;const color=[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)/255);showResult(await action('buildRobot',result?.type==='robot'?result.data:{color,scale:Number($('scale').value)}));});
$('execute').onclick=()=>task(async()=>{if(!confirm('将按审阅的步骤修改所选项目文件。你已保留版本，并确认执行这些步骤吗？'))return;showResult(await action('execute',$('model').value));});
$('ppt').onclick=()=>task(async()=>{const file=await action('exportPpt');if(file)status('课件已保存：'+file);});
$('save').onclick=()=>task(async()=>status('结果已保存：'+await action('save')));
window.desktop.onProgress(p=>status(p.stage==='thinking'?'AI 正在整理方案…':p.text));
init().catch(e=>status(e.message,true));
