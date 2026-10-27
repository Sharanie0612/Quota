import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { Button, Notice } from '../components/ui';
import { IconChart, IconCheck, IconLayers, IconRefresh, IconWallet } from '../components/icons';
import { errText } from '../lib/api';
import appIcon from '../../src-tauri/icons/128x128.png';
import './setup.css';

type Step='welcome'|'location'|'review'|'installing'|'finish';
interface Info {version:string;target:string;previousVersion:string|null;payloadBytes:number}
interface Progress {phase:string;message:string;done:boolean;error:string|null}
const steps:Step[]=['welcome','location','review','installing','finish'];
const englishPhases:Record<string,string>={preparing:'Checking the installation environment',copying:'Extracting and copying Quota files',finishing:'Finishing registration and shortcuts',done:'Verifying installed files',installing:'The installation engine is running'};
function englishError(error:string){
  if(/正在运行|托盘退出/.test(error))return 'Quit Quota from the system tray, then retry. Your accounts and usage are retained.';
  if(/校验/.test(error))return 'The installed files could not be verified. Please retry installation.';
  if(/文件夹|本机磁盘|安装位置无效/.test(error))return 'Choose a full installation folder on a local drive.';
  if(/升级会继续/.test(error))return 'An upgrade keeps the existing installation folder.';
  if(/超时/.test(error))return 'Installation timed out. Check the destination and retry.';
  return 'Setup could not complete. Please retry or reopen the installer.';
}
const strings={
  zh:{brand:'Quota 安装',steps:['欢迎','安装选项','确认安装','正在安装','完成'],title:'你的 AI 用量空间',intro:'账户额度、模型价格和使用记录，在一个地方从容掌握。',language:'安装语言',next:'继续',back:'返回',options:'选择如何安装',path:'安装位置',browse:'浏览…',upgrade:'升级会继续使用现有安装位置，保留账户与本机资料。',desktop:'创建桌面快捷方式',menu:'添加到开始菜单',review:'准备好安装 Quota',version:'安装版本',previous:'当前版本',data:'账户与用量资料将保留。安装过程中不会执行账户或云盘同步。',install:'开始安装',retry:'重试安装',installing:'正在安装 Quota',running:'请稍候。安装引擎正在处理文件，完成后会校验安装结果。',finish:'Quota 已准备就绪',complete:'安装成功。你的工作区已就位。',launch:'完成后打开 Quota',done:'完成',cancel:'取消安装',scope:'Windows 64 位 · 当前用户',check:'安装文件已校验',checking:'正在读取安装信息…',error:'安装未完成',size:'应用文件',close:'关闭安装器'},
  en:{brand:'Quota Setup',steps:['Welcome','Options','Review','Installing','Complete'],title:'Your AI usage, in one place',intro:'A calm workspace for balances, model pricing and usage history.',language:'Installer language',next:'Continue',back:'Back',options:'Choose your installation',path:'Install location',browse:'Browse…',upgrade:'The existing location is retained during upgrade. Your accounts and local data are preserved.',desktop:'Create a desktop shortcut',menu:'Add to the Start menu',review:'Ready to install Quota',version:'New version',previous:'Installed version',data:'Accounts and usage data are preserved. Setup does not run account or cloud synchronization.',install:'Install Quota',retry:'Retry installation',installing:'Installing Quota',running:'The installation engine is working. Setup will verify the installed files before confirming completion.',finish:'Quota is ready',complete:'Installation completed. Your workspace is ready to open.',launch:'Open Quota when setup closes',done:'Finish',cancel:'Cancel setup',scope:'Windows 64-bit · Current user',check:'Installed files verified',checking:'Reading installation details…',error:'Installation incomplete',size:'Application files',close:'Close setup'},
};
export function SetupView(){
  const [language,setLanguage]=useState<'zh'|'en'>('zh');const text=strings[language];
  const [step,setStep]=useState<Step>('welcome');const [info,setInfo]=useState<Info|null>(null);
  const [target,setTarget]=useState('');const [desktop,setDesktop]=useState(true);const [menu,setMenu]=useState(true);const [launch,setLaunch]=useState(true);
  const [progress,setProgress]=useState<Progress|null>(null);const [error,setError]=useState('');
  const busy=step==='installing';const index=steps.indexOf(step);
  useEffect(()=>{if(info)void invoke('setup_ready',{phase:step}).catch(()=>undefined);},[info,step]);
  useEffect(()=>{let live=true;void invoke<Info>('setup_info').then(info=>{if(live){setInfo(info);setTarget(info.target);}}).catch(error=>{if(live)setError(errText(error));});
    const un=listen<Progress>('setup-progress',event=>{if(live){setProgress(event.payload);if(event.payload.done)setStep('finish');if(event.payload.error){setError(event.payload.error);setStep('review');}}});return()=>{live=false;void un.then(fn=>fn());};},[]);
  useEffect(()=>{if(!busy)return;const timer=window.setInterval(()=>{void invoke<Progress>('setup_status').then(progress=>{setProgress(progress);if(progress.done)setStep('finish');if(progress.error){setError(progress.error);setStep('review');}}).catch(()=>undefined);},700);return()=>clearInterval(timer);},[busy]);
  const close=()=>void getCurrentWindow().close().catch(error=>setError(errText(error)));
  const browse=async()=>{try{const path=await open({directory:true,multiple:false,defaultPath:target,title:text.path});if(typeof path==='string')setTarget(path);}catch(error){setError(errText(error));}};
  const install=async()=>{setError('');setProgress(null);setStep('installing');try{await invoke('setup_install',{request:{target,desktopShortcut:desktop,startMenu:menu}});}catch(error){setError(errText(error));setStep('review');}};
  const finish=async()=>{try{await invoke('setup_finish',{launch});}catch(error){setError(errText(error));}};
  return <div className="setup-app">
    <header className="setup-titlebar" data-tauri-drag-region><span><img src={appIcon} alt=""/>{text.brand}</span><div className="setup-window-actions"><button aria-label={language==='zh'?'最小化安装器':'Minimize setup'} onClick={()=>void getCurrentWindow().minimize()}>−</button><button aria-label={text.close} disabled={busy} onClick={close}>×</button></div></header>
    <aside className="setup-sidebar"><div className="setup-brand"><img src={appIcon} alt="Quota"/><b>Quota</b><span>{info?.version??''}</span></div><ol>{steps.map((item,i)=><li key={item} aria-current={step===item?'step':undefined} className={i<index?'complete':step===item?'active':''}><span>{i<index?<IconCheck size={13}/>:i+1}</span>{text.steps[i]}</li>)}</ol><small>{text.scope}</small></aside>
    <main className="setup-content">
      {!info&&!error?<p role="status">{text.checking}</p>:<>
      {step==='welcome'&&<section className="setup-welcome"><span className="setup-eyebrow">WELCOME TO QUOTA</span><h1>{text.title}</h1><p>{text.intro}</p><div className="setup-workspace-preview" aria-hidden="true"><div className="setup-preview-nav"><i/><i/><i/></div><div className="setup-preview-cards"><span><IconWallet size={13}/>{language==='zh'?'账户额度':'Balances'}</span><span><IconLayers size={13}/>{language==='zh'?'官方模型':'Models'}</span><span><IconChart size={13}/>{language==='zh'?'使用趋势':'Usage'}</span><div className="setup-preview-chart">{[25,40,30,60,45,75,50,65,80,60,90,75].map((height,i)=><i key={i} style={{height:height+'%'}}/>)}</div></div></div><label className="setup-language">{text.language}<select className="select" aria-label="安装语言" value={language} onChange={event=>setLanguage(event.target.value as 'zh'|'en')}><option value="zh">简体中文</option><option value="en">English</option></select></label></section>}
      {step==='location'&&<section><span className="setup-eyebrow">INSTALL OPTIONS</span><h1>{text.options}</h1><label className="setup-path-label">{text.path}<div><input className="input" aria-label={text.path} value={target} readOnly={!!info?.previousVersion} onChange={event=>setTarget(event.target.value)}/><Button disabled={!!info?.previousVersion} onClick={()=>void browse()}>{text.browse}</Button></div></label>{info?.previousVersion&&<p className="hint">{text.upgrade}</p>}<div className="setup-options"><label><input type="checkbox" checked={desktop} onChange={event=>setDesktop(event.target.checked)}/>{text.desktop}</label><label><input type="checkbox" checked={menu} onChange={event=>setMenu(event.target.checked)}/>{text.menu}</label></div><p className="setup-size">{text.size} · {Math.ceil((info?.payloadBytes??0)/1024/1024)} MB</p></section>}
      {step==='review'&&<section><span className="setup-eyebrow">READY TO INSTALL</span><h1>{text.review}</h1><dl className="setup-review"><div><dt>{text.version}</dt><dd>{info?.version}</dd></div>{info?.previousVersion&&<div><dt>{text.previous}</dt><dd>{info.previousVersion}</dd></div>}<div><dt>{text.path}</dt><dd>{target}</dd></div><div><dt>{text.desktop}</dt><dd>{desktop?'✓':'—'}</dd></div><div><dt>{text.menu}</dt><dd>{menu?'✓':'—'}</dd></div></dl><p className="setup-data-note">{text.data}</p></section>}
      {busy&&<section className="setup-installing"><div className="setup-stage-icon"><IconRefresh size={30} className="spin"/></div><h1>{text.installing}</h1><p>{text.running}</p><div className="setup-progress-track" role="progressbar" aria-label={text.installing}><span/></div><p className="setup-progress-message" role="status">{language==='en'?(englishPhases[progress?.phase??'']??text.checking):(progress?.message||text.checking)}</p><small>{target}</small></section>}
      {step==='finish'&&<section className="setup-finished"><div className="setup-stage-icon success"><IconCheck size={32}/></div><h1>{text.finish}</h1><p>{text.complete}</p><div className="setup-verified"><IconCheck size={14}/>{text.check}</div><label><input type="checkbox" checked={launch} onChange={event=>setLaunch(event.target.checked)}/>{text.launch}</label></section>}
      </>}{error&&<Notice tone="error"><b>{text.error}</b><p>{language==='en'?englishError(error):error}</p></Notice>}
    </main>
    <footer className="setup-footer"><span>Quota {info?.version??''}</span><div>{!busy&&step!=='finish'&&<Button onClick={step==='welcome'?close:()=>setStep(steps[index-1])}>{step==='welcome'?text.cancel:text.back}</Button>}{step==='welcome'&&<Button variant="primary" disabled={!info} onClick={()=>setStep('location')}>{text.next} →</Button>}{step==='location'&&<Button variant="primary" disabled={!/^[A-Za-z]:[\\/].+/.test(target)} onClick={()=>setStep('review')}>{text.next} →</Button>}{step==='review'&&<Button variant="primary" disabled={!info} onClick={()=>void install()}>{error?text.retry:text.install}</Button>}{step==='finish'&&<Button variant="primary" onClick={()=>void finish()}>{text.done}</Button>}</div></footer>
  </div>;
}
