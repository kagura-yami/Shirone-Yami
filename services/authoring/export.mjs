import { readFileSync, mkdirSync, writeFileSync, rmSync, lstatSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { stringify } from 'yaml';
import { documentSchema,idSchema,validateDocument } from './content.mjs';
import { sourceEntries } from './legacy.mjs';
import { validateAssetReferences } from './rich-markdown.mjs';
export function exportSnapshot(manifest, root, mediaRoot, publicRoot) {
  const shape=z.object({version:z.literal(1),id:idSchema,removed:z.array(idSchema).max(1000).default([]),documents:z.array(documentSchema.extend({id:idSchema,revision:z.number().int().positive(),updated:z.string(),deleted:z.literal(false),publishedRevision:z.number().int().nonnegative(),source:z.string().nullable().optional(),sourceHash:z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),protectedBody:z.boolean().optional()})).max(1000)}).strict();
  const snap=shape.parse(manifest),ids=new Set();
  const sources=new Map(sourceEntries(root).map(s=>[s.id,s]));
  const prepared=snap.documents.map(doc=>{
    if(ids.has(doc.id))throw new Error('Duplicate document');ids.add(doc.id);
    const {id,revision,updated,deleted,publishedRevision,source,protectedBody,sourceHash,...content}=doc;
    const original=sources.get(id);
    if(source && (!original || original.relative!==source || sourceHash!==original.hash))throw new Error('Source mapping changed');
    const d=validateDocument(content,'admin',original?.body,original?.relative.endsWith('.mdx'));
    validateAssetReferences(d,original?.document);
    if(original && d.kind!==original.document.kind)throw new Error('Source kind changed');
    const published=original?.document.date===d.date ? original.front.published : d.date;
    const front={...(original?.front??{}),...d.metadata,...(d.kind==='posts'?{title:d.title,published,description:d.description,tags:d.tags,category:d.category,draft:false}:{published,tags:d.tags,draft:false})};
    for(const key of ['publishedAt','updated','updatedAt','seriesOrder','alias','permalink'])if(front[key]===''||front[key]===null)delete front[key];
    const body=d.body;
    return {kind:d.kind,id,relative:original?.relative,content:`---\n${stringify(front)}---\n\n${body}\n`};
  });
  root=path.resolve(root);
  for(const kind of ['posts','moments']){
    const base=path.join(root,kind);if(existsSync(base)&&lstatSync(base).isSymbolicLink())throw new Error('Symlink content root');
    const owned=path.join(base,'workspace');
    if(existsSync(owned)&&lstatSync(owned).isSymbolicLink())throw new Error('Symlink namespace');
    rmSync(owned,{recursive:true,force:true});mkdirSync(owned,{recursive:true});
  }
  for(const id of snap.removed){if(ids.has(id))throw new Error('Removed and published at once');const original=sources.get(id);if(original)rmSync(path.join(root,original.relative));}
  for(const p of prepared)writeFileSync(p.relative?path.join(root,p.relative):path.join(root,p.kind,'workspace',`${p.id}.md`),p.content,{flag:p.relative?'w':'wx'});
  const assets=new Set([...JSON.stringify(snap.documents).matchAll(/\/blog-media\/([0-9a-f-]{36}\.webp)/g)].map(m=>m[1]));
  if(assets.size){
    if(!mediaRoot||!publicRoot)throw new Error('Media roots required');
    const dest=path.join(publicRoot,'blog-media');
    if(existsSync(dest)&&lstatSync(dest).isSymbolicLink())throw new Error('Symlink media namespace');
    mkdirSync(dest,{recursive:true});
    for(const name of assets){const file=path.join(mediaRoot,name),target=path.join(dest,name);if(!existsSync(file)||lstatSync(file).isSymbolicLink()||lstatSync(file).size>10*1024*1024||(existsSync(target)&&lstatSync(target).isSymbolicLink()))throw new Error('Invalid media');copyFileSync(file,target);}
  }
  return prepared.length;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const raw=readFileSync(process.argv[2],'utf8');if(Buffer.byteLength(raw)>16*1024*1024)throw new Error('Manifest too large');
  console.log(`Exported ${exportSnapshot(JSON.parse(raw),process.argv[3],process.argv[4],process.argv[5])} approved entries`);
}
