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
 const taskManager=options.intelTasks;const store=options.store;
 function requireAdmin(req){const secret=process.env.INTEL_ADMIN_TOKEN||'',value=req.headers['x-intel-admin-token'];if(secret.length<16)throw new AppError(503,'ADMIN_NOT_CONFIGURED','管理员口令尚未配置');if(typeof value!=='string'||Buffer.byteLength(value)!==Buffer.byteLength(secret)||!require('node:crypto').timingSafeEqual(Buffer.from(value),Buffer.from(secret)))throw new AppError(403,'ADMIN_REQUIRED','管理员口令不正确');}

 const model=options.modelClient||createModel(options),sessions=new Map();let active=0,windowStart=Date.now(),requests=0;
 const publicUrl=options.publicOrigin?new URL(options.publicOrigin):null;
 if(publicUrl&&(publicUrl.protocol!=='https:'||publicUrl.pathname!=='/'||publicUrl.username||publicUrl.password||publicUrl.search||publicUrl.hash))throw new Error('PUBLIC_ORIGIN 必须为无路径的 HTTPS 站点地址');
 const quotaDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const previousQuota=store?store.read('ai-quota',{day:quotaDate(),calls:0}):{day:quotaDate(),calls:0};let quotaDay=previousQuota.day,aiCalls=previousQuota.calls;
 const dailyLimit=Number(options.dailyAiLimit===undefined?100:options.dailyAiLimit);
 if(!Number.isInteger(dailyLimit)||dailyLimit<0)throw new Error('DAILY_AI_LIMIT 必须是非负整数');
 function reserveAiCall(){const day=quotaDate();if(day!==quotaDay){quotaDay=day;aiCalls=0}if(aiCalls>=dailyLimit)throw new AppError(429,'DAILY_LIMIT','今日 AI 调用额度已用完，请明日再试。');aiCalls++;if(store)store.write('ai-quota',{day:quotaDay,calls:aiCalls})}

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
    if(req.method==='GET'&&url.pathname==='/api/rules')return json(res,200,store?store.read('rules',{revision:0,rules:E.defaults}):{revision:0,rules:E.defaults});
    if(req.method==='PUT'&&url.pathname==='/api/rules'){
     requireAdmin(req);if(!store)throw new AppError(503,'STORAGE_UNAVAILABLE','后端存储尚未启用');const body=await readJSON(req);
     context({contract:'校验',role:'中立',scenario:'AI 大模型',rules:body.rules});const old=store.read('rules',{revision:0,rules:E.defaults});if(body.revision!==old.revision)throw new AppError(409,'RULES_CONFLICT','规则已被其他管理员更新，请先重新读取后端版本');
     return json(res,200,store.write('rules',{rules:body.rules,revision:old.revision+1,updatedAt:new Date().toISOString()}));
    }
    if(req.method==='GET'&&url.pathname==='/api/system')return json(res,200,{version:'1.1.0',modelConfigured:model.configured,provider:model.provider,model:model.model,adminConfigured:(process.env.INTEL_ADMIN_TOKEN||'').length>=16,schedule:taskManager?taskManager.status():null,storage:store?'服务端数据目录':'未启用',persistentStorageConfirmed:process.env.DATA_PERSISTENT==='true',singleInstanceRequired:true,contractStorage:'合同和对话仅在会话内存中，不写入文件',sourceCoverage:'知识产权局政务栏目、最高人民法院公开页面；仅覆盖栏目可见链接'});
    if(req.method==='POST'&&url.pathname==='/api/restore'){
     requireAdmin(req);if(!store||!options.intelDataFile)throw new AppError(503,'STORAGE_UNAVAILABLE','存储尚未启用');if(taskManager?.status().running)throw new AppError(409,'TASK_RUNNING','采集运行中，请完成后再恢复备份');
     const body=await readJSON(req);if(body.version!==1||!body.rules||!body.intel||!Array.isArray(body.intel.items)||body.intel.items.length>500)throw new AppError(400,'INVALID_BACKUP','备份格式无效');
     context({contract:'校验',role:'中立',scenario:'AI 大模型',rules:body.rules.rules});
     const official=u=>{try{const v=new URL(u);return v.protocol==='https:'&&['www.cnipa.gov.cn','ipc.court.gov.cn','www.court.gov.cn'].includes(v.hostname)&&!v.username&&!v.password&&!v.port}catch{return false}};
     if(!body.intel.items.every(i=>i&&official(i.url)&&['法律法规','司法案例','政策动态','行业新闻'].includes(i.type)&&['id','title','summary','impact','agency','discoveredAt','reviewStatus'].every(k=>typeof i[k]==='string'&&i[k].length<4000)))throw new AppError(400,'INVALID_BACKUP','情报字段或来源不合法');
     const old=store.read('rules',{revision:0});store.write('rules',{rules:body.rules.rules,revision:old.revision+1,updatedAt:new Date().toISOString()});
     const intel={updatedAt:typeof body.intel.updatedAt==='string'?body.intel.updatedAt:null,items:body.intel.items,seen:body.intel.items.map(i=>i.url),status:[]};
     const tmp=options.intelDataFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(intel));fs.renameSync(tmp,options.intelDataFile);
     return json(res,200,{ok:true,message:'规则和情报已恢复；运行记录不覆盖'});
    }
    if(req.method==='GET'&&url.pathname==='/api/backup'){
     requireAdmin(req);if(!store)throw new AppError(503,'STORAGE_UNAVAILABLE','存储尚未启用');let intel={items:[],status:[],seen:[]};if(options.intelDataFile&&fs.existsSync(options.intelDataFile))intel=JSON.parse(fs.readFileSync(options.intelDataFile));
     return json(res,200,{version:1,exportedAt:new Date().toISOString(),rules:store.read('rules',{rules:E.defaults,revision:0}),intel,tasks:taskManager?.status().history||[]});
    }
    if(req.method==='PUT'&&url.pathname==='/api/intel/settings'){
     requireAdmin(req);if(!taskManager?.configure)throw new AppError(503,'INTEL_NOT_CONFIGURED','采集管理尚未启用');const body=await readJSON(req);try{return json(res,200,taskManager.configure(body))}catch(e){throw new AppError(e.status||500,'INVALID_SETTINGS',e.message)}
    }
    if(req.method==='GET'&&url.pathname==='/api/intel/tasks')return json(res,200,taskManager?taskManager.status():{enabled:false,adminConfigured:false,running:false,history:[]});
    if(req.method==='POST'&&url.pathname==='/api/intel/collect'){
     const secret=process.env.INTEL_ADMIN_TOKEN||'';const actual=req.headers['x-intel-admin-token']||'';
     if(!taskManager||secret.length<16)throw new AppError(503,'INTEL_NOT_CONFIGURED','管理员采集尚未配置。');
     if(typeof actual!=='string'||Buffer.byteLength(actual)!==Buffer.byteLength(secret)||!require('node:crypto').timingSafeEqual(Buffer.from(actual),Buffer.from(secret)))throw new AppError(403,'ADMIN_REQUIRED','管理员口令不正确。');
     try{return json(res,202,taskManager.start('manual'))}catch(e){throw new AppError(e.status||500,'INTEL_TASK_ERROR',e.message)}
    }
    if(req.method==='GET'&&url.pathname==='/api/intel'){const data=JSON.parse(fs.readFileSync(options.intelDataFile&&fs.existsSync(options.intelDataFile)?options.intelDataFile:path.join(__dirname,'dist/intel.json'),'utf8'));return json(res,200,{updatedAt:data.updatedAt,status:data.status,items:data.items})}
    if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,version:'1.1.0',aiConfigured:model.configured,model:model.model,provider:model.provider||null,sessionTtlMinutes:30,limits:{contractChars:60000},storage:'会话仅保存在服务内存，重启或闲置30分钟后失效'});
    if(req.method!=='POST'||!['/api/review','/api/chat','/api/draft'].includes(url.pathname))throw new AppError(404,'NOT_FOUND','接口不存在。');
    if(Date.now()-windowStart>60000){windowStart=Date.now();requests=0}if(++requests>60)throw new AppError(429,'RATE_LIMIT','请求过于频繁，请一分钟后重试。');
    if(active>=4)throw new AppError(429,'BUSY','服务正在处理其他请求，请稍后重试。');active++;counted=true;
    const body=await readJSON(req);if(store&&body.rules===undefined&&['/api/review','/api/draft'].includes(url.pathname))body.rules=store.read('rules',{rules:E.defaults}).rules;expire();
    if(url.pathname==='/api/draft'){
     if(typeof body.requirements!=='string'||body.requirements.trim().length<5||body.requirements.length>12000)throw new AppError(400,'INVALID_INPUT','请填写5至12000字的合作事实与起草要求');
     const ctx=context({contract:body.requirements,role:body.role,scenario:body.scenario,rules:body.rules});if(model.configured)reserveAiCall();
     const answer=await model.call('chat',{...ctx,history:[],message:'请依据合作事实起草可直接协商的知识产权合同条款。覆盖背景知识产权、成果归属、许可范围、数据授权、侵权责任、交付与退出。未明确事实以【待补充】标记，不编造商业条件，最后列出待确认事项。合作事实：'+body.requirements});
     return json(res,200,{...answer,generatedAt:new Date().toISOString()});
    }
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
   const assets={'/':'index.html','/admin':'index.html','/admin/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/backend.js':'backend.js','/system.js':'system.js','/engine.js':'engine.js'};
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
 const port=Number(process.env.PORT||4173);const publicOrigin=process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL||'';const dir=process.env.INTEL_DATA_DIR||path.join(__dirname,'data');fs.mkdirSync(dir,{recursive:true});if(!fs.existsSync(path.join(dir,'intel.json')))fs.copyFileSync(path.join(__dirname,'dist/intel.json'),path.join(dir,'intel.json'));const intelTasks=require('./server/intel-tasks.cjs').createIntelTasks({dir,secret:process.env.INTEL_ADMIN_TOKEN||'',enabled:process.env.INTEL_AUTO_ENABLED==='true'});const server=createApp({...modelConfigFromEnv(process.env),publicOrigin,dailyAiLimit:process.env.DAILY_AI_LIMIT,intelTasks,store:require('./server/store.cjs').createStore(dir),intelDataFile:path.join(dir,'intel.json')});server.on('close',()=>intelTasks.close());
 server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已被占用，请停止旧服务或在 .env 中修改 PORT。`:'后端启动失败。');process.exitCode=1});
 server.listen(port,process.env.HOST||(publicOrigin?'0.0.0.0':'127.0.0.1'),()=>console.log(`知界后端已启动：${publicOrigin||'http://127.0.0.1:'+port}\n模型密钥仅从服务端环境读取；未配置时仍支持规则审查。`));
}
module.exports={createApp,context};
