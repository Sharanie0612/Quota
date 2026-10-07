// Import only exact model IDs and explicit release dates; never use ranking prices.
const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
let models;
const find=value=>{if(!value||typeof value!=='object')return; if(Array.isArray(value.initialModels)){models=value.initialModels;return;}for(const child of Object.values(value))find(child);};
for(const match of html.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/gs)) {
  let frame;try{frame=JSON.parse(match[1])[1];}catch{continue;}
  if(typeof frame!=='string')continue;
  for(const line of frame.split('\n')) {try{find(JSON.parse(line.slice(line.indexOf(':')+1)));}catch{}}
}
if(!models)throw Error('No model metadata found');
const dates=new Map(models.filter(m=>/^\d{4}-\d{2}-\d{2}$/.test(m.releaseDate)).map(m=>[m.id,m.releaseDate]));
const path='src-tauri/data/ladder.json';const snapshot=JSON.parse(fs.readFileSync(path,'utf8'));let count=0;
for(const entry of snapshot.entries){if(dates.has(entry.id)){entry.releasedAt=dates.get(entry.id);count++;}}
fs.writeFileSync(path,JSON.stringify(snapshot,null,2)+'\n');console.log(`Imported ${count} exact model release dates from AITier; prices unchanged`);
