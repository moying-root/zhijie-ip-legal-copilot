const {test}=require('node:test');const assert=require('node:assert/strict');const E=require('./dist/engine.js');
test('FDE includes common and delivery rules, excludes AI',()=>{assert.deepEqual(E.review('开发合同','FDE 驻场开发','甲方',E.defaults).map(x=>x.id),['IP-001','IP-003'])});
test('AI includes data authorization review',()=>{assert.deepEqual(E.review('模型合同','AI 大模型','中立',E.defaults).map(x=>x.id),['IP-001','IP-002'])});
test('party selection changes draft',()=>{assert.notEqual(E.draft(E.defaults[0],'甲方'),E.draft(E.defaults[0],'乙方'));assert.notEqual(E.draft(E.defaults[0],'乙方'),E.draft(E.defaults[0],'中立'))});
test('disabled rules excluded',()=>{assert.equal(E.review('合同','AI 大模型','甲方',E.defaults.map(x=>({...x,enabled:false}))).length,0)});
test('empty text produces no review',()=>assert.equal(E.review(' ','AI 大模型','甲方',E.defaults).length,0));
test('keyword matches still require human review',()=>assert.equal(E.review('成果归属和背景知识产权','委托研发','甲方',E.defaults)[0].status,'待人工确认'));
test('every finding has official traceable source',()=>{for(const r of E.review('合同','AI 大模型','甲方',E.defaults))assert.match(E.sources.find(s=>s.id===r.source).url,/https:\/\/.+\.gov\.cn\//)});
