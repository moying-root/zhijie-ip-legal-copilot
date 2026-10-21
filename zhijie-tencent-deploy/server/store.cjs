'use strict';
const fs=require('node:fs'),path=require('node:path');
function createStore(dir){fs.mkdirSync(dir,{recursive:true});return {
 read(name,fallback){try{return JSON.parse(fs.readFileSync(path.join(dir,name+'.json'),'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw Error('数据文件无法读取，请恢复备份')}},
 write(name,value){const target=path.join(dir,name+'.json'),tmp=target+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,target);return value}
}}
module.exports={createStore};
