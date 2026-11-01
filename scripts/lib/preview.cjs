const fs=require('node:fs'),path=require('node:path');
function preparePreview(root,board){
  const preview=path.join(root,'dist-mock');fs.mkdirSync(preview,{recursive:true});
  if(!board){
    const file=process.env.QUOTA_BENCHMARK_BOARD||path.join(root,'target/benchmark-sources/board.json');
    if(!fs.existsSync(file))throw new Error('模型预览资料缺失：先运行 cargo run --release --locked --manifest-path src-tauri/Cargo.toml --example benchmark_checks -- --fixtures');
    board=JSON.parse(fs.readFileSync(file,'utf8'));
  }
  if(!board.releases?.length)board.releases=JSON.parse(fs.readFileSync(path.join(root,'src-tauri/data/model-releases.json'),'utf8')).releases;
  fs.cpSync(path.join(root,'dist/assets'),path.join(preview,'assets'),{recursive:true});
  for(const name of ['ai-models.json','model_catalog.json','ladder.json'])fs.copyFileSync(path.join(root,'src-tauri/data',name),path.join(preview,name));
  fs.writeFileSync(path.join(preview,'benchmark-board.json'),JSON.stringify(board));
  const [a,b,iteration]=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version.split('.');
  const mock=fs.readFileSync(path.join(root,'scripts/mock-tauri.js'),'utf8').replaceAll('__QUOTA_VERSION__',a+'.'+b+'.'+iteration.padStart(4,'0'));
  fs.writeFileSync(path.join(preview,'index.html'),fs.readFileSync(path.join(root,'dist/index.html'),'utf8').replace('<head>','<head><script>'+mock+'</script>'));
  return preview;
}
module.exports={preparePreview};
