import { readFileSync,readdirSync,lstatSync,existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { sourceMetadata } from './fields.mjs';
export function sourceId(relative) {
  const b=createHash('sha256').update('shirone-source:'+relative).digest().subarray(0,16);
  b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function sourceEntries(root) {
  const entries=[];
  function walk(dir,kind) {
    if(!existsSync(dir))return;
    if(lstatSync(dir).isSymbolicLink())throw new Error('Symlink source');
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      if(entry.isSymbolicLink())throw new Error('Symlink source');
      if(entry.name==='workspace')continue;
      const file=path.join(dir,entry.name);
      if(entry.isDirectory()){walk(file,kind);continue;}
      if(!entry.isFile()||!(/\.mdx?$/.test(entry.name)))continue;
      const text=readFileSync(file,'utf8');if(Buffer.byteLength(text)>1024*1024)throw new Error('Source entry too large');
      const match=text.replace(/^\uFEFF/,'').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);if(!match)continue;
      const yaml=parseDocument(match[1]);if(yaml.errors.length)throw new Error('Invalid source metadata');
      const front=yaml.toJS({maxAliasCount:20});if(!front||typeof front!=='object')continue;
      const relative=path.relative(root,file).split(path.sep).join('/');
      const protectedBody=entry.name.endsWith('.mdx');
      const title=String(front.title??match[2].split('\n').find(x=>x.trim())??entry.name).replace(/^#+\s*/, '').slice(0,160)||entry.name;
      const date=String(front.published??'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Invalid source date');
      entries.push({id:sourceId(relative),relative,front,body:match[2],protectedBody,hash:createHash('sha256').update(text).digest('hex'),
        document:{kind,title,date,description:String(front.description??'').slice(0,500),category:String(front.category??'').slice(0,60),tags:Array.isArray(front.tags)?front.tags.map(String):[],body:match[2],metadata:sourceMetadata(front)},published:front.draft!==true});
    }
  }
  for(const kind of ['posts','moments'])walk(path.join(root,kind),kind);
  return entries;
}
