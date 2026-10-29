// External writer -> packaged reader -> original SQLite ledger. Synthetic data only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {performance}=require('node:perf_hooks');
const mode=process.argv[2],root=path.resolve(process.argv[3]||'');
const workspace=path.resolve(__dirname,'..')+path.sep;
assert(root.startsWith(workspace),'Use a fresh fixture directory inside this workspace');
const data=path.join(root,'data'),home=path.join(root,'codex-home'),file=path.join(home,'sessions/fixture.jsonl');
const envelope=(at,type,payload)=>JSON.stringify({timestamp:new Date(at).toISOString(),type,payload})+'\n';
function response(t,index,output,reasoning,totalOutput,totalReasoning,duration){
 return envelope(t,'response_item',{type:'message',role:'assistant',content:'private-fixture-must-not-be-persisted'})+
 envelope(t+duration,'event_msg',{type:'item_completed',item:{type:'AgentMessage'},started_at_ms:t,completed_at_ms:t+duration})+
 envelope(t+duration+1,'token_usage_record',{response_id:'fixture-'+index,usage:{output_tokens:output,reasoning_output_tokens:reasoning}})+
 envelope(t+duration+2,'event_msg',{type:'token_count',info:{total_token_usage:{input_tokens:1000*index,output_tokens:totalOutput,reasoning_output_tokens:totalReasoning,total_tokens:1000*index+totalOutput}}});
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label,timeout=8000){const start=performance.now();while(performance.now()-start<timeout){if(predicate())return performance.now()-start;await sleep(80);}throw Error('Timeout: '+label);}
async function main(){
 if(mode==='prepare'){
  assert(!fs.existsSync(root),'Use a fresh fixture directory');fs.mkdirSync(path.dirname(file),{recursive:true});fs.mkdirSync(data);
  const write=(name,value)=>fs.writeFileSync(path.join(data,name),JSON.stringify(value));
  write('config.json',{version:1,accounts:[],settings:{autoRefresh:true,ladderAutoUpdate:false,notifyLowBalance:false,closeToTray:false,refreshIntervalMinutes:30,defaultLowThreshold:20,notifyRecharge:false,trayAlert:false}});
  write('activity-settings.json',{deviceId:'00000000-0000-4000-8000-000000000031',deviceName:'Incremental fixture',autoCollect:true,collectIntervalSeconds:900,syncAccounts:false,syncDir:'',codexHome:home,zcodeHome:'',harnessHome:'',traeHome:'',traeEnabled:false,codexSshDevices:[]});
  write('usage-widget.json',{enabled:false,side:'right',heightPercent:50});
  const t=Date.now()-30000;fs.writeFileSync(path.join(root,'clock.json'),JSON.stringify({t}));
  fs.writeFileSync(file,envelope(t,'session_meta',{id:'incremental-native'})+envelope(t+1,'turn_context',{model:'fixture-model'}));return;
 }
 assert.equal(mode,'check');const {t}=JSON.parse(fs.readFileSync(path.join(root,'clock.json')));let db;
 const status=()=>{try{return JSON.parse(fs.readFileSync(path.join(data,'output-speed-live.json')))}catch{return {}}};
 const rows=()=>db.prepare('SELECT body FROM metrics').all().map(row=>JSON.parse(row.body));
 const measured=()=>rows().filter(row=>row.speed);
 try{
  await until(()=>fs.existsSync(path.join(data,'activity.sqlite'))&&status().checkedAt,'reader ready',20000);
  db=new DatabaseSync(path.join(data,'activity.sqlite'),{readOnly:true});await sleep(4000);assert.equal(measured().length,0);
  fs.appendFileSync(file,envelope(t+100,'event_msg',{type:'task_started'}));
  const pendingLatency=await until(()=>status().activeRequests===1,'pending task');assert.equal(measured().length,0);
  const first=response(t+1000,1,240,40,240,40,2000),parts=first.trimEnd().split('\n'),counter=parts.pop();
  fs.appendFileSync(file,parts.join('\n')+'\n');await until(()=>status().lastEventAt===t+3001,'completed timing without usage counter');assert.equal(measured().length,0);
  fs.appendFileSync(file,counter);await sleep(1300);assert.equal(measured().length,0,'partial JSONL must not be consumed');
  fs.appendFileSync(file,'\n');const firstLatency=await until(()=>measured().length===1,'first complete usage');
  fs.appendFileSync(file,response(t+6000,2,110,10,350,50,500));const secondLatency=await until(()=>measured().length===2,'second complete usage');
  fs.appendFileSync(file,envelope(t+10000,'event_msg',{type:'task_complete'}));await until(()=>status().activeRequests===0,'completed task');await sleep(1300);
  for(const delay of [pendingLatency,firstLatency,secondLatency])assert(delay<2300,'new metadata should be visible within a local read cycle');
  const events=rows(),samples=measured();assert.equal(samples.length,2);assert.equal(events.reduce((n,row)=>n+row.tokens.total,0),2350);
  const tokens=samples.reduce((n,row)=>n+row.speed.outputTokens,0),duration=samples.reduce((n,row)=>n+row.speed.durationMs,0);assert.equal(tokens*1000/duration,120);
  assert(!JSON.stringify(events).includes('private-fixture-must-not-be-persisted'));
  const report={passed:true,kind:'packaged-incremental-ingestion',streamingTokensAvailable:false,fullCollectionIntervalSeconds:900,metadataLatencyMs:Math.round(pendingLatency),recordLatenciesMs:[Math.round(firstLatency),Math.round(secondLatency)],pendingDoesNotInventSpeed:true,partialLineRetried:true,tokenTotal:2350,samples:2,weightedAverage:120};
  fs.writeFileSync(path.join(root,'incremental-check.json'),JSON.stringify(report,null,2));console.log('PASS actual new-record ingestion '+report.recordLatenciesMs.join(', ')+' ms; pending/partial records produce no invented speed; 2350 Token, 2 samples, weighted mean 120');
 }finally{db?.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1});
