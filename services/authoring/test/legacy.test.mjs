import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '../storage.mjs';
import { sourceEntries } from '../legacy.mjs';
import { exportSnapshot } from '../export.mjs';
test('Existing articles map to original paths; advanced bodies and metadata are preserved; withdrawal removes only selected article',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'legacy-test-'));mkdirSync(path.join(root,'posts'));
  const file=path.join(root,'posts','guide.md'),original='![cover](/images/cover.png)\n\n:::note\nAdvanced body\n:::\n';
  writeFileSync(file,`---\ntitle: Guide\npublished: 2026-10-08\nimage: /images/cover.png\npermalink: /guide/\n---\n${original}`);
  const s=new Store(path.join(root,'db.sqlite3'),'admin');
  try{
    assert.equal(s.importSource(root),1);assert.equal(s.importSource(root),0);
    const entry=s.get(s.list()[0].id);assert.equal(entry.protectedBody,false);assert.equal(entry.source,'posts/guide.md');assert.equal(entry.publishedRevision,1);
    const {id,revision,updated,deleted,publishedRevision,source,protectedBody,sourceHash,...fields}=entry;
    const changed=s.save({...fields,title:'Changed',body:original+'\nEdited paragraph.',metadata:{...fields.metadata,pinned:true,comment:false,series:'notes',seriesOrder:2}},id,revision);
    assert.throws(()=>s.save({...fields,body:original+'<script>bad()</script>'},id,2),/unsafeMarkdown/);
    exportSnapshot({version:1,id:randomUUID(),documents:[changed]},root);
    assert.throws(()=>exportSnapshot({version:1,id:randomUUID(),documents:[changed]},root),/Source mapping changed/);
    const out=readFileSync(file,'utf8');assert(out.includes('title: Changed'));assert(out.includes('Edited paragraph.'));assert(out.includes('pinned: true'));assert(out.includes('seriesOrder: 2'));assert(out.includes('permalink: /guide/'));assert(out.includes(original));assert(out.includes('image: /images/cover.png'));
    exportSnapshot({version:1,id:randomUUID(),documents:[],removed:[id]},root);assert.equal(existsSync(file),false);
  }finally{s.close();rmSync(root,{recursive:true,force:true});}
});

test('Every real source article round-trips without losing theme Markdown or metadata',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'shirone-roundtrip-'));
  const source=path.resolve('src/content'),entries=sourceEntries(source);assert.ok(entries.length>=4);
  for(const e of entries){const dest=path.join(root,e.relative);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,readFileSync(path.join(source,e.relative)));}
  const store=new Store(path.join(root,'test.sqlite3'),'admin');
  try{
    store.importSource(root);const saved=[];
    for(const e of entries){
      const {id,revision,updated,deleted,publishedRevision,source,sourceHash,protectedBody,...d}=store.get(e.id);
      const body=e.relative.endsWith('.mdx')?e.body:e.body+'\n\nRound-trip paragraph.';
      saved.push(store.save({...d,body,metadata:{...d.metadata,pinned:true}},id,revision));
    }
    exportSnapshot({version:1,id:randomUUID(),documents:saved},root);
    for(const e of sourceEntries(root)){const savedDoc=saved.find(d=>d.id===e.id);assert.equal(e.body.trim(),savedDoc.body.trim());assert.equal(e.front.pinned,true);assert.equal(e.document.metadata.image,savedDoc.metadata.image);}
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
