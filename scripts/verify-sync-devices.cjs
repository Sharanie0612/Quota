const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const exportsForModule = {};
const js = ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/syncDevices.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
new Function('exports', js)(exportsForModule);
const {splitSyncDevices} = exportsForModule;
const options = {deviceId:'local',codexSshDevices:[{deviceId:'ssh-configured',name:'linux',included:true}]};
const devices = [{id:'local',name:'电脑'}, {id:'peer',name:'笔记本'}, {id:'ssh-configured',name:'linux'}, {id:'ssh-imported',name:'SSH · server'}, {id:'imported-only',name:'旧日志'}];
// Only actual sync directories announce a Quota reader. No installation is
// inferred from a metric owner, an imported log, or a renamed SSH source.
const readers = ['peer','new-peer','ssh-configured','ssh-imported'].map(device=>({device}));
const split = splitSyncDevices(devices,readers,options);
assert.deepEqual(split.peers.map(d=>d.id),['peer','new-peer']);
assert.deepEqual(split.ssh.map(d=>d.id),['ssh-configured','ssh-imported']);
assert.equal(split.peers[1].name,'其他电脑 new-peer');
assert.equal(splitSyncDevices(devices,[],options).peers.length,0);
assert.equal(splitSyncDevices([{id:'local',name:'SSH · 我的电脑'}],[],options).ssh.length,0);
assert.deepEqual(splitSyncDevices([],[],options).peers,[]);
console.log('PASS Quota clients require sync-reader evidence; SSH and imported metric owners are separate; missing names and local identity retained');
