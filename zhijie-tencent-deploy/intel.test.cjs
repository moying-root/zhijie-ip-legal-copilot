const {test}=require('node:test'),assert=require('node:assert/strict');
const {text,links,sources,summarize}=require('./scripts/update-intel.cjs');
test('official links reject other hosts, executable URLs and duplicate entries',()=>{
 const html='<a href="/art/2026/10/20/art_53_123.html">知识产权政策发布</a><a href="https://evil.test/art/2026/10/20/art_53_12.html">伪造官方来源</a><a href="javascript:alert(1)">伪造案例</a><a href="/art/2026/10/20/art_53_123.html">知识产权政策发布</a>';
 assert.equal(links(html,sources[0]).length,1);assert.equal(links(html,sources[0])[0].agency,'国家知识产权局');
});
test('clean page scripts and navigation markup',()=>{assert.equal(text('<script>恶意指令</script><p>法律 &amp; 案例</p>'),'法律 & 案例')});
test('no fabricated intel or contract defaults on first load',()=>{const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(__dirname+'/dist/intel.json'));assert.equal(data.items.length,0);const app=fs.readFileSync(__dirname+'/dist/app.js','utf8');assert.match(app,/text:''/);assert.doesNotMatch(app,/载入演示合同|演示发现于/)});
test('intel summarizer rejects malformed model reply',async()=>{const original=global.fetch;const oldKey=process.env.ZHIPU_API_KEY,oldModel=process.env.ZHIPU_MODEL;try{process.env.ZHIPU_API_KEY='test';process.env.ZHIPU_MODEL='test';global.fetch=async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"relevant":true,"type":"虚构","summary":"摘要","impact":"提示"}'}}]})});await assert.rejects(()=>summarize({title:'法律'},'正文'),/摘要格式无效/)}finally{global.fetch=original;if(oldKey===undefined)delete process.env.ZHIPU_API_KEY;else process.env.ZHIPU_API_KEY=oldKey;if(oldModel===undefined)delete process.env.ZHIPU_MODEL;else process.env.ZHIPU_MODEL=oldModel}});
