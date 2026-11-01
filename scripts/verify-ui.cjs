// Keep every verifier's screenshots and evidence; do not overwrite evidence.json.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.env.QUOTA_UI_OUTPUT||path.join(root,'target/ui-checks'));
fs.mkdirSync(output,{recursive:true});const checks=[];
for(const [name,script] of [['materials','verify-material-interface.cjs'],['material-light','verify-material-light.cjs'],['material-optics','verify-material-optics.cjs'],['workbench','verify-usage-workbench.cjs'],['speed-focus','verify-speed-focus.cjs'],['speed-display','verify-speed-display.cjs'],['widget-clock','verify-widget-clock.cjs']]){
  const result=spawnSync(process.execPath,[path.join(__dirname,script)],{cwd:root,env:{...process.env,QUOTA_UI_OUTPUT:path.join(output,name)},stdio:'inherit',windowsHide:true});
  checks.push({name,passed:!result.error&&result.status===0});
  if(result.error||result.status!==0){fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:false,checks},null,2));if(result.error)console.error(result.error);process.exit(result.status||1);}
}
fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,kind:'built-frontend-synthetic-data',checks},null,2));
