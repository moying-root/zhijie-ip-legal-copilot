const publicDemo=!!globalThis.location?.hostname?.endsWith('.github.io');
const backendState={online:false,aiConfigured:false,model:null,mode:'rules',busy:false,chatBusy:false,sessionId:null,messages:[],question:'',questions:[],resultMode:null,reviewedAt:null,error:'',revision:0};
async function apiRequest(route,body){
 const response=await fetch(route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(75000)});
 let value;try{value=await response.json()}catch{throw Error('当前服务未提供后端接口，请使用 node server.cjs 启动新版服务。')}
 if(!response.ok)throw Error(value.error?.message||'请求失败，请重试。');return value;
}
async function checkBackend(){if(publicDemo){backendState.online=false;backendState.aiConfigured=false;render();return}try{const h=await apiRequest('/api/health');backendState.online=!!h.ok;backendState.aiConfigured=h.aiConfigured;backendState.model=h.model;backendState.error=''}catch{backendState.online=false;backendState.aiConfigured=false}render()}
function resetBackendContext(){backendState.revision++;backendState.sessionId=null;backendState.messages=[];backendState.questions=[];backendState.question='';backendState.resultMode=null;backendState.reviewedAt=null;backendState.error=''}
function backendPanel(){return `<section class="panel backend-panel"><div class="panel-head"><h2>审查服务 <span class="badge ${backendState.online?'':'amber'}">${backendState.online?'后端已连接':publicDemo?'公开演示版':'浏览器模式'}</span></h2>${isAdmin?'<button class="link" id="backend-config">系统状态</button>':''}</div><div class="pad"><div class="toolbar"><label for="review-mode">审查方式</label><select id="review-mode" ${backendState.busy?'disabled':''}><option value="rules" ${backendState.mode==='rules'?'selected':''}>规则审查</option><option value="ai" ${backendState.mode==='ai'?'selected':''} ${!backendState.aiConfigured?'disabled':''}>AI 语义审查${!backendState.aiConfigured?'（待配置模型）':''}</option></select><span class="count">${backendState.aiConfigured?'模型：'+esc(backendState.model):(publicDemo?'AI 暂未开放，可使用浏览器规则审查':'未配置模型，可正常使用规则审查')}</span><button class="link" id="refresh-backend">刷新连接</button></div><p class="count">${backendState.mode==='ai'?'AI 审查会将合同、适用规则及提供的法律摘要发送至服务端配置的模型服务。':'规则审查使用当前启用规则。后端已连接时在服务端处理；离线时在浏览器处理。'} 合同及对话不写入磁盘。</p>${backendState.error?`<div class="notice backend-error" role="alert">${esc(backendState.error)}</div>`:''}${backendState.resultMode?`<div class="badge">本次结果：${backendState.resultMode==='ai'?'AI 语义审查':'关键词规则审查'} · ${esc(backendState.reviewedAt||'')}</div>`:''}</div></section>`}
function chatPanel(){return `<section class="panel chat-panel"><div class="panel-head"><h2>合同追问与条款改写</h2><span class="badge">${backendState.sessionId?'当前 AI 审查会话':'先运行 AI 审查'}</span></div><div class="pad">${backendState.questions.length?`<div class="quote">需要补充的事实：<ul>${backendState.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul></div>`:''}<div class="chat-history" role="log" aria-live="polite">${backendState.messages.map(m=>`<div class="chat-message ${m.role==='user'?'from-user':''}"><strong>${m.role==='user'?'你':'知界'}</strong><div>${esc(m.content)}</div>${m.sourceIds?.length?`<div class="item-bottom">${m.sourceIds.map(id=>`<button class="link" data-source="${esc(id)}">${esc(E.sources.find(s=>s.id===id)?.title||id)} ↗</button>`).join('')}</div>`:''}</div>`).join('')||'<p>完成 AI 审查后，可继续追问风险、补充事实或要求改写条款。切换合同、立场、场景或规则会清空当前会话。</p>'}${backendState.chatBusy?'<p role="status">知界正在回复…</p>':''}</div><form id="chat-form"><label class="count" for="chat-input">例如：我们是乙方，请保留通用组件复用权，并改写成果归属条款。</label><textarea id="chat-input" maxlength="4000" ${!backendState.sessionId||backendState.chatBusy?'disabled':''} placeholder="输入追问或条款改写要求…">${esc(backendState.question)}</textarea><div class="editor-foot"><span class="count">仅限当前合同会话 · 闲置 30 分钟后失效</span><button class="primary" ${!backendState.sessionId||backendState.chatBusy?'disabled':''}>${backendState.chatBusy?'回复中…':'发送追问 →'}</button></div></form></div></section>`}
async function runBackendReview(){
 if(backendState.busy)return;if(!state.text.trim())return toast('请先输入合同文本');if(state.text.length>60000)return toast('请将合同控制在 60000 字以内');
 resetBackendContext();state.results=null;const revision=backendState.revision;backendState.busy=true;render();
 try{
  let result;
  if(backendState.online)result=await apiRequest('/api/review',{mode:backendState.mode,contract:state.text,role:state.role,scenario:state.scenario,rules});
  else if(backendState.mode==='rules')result={mode:'rules',findings:E.review(state.text,state.scenario,state.role,rules),sessionId:null,questions:[],reviewedAt:new Date().toISOString()};
  else throw Error('后端未连接，请启动服务后重试。');
  if(revision!==backendState.revision)return;
  state.results=result.findings;backendState.resultMode=result.mode;backendState.reviewedAt=result.reviewedAt;backendState.sessionId=result.sessionId;backendState.questions=result.questions;
  toast(result.mode==='ai'?'AI 审查完成，请核验依据与建议':'规则审查完成，请逐项复核');
 }catch(e){if(revision===backendState.revision){backendState.error=e.name==='TimeoutError'?'请求超时，请重试。':e.message;toast('审查未完成，请查看服务提示')}}finally{backendState.busy=false;render()}
}
async function sendChat(e){
 e.preventDefault();if(!backendState.sessionId||backendState.chatBusy||!backendState.question.trim())return;
 const message=backendState.question,revision=backendState.revision;backendState.chatBusy=true;backendState.error='';render();
 try{const answer=await apiRequest('/api/chat',{sessionId:backendState.sessionId,message});if(revision!==backendState.revision)return;backendState.messages.push({role:'user',content:message},{role:'assistant',content:answer.answer,sourceIds:answer.sourceIds});backendState.question=''}catch(e){if(revision===backendState.revision)backendState.error=e.name==='TimeoutError'?'回复超时，请重试。':e.message}finally{backendState.chatBusy=false;render()}
}
function bindBackend(){
 if($('#run')){$('#run').onclick=runBackendReview;$('#run').disabled=backendState.busy;$('#run').textContent=backendState.busy?'正在审查…':backendState.mode==='ai'?'开始 AI 审查 →':'开始规则审查 →'}
 if($('#contract'))$('#contract').readOnly=backendState.busy;
 if($('#scenario'))$('#scenario').disabled=backendState.busy;
 document.querySelectorAll('[data-role],#sample,#file').forEach(x=>x.disabled=backendState.busy);
 if($('#review-mode'))$('#review-mode').onchange=e=>{backendState.mode=e.target.value;invalidate();render()};
 if($('#refresh-backend'))$('#refresh-backend').onclick=checkBackend;
 if($('#backend-config'))$('#backend-config').onclick=()=>showSystem();
 if($('#chat-input'))$('#chat-input').oninput=e=>{backendState.question=e.target.value};if($('#chat-form'))$('#chat-form').onsubmit=sendChat;
}
document.addEventListener('DOMContentLoaded',checkBackend);
