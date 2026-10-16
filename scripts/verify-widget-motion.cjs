// Run the production component's hover controller with a deterministic clock.
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
const states=[],effects=[],nativeCalls=[],timers=new Map();let now=0,nextTimer=0;
const react={useRef:current=>({current}),useState:initial=>{const i=states.length;states.push(initial);return [initial,value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useEffect:effect=>effects.push(effect)};
const api={setWidgetExpanded:async value=>{nativeCalls.push(value);},getWidgetUsage:async()=>({today:1,total:2}),widgetReady:async()=>{},moveWidget:async()=>{}};
const moduleExports={};
const source=ts.transpileModule(fs.readFileSync('src/components/UsageWidget.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('exports','require','setTimeout','clearTimeout','requestAnimationFrame','cancelAnimationFrame','matchMedia',source)(moduleExports,name=>{
 if(name==='react')return react;
 if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 if(name==='../lib/api')return {api,errText:String};
 if(name==='@tauri-apps/api/event')return {listen:async()=>()=>{}};
 return {};
},(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;},id=>timers.delete(id),fn=>{Promise.resolve().then(fn);return 1;},()=>{},()=>({matches:false}));
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function advance(ms){const target=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=target;await flush();}
async function main(){
 const root=moduleExports.UsageWidget();
 const panel=root.props.children[1];const end=(propertyName='clip-path',child=false)=>{const target={};panel.props.onTransitionEnd({propertyName,target,currentTarget:child?{}:target});};
 root.props.onMouseEnter();await flush();assert.equal(states[0],true);assert.deepEqual(nativeCalls,[true]);
 root.props.onMouseLeave();await advance(130);assert.equal(states[0],false);assert.deepEqual(nativeCalls,[true]);
 root.props.onMouseEnter();assert.equal(states[0],true,'re-enter reverses in the same event, without waiting for the exit');await flush();
 await advance(400);assert.equal(states[0],true);assert.deepEqual(nativeCalls,[true],'interrupted collapse must not shrink or resize again');
 root.props.onMouseLeave();await advance(119);assert.equal(states[0],true);
 await advance(2);assert.equal(states[0],false);assert.deepEqual(nativeCalls,[true]);
 root.props.onMouseLeave();await advance(121);assert.deepEqual(nativeCalls,[true],'duplicate leave/blur must not cut off the fade');
 end('opacity');end('clip-path',true);await flush();assert.deepEqual(nativeCalls,[true],'text fades must not truncate the surface animation');
 await advance(200);assert.deepEqual(nativeCalls,[true]);
 end();await flush();assert.deepEqual(nativeCalls,[true,false],'native clip closes only when the surface finishes');
 root.props.onMouseEnter();await flush();assert.equal(states[0],true);assert.deepEqual(nativeCalls,[true,false,true]);
 end();await flush();assert.equal(states[0],true,'late exit event must not collapse a reopened surface');
 root.props.onMouseLeave();await advance(120+419);assert.deepEqual(nativeCalls,[true,false,true]);
 await advance(2);assert.deepEqual(nativeCalls,[true,false,true,false],'fallback closes a hidden view that receives no transitionend');
 console.log('PASS immediate reversal, debounce, no redundant native resize, actual surface completion, child event isolation, hidden-view fallback, reopen');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
