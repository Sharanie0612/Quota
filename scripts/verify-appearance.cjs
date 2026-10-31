const assert=require('node:assert/strict'),path=require('node:path');
const load=require('./lib/source-loader.cjs').createSourceLoader();
const {normalizePreferences,newerPreferences,defaultPreferences}=load(path.join(__dirname,'../src/lib/appearance/preferences'));
const {THEMES,themeTokens}=load(path.join(__dirname,'../src/lib/appearance/themes'));
const {resolveWindowKind}=load(path.join(__dirname,'../src/window'));
const current={theme:'quota',mode:'light',collapsed:false,glass:true,revision:42};
assert.deepEqual(normalizePreferences(current),current);
assert.deepEqual(normalizePreferences({...current,theme:'claude',revision:0}),{...current,theme:'quota',revision:0});
assert.equal(normalizePreferences({...current,glass:undefined}).glass,false);
for(const value of [null,[],{},'bad',{...current,theme:'unknown'},{...current,mode:'unknown'},{...current,glass:1},{...current,collapsed:'no'},{...current,revision:-1},{...current,revision:NaN},{...current,revision:2**53}])assert.equal(normalizePreferences(value),null);
assert.equal(newerPreferences(current,{...current,revision:41,glass:false}),current);
assert.equal(newerPreferences(current,{bad:true}),current);
assert.equal(newerPreferences(current,{...current,revision:43,glass:false}).glass,false);
assert.equal(defaultPreferences.glass,false);
for(const theme of THEMES)for(const mode of ['light','dark']){
  const tokens=themeTokens(theme.id,mode);
  for(const [key,value] of Object.entries({window:16,surface:16,control:10,inset:8}))assert.equal(tokens['radius-'+key],value+'px');
  for(const key of ['bg','surface','text','text-2','text-3','blue','on-primary'])assert(tokens[key]);
}
assert.equal(resolveWindowKind('?window=usage-widget'),'usage-widget');
assert.equal(resolveWindowKind('?window=setup'),'setup');
assert.equal(resolveWindowKind('?window=retired-tray'),'main');
console.log('PASS preference validation, legacy glass migration, stale-update rejection, shared geometry, ten palettes and window routing');
