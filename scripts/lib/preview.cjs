const fs=require('node:fs'),path=require('node:path');
function preparePreview(root,snapshot){
  const preview=path.join(root,'dist-mock');fs.mkdirSync(preview,{recursive:true});
  if(!snapshot){
    const seed=JSON.parse(fs.readFileSync(path.join(root,'src-tauri/data/benchmarks.json'),'utf8'));
    const releases=JSON.parse(fs.readFileSync(path.join(root,'src-tauri/data/model-releases.json'),'utf8')).releases;
    const dates=new Map(releases.map(release=>[JSON.stringify([release.vendor.toLowerCase(),release.id]),release.releasedAt]));
    const source=seed.sources.find(source=>source.id==='artificial-analysis');
    snapshot={
      origin:'historical',
      indexVersion:source.edition.version,
      checkedAt:source.checkedAt,
      models:seed.profiles.filter(profile=>profile.sourceId===source.id&&profile.version===source.edition.version).map(profile=>({
        id:profile.id,name:profile.name,
        modelName:profile.setting&&profile.name.endsWith(' ('+profile.setting+')')
          ?profile.name.slice(0,-profile.setting.length-3):profile.name,
        creator:profile.vendor,index:profile.index,
        releaseDate:dates.get(JSON.stringify([profile.vendor.toLowerCase(),profile.modelId]))??null,
        costPerTask:profile.cost>0?profile.cost:null,
      })),
    };
  }
  fs.cpSync(path.join(root,'dist/assets'),path.join(preview,'assets'),{recursive:true});
  for(const name of ['ai-models.json','model_catalog.json','ladder.json'])fs.copyFileSync(path.join(root,'src-tauri/data',name),path.join(preview,name));
  fs.writeFileSync(path.join(preview,'aa-task-cost.json'),JSON.stringify(snapshot));
  const [a,b,iteration]=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version.split('.');
  const mock=fs.readFileSync(path.join(root,'scripts/mock-tauri.js'),'utf8').replaceAll('__QUOTA_VERSION__',a+'.'+b+'.'+iteration.padStart(4,'0'));
  fs.writeFileSync(path.join(preview,'index.html'),fs.readFileSync(path.join(root,'dist/index.html'),'utf8').replace('<head>','<head><script>'+mock+'</script>'));
  return preview;
}
module.exports={preparePreview};
