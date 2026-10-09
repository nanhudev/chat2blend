const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');
const product=require('./product.json');let base,executable,resources;
if(process.platform==='win32'){base=path.join(__dirname,'dist','win-unpacked');executable=path.join(base,product.name+'.exe');resources=path.join(base,'resources');}
else if(process.platform==='darwin'){const folder=fs.readdirSync(path.join(__dirname,'dist')).find(n=>n==='mac-'+process.arch||n==='mac');assert(folder,'Mac application directory must exist');base=path.join(__dirname,'dist',folder,product.name+'.app','Contents');executable=path.join(base,'MacOS',product.name);resources=path.join(base,'Resources');}
else if(process.platform==='linux'){base=path.join(__dirname,'dist','linux-unpacked');executable=path.join(base,require('./package.json').build.linux.executableName);resources=path.join(base,'resources');}
else throw new Error('Unsupported package platform');
if(process.env.DESKTOP_EXECUTABLE){executable=process.env.DESKTOP_EXECUTABLE;base=path.dirname(executable);resources=path.join(base,'resources');}
assert(fs.existsSync(executable),'Packaged executable must exist');
if(product.kind==='agent'){
 const runtime=path.join(resources,'runtime');const native=JSON.parse(fs.readFileSync(path.join(runtime,'native.json')));const bin=path.join(runtime,'codex-native','vendor',native.target,'bin',process.platform==='win32'?'codex.exe':'codex');
 const version=spawnSync(bin,['--version'],{encoding:'utf8',timeout:30000,windowsHide:true});assert.equal(version.status,0,version.stderr);assert(version.stdout.includes('0.161.0'));assert(fs.existsSync(path.join(runtime,'agent-core.cjs')));console.log('Packaged native Codex verified: '+version.stdout.trim());
}
const env={...process.env,DESKTOP_EXECUTABLE:executable};delete env.ELECTRON_RUN_AS_NODE;
const smoke=spawnSync(process.execPath,[path.join(__dirname,'smoke.cjs')],{env,stdio:'inherit',timeout:180000});assert.equal(smoke.status,0,'Packaged UI must pass acceptance');
