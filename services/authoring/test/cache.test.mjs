import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const script=path.resolve('deploy/check-key.mjs');
test('Build checks invalidate for code and fonts, but not content or generated artifacts',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'blog-cache-key-'));
 try{
 for(const d of ['src/content','src/generated','src/assets/fonts/.subset','deploy'])mkdirSync(path.join(root,d),{recursive:true});
 const put=(p,s)=>writeFileSync(path.join(root,p),s);
 const key=()=>execFileSync(process.execPath,[script],{cwd:root,encoding:'utf8'}).trim();
 put('src/page.ts','v1');const first=key();
 put('src/content/post.md','changed');put('src/generated/icons.ts','output');put('src/assets/fonts/.subset/a.stamp','chars');assert.equal(key(),first);
 put('src/page.ts','v2');assert.notEqual(key(),first);const second=key();
 put('src/assets/fonts/a.ttf','font change');assert.notEqual(key(),second);
 }finally{rmSync(root,{recursive:true,force:true});}
});
