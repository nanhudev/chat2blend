import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve(import.meta.dirname,'..');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'c2b-asset-'));
const bin=process.env.BLENDER_BIN || (process.platform==='win32'?'G:/blender.exe':'blender');
const child=spawnSync(bin,['--background','--factory-startup','--python-exit-code','1','--python',path.join(root,'tests/blender/asset_contract.py'),'--',root,output],{encoding:'utf8',timeout:180000,maxBuffer:10*1024*1024});
if(child.error || child.status!==0 || !child.stdout.includes('C2B_ASSET_CONTRACT_PASS')){console.error(child.error?.message || child.stdout.slice(-5000)+'\n'+child.stderr.slice(-3000));process.exit(1);}
const report=JSON.parse(fs.readFileSync(path.join(output,'asset.json'),'utf8'));
if(process.env.C2B_ASSET_ARTIFACTS){const dest=path.resolve(process.env.C2B_ASSET_ARTIFACTS);fs.mkdirSync(dest,{recursive:true});fs.cpSync(output,dest,{recursive:true});}
console.log(JSON.stringify({recipe:report.recipe,blender:report.blender,parts:report.parts.length,bones:report.bones.length,checks:report.checks,artifacts:output},null,2));
