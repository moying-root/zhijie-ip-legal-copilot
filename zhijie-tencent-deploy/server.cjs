'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const E=require('./dist/engine.js');const {AppError,createModel,modelConfigFromEnv}=require('./server/model.cjs');
const ROLES=['甲方','乙方','中立'],SCENARIOS=['FDE 驻场开发','AI 大模型','委托研发','技术许可'];
function context(body){
 if(!body||typeof body!=='object'||!ROLES.includes(body.role)||!SCENARIOS.includes(body.scenario)||typeof body.contract!=='string'||!body.contract.trim()||body.contract.length>60000)throw new AppError(400,'INVALID_INPUT','请提供有效立场、合作场景和 1–60000 字的合同。');
 let rules=body.rules===undefined?E.defaults:body.rules;
 if(!Array.isArray(rules)||rules.length>100)throw new AppError(400,'INVALID_RULES','规则格式错误或超过 100 条。');
 const ids=new Set();
 rules=rules.map(r=>{
  if(!r||typeof r.id!=='string'||!r.id||r.id.length>100||ids.has(r.id)||typeof r.title!=='string'||!r.title.trim()||r.title.length>300||typeof r.note!=='string'||r.note.length>3000||!['全部',...SCENARIOS].includes(r.scenario)||!['高','中','低'].includes(r.level)||typeof r.enabled!=='boolean'||!E.sources.some(s=>s.id===r.source)||!Array.isArray(r.keywords)||r.keywords.length>30||!r.keywords.every(k=>typeof k==='string'&&k.trim()&&k.length<=100))throw new AppError(400,'INVALID_RULES','审查规则字段无效，请检查名称、来源或关键词。');
  ids.add(r.id);return {id:r.id,title:r.title,note:r.note,scenario:r.scenario,level:r.level,enabled:r.enabled,source:r.source,keywords:r.keywords};
 });
 return {contract:body.contract,role:body.role,scenario:body.scenario,rules:rules.filter(r=>r.enabled&&(r.scenario==='全部'||r.scenario===body.scenario))};
}
async function readJSON(req){if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new AppError(415,'JSON_REQUIRED','请使用 JSON 请求。');let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw new AppError(413,'TOO_LARGE','请求内容超过 1MB。');chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new AppError(400,'INVALID_JSON','请求不是有效的 JSON。')}}
function createApp(options={}){
 const model=options.modelClient||createModel(options),sessions=new Map();let active=0,windowStart=Date.now(),requests=0;
 const publicUrl=options.publicOrigin?new URL(options.publicOrigin):null;
 if(publicUrl&&(publicUrl.protocol!=='https:'||publicUrl.pathname!=='/'||publicUrl.username||publicUrl.password||publicUrl.search||publicUrl.hash))throw new Error('PUBLIC_ORIGIN 必须为无路径的 HTTPS 站点地址');
 let quotaDay=new Date().toISOString().slice(0,10),aiCalls=0;
 const dailyLimit=Number(options.dailyAiLimit===undefined?100:options.dailyAiLimit);
 if(!Number.isInteger(dailyLimit)||dailyLimit<0)throw new Error('DAILY_AI_LIMIT 必须是非负整数');
 function reserveAiCall(){const day=new Date().toISOString().slice(0,10);if(day!==quotaDay){quotaDay=day;aiCalls=0}if(aiCalls>=dailyLimit)throw new AppError(429,'DAILY_LIMIT','今日 AI 演示额度已用完，请明日再试。');aiCalls++}

 const expire=()=>{for(const [id,s]of sessions)if(s.expiresAt<Date.now())sessions.delete(id)};
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  let counted=false;
  try{
   const host=req.headers.host||'';if(host!==publicUrl?.host&&!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))throw new AppError(403,'HOST_FORBIDDEN','仅允许本机访问。');
   const url=new URL(req.url,`http://${host}`);
   if(req.headers.origin&&req.headers.origin!==(host===publicUrl?.host?publicUrl.origin:`http://${host}`))throw new AppError(403,'ORIGIN_FORBIDDEN','不允许跨站调用。');
   if(req.headers['sec-fetch-site']==='cross-site')throw new AppError(403,'ORIGIN_FORBIDDEN','不允许跨站调用。');
   if(url.pathname.startsWith('/api/')){
    if(req.method==='GET'&&url.pathname==='/api/intel'){const data=JSON.parse(fs.readFileSync(path.join(__dirname,'dist/intel.json'),'utf8'));return json(res,200,{updatedAt:data.updatedAt,status:data.status,items:data.items})}
    if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,version:'0.2.0',aiConfigured:model.configured,model:model.model,provider:model.provider||null,sessionTtlMinutes:30,limits:{contractChars:60000},storage:'会话仅保存在服务内存，重启或闲置30分钟后失效'});
    if(req.method!=='POST'||!['/api/review','/api/chat'].includes(url.pathname))throw new AppError(404,'NOT_FOUND','接口不存在。');
    if(Date.now()-windowStart>60000){windowStart=Date.now();requests=0}if(++requests>60)throw new AppError(429,'RATE_LIMIT','请求过于频繁，请一分钟后重试。');
    if(active>=4)throw new AppError(429,'BUSY','服务正在处理其他请求，请稍后重试。');active++;counted=true;
    const body=await readJSON(req);expire();
    if(url.pathname==='/api/review'){
     if(!['rules','ai'].includes(body.mode))throw new AppError(400,'INVALID_MODE','请选择 rules 或 ai 模式。');
     const c=context(body),reviewedAt=new Date().toISOString();
     if(body.mode==='rules')return json(res,200,{mode:'rules',reviewedAt,findings:E.review(c.contract,c.scenario,c.role,c.rules),questions:[],sources:E.sources,sessionId:null});
     if(model.configured)reserveAiCall();
     const result=await model.call('review',c);
     const findings=result.findings.map((f,i)=>({id:`AI-${i+1}`,title:f.title,level:f.level,evidence:f.reason,note:'模型生成 · 请核验事实、引用和建议',draft:f.draft,originalText:f.originalText,sourceIds:f.sourceIds,status:'需法务复核',role:c.role}));
     expire();while(sessions.size>=100)sessions.delete(sessions.keys().next().value);
     const sessionId=randomUUID();sessions.set(sessionId,{...c,findings,history:[],expiresAt:Date.now()+1800000});
     return json(res,200,{mode:'ai',model:model.model,reviewedAt,findings,questions:result.questions,sources:E.sources,sessionId});
    }
    if(typeof body.sessionId!=='string'||typeof body.message!=='string'||!body.message.trim()||body.message.length>4000)throw new AppError(400,'INVALID_MESSAGE','请提供会话编号和 1–4000 字的问题。');
    const session=sessions.get(body.sessionId);if(!session)throw new AppError(410,'SESSION_EXPIRED','会话已失效，请重新运行 AI 审查。');
    if(session.busy)throw new AppError(409,'SESSION_BUSY','上一条问题仍在处理。');session.busy=true;
    try{if(model.configured)reserveAiCall();const answer=await model.call('chat',{contract:session.contract,role:session.role,scenario:session.scenario,rules:session.rules,findings:session.findings,history:session.history,message:body.message});
     session.history.push({role:'user',content:body.message},{role:'assistant',content:answer.answer});session.history=session.history.slice(-20);session.expiresAt=Date.now()+1800000;
     return json(res,200,{...answer,mode:'ai',sessionId:body.sessionId});
    }finally{session.busy=false}
   }
   if(!['GET','HEAD'].includes(req.method))throw new AppError(405,'METHOD_NOT_ALLOWED','不支持该请求方法。');
   const assets={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/backend.js':'backend.js','/engine.js':'engine.js'};
   const name=assets[url.pathname];if(!name)throw new AppError(404,'NOT_FOUND','页面不存在。');
   const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript'}[path.extname(name)];
   const content=await fs.promises.readFile(path.join(__dirname,'dist',name));res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
  }catch(e){if(!res.headersSent)json(res,e instanceof AppError?e.status:500,{error:{code:e instanceof AppError?e.code:'INTERNAL_ERROR',message:e instanceof AppError?e.message:'服务内部错误，请稍后重试。'}});else res.end()}
  finally{if(counted)active--}
 });
 server.requestTimeout=120000;server.headersTimeout=15000;return server;
}
if(require.main===module){
 const envFile=path.join(__dirname,'.env');if(fs.existsSync(envFile))process.loadEnvFile(envFile);
 const port=Number(process.env.PORT||4173);const publicOrigin=process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL||'';const server=createApp({...modelConfigFromEnv(process.env),publicOrigin,dailyAiLimit:process.env.DAILY_AI_LIMIT});
 server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已被占用，请停止旧服务或在 .env 中修改 PORT。`:'后端启动失败。');process.exitCode=1});
 server.listen(port,process.env.HOST||(publicOrigin?'0.0.0.0':'127.0.0.1'),()=>console.log(`知界后端已启动：${publicOrigin||'http://127.0.0.1:'+port}\n模型密钥仅从服务端环境读取；未配置时仍支持规则审查。`));
}
module.exports={createApp,context};
