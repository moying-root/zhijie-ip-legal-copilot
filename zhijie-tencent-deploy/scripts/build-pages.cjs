const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),out=path.join(root,'docs');fs.mkdirSync(out,{recursive:true});
for(const name of ['index.html','style.css','engine.js','backend.js','app.js'])fs.copyFileSync(path.join(root,'dist',name),path.join(out,name));
fs.writeFileSync(path.join(out,'.nojekyll'),'');console.log('Public Pages files ready in docs/');
