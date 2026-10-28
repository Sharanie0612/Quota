import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { Button, Notice } from '../components/ui';
import { IconCheck } from '../components/icons';
import { errText } from '../lib/api';
import appIcon from '../../src-tauri/icons/128x128.png';
import './setup.css';

type Step='welcome'|'location'|'review'|'installing'|'finish';
interface Info {version:string;target:string;previousVersion:string|null;payloadBytes:number}
interface Progress {phase:string;message:string;done:boolean;error:string|null}
const steps:Step[]=['welcome','location','review','installing','finish'];
const englishPhases:Record<string,string>={preparing:'Checking the installation environment…',copying:'Extracting and copying application files…',finishing:'Creating shortcuts and registering Quota…',done:'Verifying installed files…',installing:'Installing application files…'};
function englishError(error:string){
  if(/正在运行|托盘退出/.test(error))return 'Quit Quota from the system tray, then retry.';
  if(/校验/.test(error))return 'The installed files could not be verified. Retry installation.';
  if(/文件夹|本机磁盘|安装位置无效/.test(error))return 'Choose a full installation folder on a local drive.';
  if(/升级会继续/.test(error))return 'An upgrade keeps the existing installation folder.';
  if(/超时/.test(error))return 'Installation timed out. Check the destination and retry.';
  return 'Setup could not complete. Retry or reopen the installer.';
}
const strings={
  zh:{brand:'Quota 安装向导',titles:['欢迎使用 Quota 安装向导','选择安装位置','准备安装','正在安装 Quota','安装完成'],descriptions:['此向导将引导您完成 Quota 的安装。','选择目标文件夹及需要创建的快捷方式。','确认以下设置，点击“安装”开始。','正在将 Quota 安装到您的计算机，请稍候。','Quota 已成功安装到您的计算机。'],welcome:'将安装以下版本：',data:'升级将保留您的账户、设置与用量记录。',welcomeNext:'点击“下一步”继续。',language:'语言',next:'下一步 >',back:'< 上一步',path:'目标文件夹',browse:'浏览…',upgrade:'检测到现有版本，将在原位置升级。',desktop:'创建桌面快捷方式',menu:'创建开始菜单快捷方式',version:'安装版本',previous:'已安装版本',install:'安装',retry:'重试',launch:'运行 Quota',done:'完成',cancel:'取消',scope:'Windows x64',check:'安装文件已校验',checking:'正在读取安装信息…',error:'安装未完成',size:'所需空间',close:'关闭安装器',minimize:'最小化安装器'},
  en:{brand:'Quota Setup',titles:['Welcome to the Quota Setup Wizard','Select Destination Location','Ready to Install','Installing Quota','Completing the Quota Setup Wizard'],descriptions:['This wizard will guide you through installing Quota.','Choose the destination folder and shortcuts.','Review your settings, then click Install to continue.','Please wait while Setup installs Quota on your computer.','Quota has been installed on your computer.'],welcome:'The following version will be installed:',data:'Your accounts, settings and usage records are retained during upgrades.',welcomeNext:'Click Next to continue.',language:'Language',next:'Next >',back:'< Back',path:'Destination folder',browse:'Browse…',upgrade:'An existing installation was found. Its location will be retained.',desktop:'Create a desktop shortcut',menu:'Create a Start menu shortcut',version:'New version',previous:'Installed version',install:'Install',retry:'Retry',launch:'Launch Quota',done:'Finish',cancel:'Cancel',scope:'Windows x64',check:'Installed files verified',checking:'Reading installation details…',error:'Installation incomplete',size:'Space required',close:'Close setup',minimize:'Minimize setup'},
};
export function SetupView(){
  const [language,setLanguage]=useState<'zh'|'en'>('zh');const text=strings[language];
  const [step,setStep]=useState<Step>('welcome'),[info,setInfo]=useState<Info|null>(null);
  const [target,setTarget]=useState(''),[desktop,setDesktop]=useState(true),[menu,setMenu]=useState(true),[launch,setLaunch]=useState(true);
  const [progress,setProgress]=useState<Progress|null>(null),[error,setError]=useState('');
  const busy=step==='installing',index=steps.indexOf(step);
  useEffect(()=>{if(info)void invoke('setup_ready',{phase:step}).catch(()=>undefined);},[info,step]);
  useEffect(()=>{let live=true;void invoke<Info>('setup_info').then(info=>{if(live){setInfo(info);setTarget(info.target);}}).catch(error=>{if(live)setError(errText(error));});
    const un=listen<Progress>('setup-progress',event=>{if(live){setProgress(event.payload);if(event.payload.done)setStep('finish');if(event.payload.error){setError(event.payload.error);setStep('review');}}});return()=>{live=false;void un.then(fn=>fn());};},[]);
  useEffect(()=>{if(!busy)return;const timer=window.setInterval(()=>{void invoke<Progress>('setup_status').then(progress=>{setProgress(progress);if(progress.done)setStep('finish');if(progress.error){setError(progress.error);setStep('review');}}).catch(()=>undefined);},700);return()=>clearInterval(timer);},[busy]);
  const close=()=>void getCurrentWindow().close().catch(error=>setError(errText(error)));
  const browse=async()=>{try{const path=await open({directory:true,multiple:false,defaultPath:target,title:text.path});if(typeof path==='string')setTarget(path);}catch(error){setError(errText(error));}};
  const install=async()=>{setError('');setProgress(null);setStep('installing');try{await invoke('setup_install',{request:{target,desktopShortcut:desktop,startMenu:menu}});}catch(error){setError(errText(error));setStep('review');}};
  const finish=async()=>{try{await invoke('setup_finish',{launch});}catch(error){setError(errText(error));}};
  return <div className="setup-app" data-setup-step={step}>
    <header className="setup-titlebar" data-tauri-drag-region><span><img src={appIcon} alt=""/>{text.brand}</span><div className="setup-window-actions"><button aria-label={text.minimize} onClick={()=>void getCurrentWindow().minimize()}>−</button><button aria-label={text.close} disabled={busy} onClick={close}>×</button></div></header>
    <div className="setup-page-header"><div><h1>{text.titles[index]}</h1><p>{text.descriptions[index]}</p></div><img src={appIcon} alt="Quota"/></div>
    <main className="setup-content">
      {!info&&!error?<p role="status">{text.checking}</p>:<>
      {step==='welcome'&&<section className="setup-welcome"><p>{text.welcome}</p><div className="setup-version"><img src={appIcon} alt=""/><div><b>Quota {info?.version}</b><span>{text.scope}</span></div></div><p>{text.data}</p><p>{text.welcomeNext}</p><label className="setup-language">{text.language}<select className="select" aria-label="安装语言" value={language} onChange={event=>setLanguage(event.target.value as 'zh'|'en')}><option value="zh">简体中文</option><option value="en">English</option></select></label></section>}
      {step==='location'&&<section><label className="setup-path-label">{text.path}<div><input className="input" aria-label={text.path} value={target} readOnly={!!info?.previousVersion} onChange={event=>setTarget(event.target.value)}/><Button disabled={!!info?.previousVersion} onClick={()=>void browse()}>{text.browse}</Button></div></label>{info?.previousVersion&&<p>{text.upgrade}</p>}<div className="setup-options"><label><input type="checkbox" checked={desktop} onChange={event=>setDesktop(event.target.checked)}/>{text.desktop}</label><label><input type="checkbox" checked={menu} onChange={event=>setMenu(event.target.checked)}/>{text.menu}</label></div><p className="setup-size">{text.size}：{Math.ceil((info?.payloadBytes??0)/1024/1024)} MB</p></section>}
      {step==='review'&&<section><dl className="setup-review"><div><dt>{text.version}</dt><dd>Quota {info?.version}</dd></div>{info?.previousVersion&&<div><dt>{text.previous}</dt><dd>{info.previousVersion}</dd></div>}<div><dt>{text.path}</dt><dd>{target}</dd></div><div><dt>{language==='zh'?'快捷方式':'Shortcuts'}</dt><dd>{[desktop?text.desktop:'',menu?text.menu:''].filter(Boolean).join(' / ')||'—'}</dd></div></dl><p>{text.data}</p></section>}
      {busy&&<section className="setup-installing"><p className="setup-progress-message" role="status">{language==='en'?(englishPhases[progress?.phase??'']??text.checking):(progress?.message||text.checking)}</p><div className="setup-progress-track" role="progressbar" aria-label={text.titles[index]}><span/></div><p className="setup-progress-path">{target}</p></section>}
      {step==='finish'&&<section className="setup-finished"><div className="setup-verified"><IconCheck size={23}/><span>{text.check}</span></div><p>{text.data}</p><label><input type="checkbox" checked={launch} onChange={event=>setLaunch(event.target.checked)}/>{text.launch}</label></section>}
      </>}{error&&<Notice tone="error"><b>{text.error}</b><p>{language==='en'?englishError(error):error}</p></Notice>}
    </main>
    <footer className="setup-footer"><span>Quota {info?.version??''}</span><div>{step!=='finish'&&<Button disabled={busy||step==='welcome'} onClick={()=>setStep(steps[index-1])}>{text.back}</Button>}{step==='welcome'&&<Button variant="primary" disabled={!info} onClick={()=>setStep('location')}>{text.next}</Button>}{step==='location'&&<Button variant="primary" disabled={!/^[A-Za-z]:[\\/].+/.test(target)} onClick={()=>setStep('review')}>{text.next}</Button>}{step==='review'&&<Button variant="primary" disabled={!info} onClick={()=>void install()}>{error?text.retry:text.install}</Button>}{busy&&<Button variant="primary" disabled>{text.install}</Button>}{step==='finish'?<Button variant="primary" onClick={()=>void finish()}>{text.done}</Button>:<Button disabled={busy} onClick={close}>{text.cancel}</Button>}</div></footer>
  </div>;
}
