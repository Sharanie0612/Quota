// Load production TypeScript for lightweight logic/SSR checks without a second build.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function createSourceLoader(){
  const cache=new Map();
  return function load(file){
    const resolved=[file,`${file}.ts`,`${file}.tsx`,`${file}.json`,path.join(file,'index.ts')].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
    if(!resolved)throw new Error(`Cannot resolve source module: ${file}`);
    if(cache.has(resolved))return cache.get(resolved).exports;
    const module={exports:{}};cache.set(resolved,module);
    if(resolved.endsWith('.json')){module.exports=JSON.parse(fs.readFileSync(resolved,'utf8'));return module.exports;}
    const js=ts.transpileModule(fs.readFileSync(resolved,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    new Function('module','exports','require',js)(module,module.exports,name=>{
      if(/\.(css|svg|png)$/.test(name))return name;
      return name.startsWith('.')?load(path.resolve(path.dirname(resolved),name)):require(name);
    });
    return module.exports;
  };
}
module.exports={createSourceLoader};
