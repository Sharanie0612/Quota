// Exercise the production controller with independently ordered settings events
// and native replies. This verifies interaction state, not native mouse input.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict');
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/UsageWidget.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
async function fixture(reduced=true){
 const states=[],effects=[],listeners=new Map(),timers=new Map(),pending=[],calls=[];
 let now=0,nextTimer=0,writes=0,actual=false,options={enabled:true,side:'right'};
 const react={useRef:current=>({current}),useState:initial=>{const i=states.length;states.push(initial);return[initial,value=>{writes++;states[i]=typeof value==='function'?value(states[i]):value;}];},useEffect:effect=>effects.push(effect)};
 const emit=payload=>{actual=payload.expanded;listeners.get('widget-state')?.({payload});};
 const api={getWidgetUsage:async()=>({today:1,total:2}),getWidgetSpeed:async()=>({tasks:[],activeRequests:0}),widgetReady:async()=>emit({expanded:false,...options,reset:true}),setWidgetExpanded:value=>{calls.push(value);emit({expanded:value,...options,reset:false});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};
 const exported={};
 new Function('exports','require','setInterval','clearInterval','setTimeout','clearTimeout','requestAnimationFrame','cancelAnimationFrame','matchMedia','document',source)(exported,name=>{
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name==='../lib/api')return{api,errText:String};
  if(name==='@tauri-apps/api/event')return{listen:async(name,callback)=>{listeners.set(name,callback);return()=>listeners.delete(name);}};
  return{};
 },()=>1,()=>{},(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;},id=>timers.delete(id),fn=>{Promise.resolve().then(fn);return 1;},()=>{},()=>({matches:reduced}),{activeElement:{blur(){}}});
 const root=exported.UsageWidget(),cleanup=effects[0]();await flush();
 return{
  calls,pending,
  snapshot:()=>({expanded:states[0],nativeExpanded:states[1],side:states[2],actual,error:states[5]}),
  enter:async()=>{root.props.onMouseEnter();await flush();},
  escape:async()=>{root.props.onKeyDown({key:'Escape'});await flush();},
  reset:async(patch={})=>{options={...options,...patch};emit({expanded:false,...options,reset:true});await flush();},
  reply:async(error)=>{const next=pending.shift();assert(next,'a native reply must actually be pending');if(error)next.reject(error);else next.resolve();await flush();},
  advance:async(ms)=>{const target=now+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=target;await flush();},
  dispose:()=>{cleanup();return writes;},writes:()=>writes,
 };
}
const collapsed=(f,side='right')=>assert.deepEqual(f.snapshot(),{expanded:false,nativeExpanded:false,side,actual:false,error:''});
async function main(){
 const checks=[];
 for(const [name,patch] of [['disabled',{enabled:false}],['opposite side',{side:'left'}],['same-side position/readiness',{}]]){
  const f=await fixture();await f.enter();assert.equal(f.pending.length,1);await f.reset(patch);collapsed(f,patch.side);await f.reply();collapsed(f,patch.side);assert.deepEqual(f.calls,[true]);
  if(patch.enabled===false){await f.enter();assert.deepEqual(f.calls,[true],'disabled surface ignores queued hover');await f.reset({enabled:true});}
  await f.enter();await f.reply();assert(f.snapshot().expanded&&f.snapshot().nativeExpanded&&f.snapshot().actual);f.dispose();checks.push(name+' reset wins over an older expansion reply; fresh hover works');
 }
 {
  const f=await fixture();await f.enter();await f.reset({side:'left'});await f.enter();await f.reply();assert.equal(f.pending.length,1,'fresh intent waits for the existing operation');await f.reply();assert.deepEqual(f.calls,[true,true]);assert.deepEqual(f.snapshot(),{expanded:true,nativeExpanded:true,side:'left',actual:true,error:''});f.dispose();checks.push('new hover during reset survives the obsolete response');
 }
 {
  const f=await fixture();await f.enter();await f.reset();await f.reply(new Error('obsolete response'));collapsed(f);assert.deepEqual(f.calls,[true]);f.dispose();checks.push('obsolete rejection cannot replace a successful settings reset with an error');
 }
 {
  const f=await fixture();await f.enter();await f.reply();await f.escape();await f.advance(0);assert.deepEqual(f.calls,[true,false]);await f.reset({side:'left'});await f.enter();await f.reply();await f.reply();assert.deepEqual(f.calls,[true,false,true]);assert.deepEqual(f.snapshot(),{expanded:true,nativeExpanded:true,side:'left',actual:true,error:''});f.dispose();checks.push('settings reset also supersedes a pending collapse reply');
 }
 {
  const f=await fixture(false);await f.enter();await f.reply();await f.escape();await f.advance(100);await f.reset({side:'left'});await f.advance(1000);collapsed(f,'left');assert.deepEqual(f.calls,[true],'reset cancels an obsolete animation completion');f.dispose();checks.push('settings reset interrupts the CSS wait without a redundant native resize');
 }
 {
  const f=await fixture();await f.enter();const before=f.dispose();await f.reply();assert.equal(f.writes(),before,'late reply cannot update an unmounted widget');checks.push('unmount ignores a late native response');
 }
 const result={passed:true,kind:'production-controller-independent-settings-events-and-replies',checks};
 if(process.env.QUOTA_WIDGET_STATE_OUTPUT){const out=path.resolve(process.env.QUOTA_WIDGET_STATE_OUTPUT);fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(result,null,2));}
 console.log(checks.map(check=>'PASS '+check).join('\n'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
