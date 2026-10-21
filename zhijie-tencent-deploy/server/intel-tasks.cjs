'use strict';
const fs=require('node:fs'),path=require('node:path'),{fork}=require('node:child_process');
function createIntelTasks({dir,secret='',enabled=false,hour=8,spawn=fork,now=()=>new Date()}={}){
 fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'tasks.json');let history=[];try{history=JSON.parse(fs.readFileSync(file));if(!Array.isArray(history))history=[]}catch{}
 for(const t of history)if(t.state==='running'){t.state='interrupted';t.message='服务重启，任务已中断';t.finishedAt=now().toISOString()}
 const settingsFile=path.join(dir,'settings.json');let aiEnabled=process.env.INTEL_AI_ENABLED==='true';let maxArticles=Number(process.env.INTEL_MAX_ARTICLES||8);try{const settings=JSON.parse(fs.readFileSync(settingsFile));enabled=settings.enabled===true;aiEnabled=settings.aiEnabled===true;if(Number.isInteger(settings.hour)&&settings.hour>=0&&settings.hour<24)hour=settings.hour;if(Number.isInteger(settings.maxArticles)&&settings.maxArticles>=1&&settings.maxArticles<=30)maxArticles=settings.maxArticles}catch{}
 let active=null,child=null,timer,watchdog;
 function save(){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(history.slice(0,30)));fs.renameSync(tmp,file)}save();
 const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
 function status(){return {enabled,hour,maxArticles,aiEnabled,timeZone:'Asia/Shanghai',adminConfigured:secret.length>=16,running:!!active,history:history.slice(0,30)}}
 function start(trigger='manual'){
  if(active)throw Object.assign(Error('已有采集任务运行中'),{status:409});
  const today=day();if(history.filter(t=>t.day===today).length>=3)throw Object.assign(Error('今日采集任务已达3次，请明日再试'),{status:429});
  if(trigger==='manual'&&history[0]&&now()-new Date(history[0].startedAt)<600000)throw Object.assign(Error('请在上次任务开始10分钟后再采集'),{status:429});
  active={id:require('node:crypto').randomUUID(),day:today,trigger,state:'running',startedAt:now().toISOString(),message:'正在读取官方来源',progress:null};history.unshift(active);save();
  const task=active;
  function finish(state,message){if(task.state!=='running')return;clearTimeout(watchdog);task.state=state;task.message=message;task.finishedAt=now().toISOString();active=null;child=null;save()}
  try{child=spawn(path.join(__dirname,'../scripts/update-intel.cjs'),[],{env:{...process.env,INTEL_DATA_FILE:path.join(dir,'intel.json'),INTEL_MAX_ARTICLES:String(maxArticles),INTEL_AI_ENABLED:String(aiEnabled)},stdio:['ignore','ignore','ignore','ipc']});
   child.on('message',m=>{if(m&&m.type==='progress'&&typeof m.message==='string'){task.message=m.message.slice(0,300);task.progress={processed:Number(m.processed)||0,modelCalls:Number(m.modelCalls)||0,newItems:Number(m.newItems)||0};save()}});
   child.on('error',()=>finish('failed','采集进程启动失败，请查看服务配置'));
   watchdog=setTimeout(()=>{const worker=child;finish('failed','采集超过20分钟，已终止，请检查来源网络');worker?.kill()},20*60*1000);watchdog.unref();
   child.on('exit',code=>finish(code===0?'completed':code===2?'partial':'failed',code===0?'采集完成，已保存官方资讯':code===2?'已保存可用资讯，部分正文或来源待重试':'官方来源暂不可达，请查看来源状态'));
  }catch{finish('failed','采集进程启动失败')}
  return task;
 }
 function tick(){const h=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(now()));if(enabled&&h>=hour&&!history.some(t=>t.day===day()&&t.trigger==='scheduled')){try{start('scheduled')}catch{}}}
 timer=setInterval(tick,60000);timer.unref();
 return {status,start,tick,configure(v){if(typeof v.enabled!=='boolean'||!Number.isInteger(v.hour)||v.hour<0||v.hour>23||!Number.isInteger(v.maxArticles)||v.maxArticles<1||v.maxArticles>30)throw Object.assign(Error('请提供有效开关、0至23小时和1至30篇上限'),{status:400});enabled=v.enabled;hour=v.hour;maxArticles=v.maxArticles;if(typeof v.aiEnabled==='boolean')aiEnabled=v.aiEnabled;fs.writeFileSync(settingsFile+'.tmp',JSON.stringify({enabled,hour,maxArticles,aiEnabled}));fs.renameSync(settingsFile+'.tmp',settingsFile);return status()},close(){clearInterval(timer);clearTimeout(watchdog);if(child)child.kill()}};
}
module.exports={createIntelTasks};
