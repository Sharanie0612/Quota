// Prepare the real production UI with synthetic Tauri responses.
const fs=require('fs');
fs.mkdirSync('dist-mock',{recursive:true});
fs.cpSync('dist/assets','dist-mock/assets',{recursive:true});
for(const name of ['ladder.json','model_catalog.json']) fs.copyFileSync(`src-tauri/data/${name}`,`dist-mock/${name}`);
const mock=fs.readFileSync('scripts/mock-tauri.js','utf8');
fs.writeFileSync('dist-mock/index.html',fs.readFileSync('dist/index.html','utf8').replace('<head>','<head><script>'+mock+'</script>'));
