const {_electron:electron}=require('@playwright/test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const dir=__dirname;const product=require('./product.json');const evidence=path.resolve(dir,'../docs/assets');fs.mkdirSync(evidence,{recursive:true});
 const env={...process.env,DESKTOP_TEST_DATA:path.join(dir,'test-results','account')};delete env.ELECTRON_RUN_AS_NODE;const errors=[];const application=await electron.launch({executablePath:process.env.DESKTOP_EXECUTABLE || undefined,args:process.env.DESKTOP_EXECUTABLE?[]:[dir],env});
 try{if(process.env.DESKTOP_EXECUTABLE)assert(await application.evaluate(({app})=>app.isPackaged));const page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('#headline').waitFor();await page.locator('#app-name').filter({hasText:product.name}).waitFor();
 assert.equal(await page.evaluate(()=>typeof require),'undefined');assert.equal(await page.evaluate(()=>typeof process),'undefined');
 await page.locator('#generate').click();await page.locator('#progress').filter({hasText:'请先使用 ChatGPT 登录'}).waitFor();
 await page.locator('#sample').click();await page.locator('#result-badge').filter({hasText:'固定示例'}).waitFor();
 if(product.kind==='blender'&&process.env.DESKTOP_ASSET_TEST==='1'){
  await page.locator('#build').click();await page.locator('#result-content').filter({hasText:'资产已导出'}).waitFor({timeout:120000});
  const status=await page.evaluate(()=>window.desktop.call('status'));const dirs=fs.readdirSync(status.outputDir).filter(n=>n.startsWith('Chat2Blend-')).sort();const dest=path.join(status.outputDir,dirs.at(-1));
  const manifest=JSON.parse(fs.readFileSync(path.join(dest,'asset.json')));assert.equal(manifest.parts.length,19);assert.equal(manifest.bones.length,15);assert(Object.values(manifest.checks).every(Boolean));assert(fs.statSync(path.join(dest,'robot.glb')).size>100000);
  fs.writeFileSync(path.join(evidence,'desktop-asset.json'),JSON.stringify({method:'Real visible Electron -> visible Blender -> exported files',directory:dest,checks:manifest.checks,parts:manifest.parts.length,bones:manifest.bones.length,oauthVerified:false},null,2));
 }
 await page.evaluate(()=>document.fonts.ready);
 assert(await page.evaluate(()=>[...document.fonts].some(f=>f.family==='Nanhu Sans'&&f.status==='loaded')),'Bundled Chinese font must load in development and packaged applications');
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const dom=await cdp.send('DOM.getDocument');const headline=await cdp.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#headline'});
 const fonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:headline.nodeId});
 assert(fonts.fonts.some(f=>f.isCustomFont&&f.familyName.includes('Noto Sans SC')&&f.glyphCount>0),'Chinese headline must actually render with the bundled font');
 await page.emulateMedia({reducedMotion:'no-preference'});
 assert.equal(await page.locator('.card').first().evaluate(el=>getComputedStyle(el).animationName),'enter','Card entrance motion must be available');
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('.card').first().evaluate(el=>getComputedStyle(el).animationName),'none','Reduced motion must disable card animation');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
 await page.locator('nav a[href="#settings"]').click();assert.equal(await page.locator('nav a[href="#settings"]').getAttribute('aria-current'),'true');
 for(const width of [820,640]){await page.setViewportSize({width,height:880});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Window must not overflow horizontally');}
 await page.setViewportSize({width:1240,height:880});await page.locator('nav a[href="#task"]').click();await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:path.join(evidence,'desktop.png'),fullPage:true});assert.deepEqual(errors,[]);console.log(JSON.stringify({product:product.name,packaged:Boolean(process.env.DESKTOP_EXECUTABLE),visibleWindow:true,isolatedRenderer:true,sampleLabel:true,loginRequired:true,bundledChineseFont:true,reducedMotion:true,responsive:true,errors}));
 }finally{await application.close();}
})().catch(e=>{console.error(e);process.exit(1);});
