const fs=require('node:fs');const path=require('node:path');
const dir=path.resolve(__dirname,'runtime');fs.mkdirSync(dir,{recursive:true});const root=path.resolve(__dirname,'..');
for(const folder of ['blender_addon','scripts']){const target=path.resolve(dir,folder);if(!target.startsWith(dir+path.sep))throw new Error('Unsafe staging directory');fs.rmSync(target,{recursive:true,force:true});fs.cpSync(path.join(root,folder),target,{recursive:true,filter:p=>!p.includes('__pycache__')});}
