import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { Store, seal, unseal } from '../storage.mjs';
import { createApp } from '../app.mjs';
import { safeTree, preview } from '../content.mjs';
import { exportSnapshot } from '../export.mjs';
import { requireLogin } from '../auth.mjs';
import { validateDocument } from '../content.mjs';
import sharp from 'sharp';

test('Background polling cannot extend the 30 minute idle authorization window',()=>{
  const now=Date.now();let denied=false,allowed=false;
  const session={user:{sub:'owner'},created:now,activity:now-31*60*1000,destroy:()=>{}};
  const res={status(code){assert.equal(code,401);denied=true;return this;},json(){}};
  requireLogin({session,get:()=> '1'},res,()=>{allowed=true;});assert(denied);assert(!allowed);
  session.activity=now-1000;requireLogin({session,get:()=> '1'},res,()=>{});assert.equal(session.activity,now-1000);
  requireLogin({session,get:()=> '0'},res,()=>{});assert(session.activity>=now);
});

const doc={kind:'posts',title:'Test entry',date:'2026-10-08',body:'# Heading\n\nPrivate draft marker',tags:[],description:'',category:''};
function setup(mode='admin',options={}) {
  const root=mkdtempSync(path.join(tmpdir(),'authoring-test-'));
  const queue=path.join(root,'queue'),results=path.join(root,'results');mkdirSync(queue);mkdirSync(results);
  const store=new Store(path.join(root,'data.sqlite3'),mode,randomBytes(32));
  // Dependency injection exists only in tests; production server always constructs the real OIDC provider.
  const identity={begin:async()=>({url:'/auth/callback?code=test',time:Date.now()}),finish:async()=>({sub:'test-owner'})};
  const built=createApp({mode,secure:false,sessionSecret:randomBytes(48).toString('hex'),origin:'http://localhost',queue,results,...options},store,identity);
  const agent=request.agent(built.app);
  return {root,queue,results,store,app:built.app,agent,close(){built.close();store.close();rmSync(root,{recursive:true,force:true});}};
}
async function login(s){await s.agent.get('/auth/login').expect(303);await s.agent.get('/auth/callback?code=test').expect(303);return(await s.agent.get('/api/session').expect(200)).body.csrf;}
function write(agent,method,url,csrf,data){return agent[method](url).set('Origin','http://localhost').set('X-CSRF-Token',csrf).send(data);}

test('Anonymous APIs denied, host and CSRF checks required, logout revokes session',async()=>{
  const s=setup();try{
    await request(s.app).get('/api/documents').expect(401);
    await request(s.app).post('/api/documents').send(doc).expect(401);
    await s.agent.get('/auth/callback?code=forged').expect(401);
    const csrf=await login(s);
    await s.agent.post('/api/documents').send(doc).expect(403);
    await s.agent.post('/api/documents').set('Origin','https://evil.example').set('X-CSRF-Token',csrf).send(doc).expect(403);
    await write(s.agent,'post','/api/documents',csrf,doc).expect(201);
    await write(s.agent,'post','/api/logout',csrf,{}).expect(200);
    await s.agent.get('/api/documents').expect(401);
  }finally{s.close();}
});
test('Optimistic edits and recycle bin prevent overwrite and preserve content',()=>{
  const s=setup();try{
    const a=s.store.save(doc);const b=s.store.save({...doc,title:'new'},a.id,a.revision);
    assert.throws(()=>s.store.save(doc,a.id,a.revision),/conflict/);
    const trash=s.store.trash(a.id,b.revision,true);
    assert.equal(trash.deleted,true);assert.throws(()=>s.store.save(doc,a.id,trash.revision),/conflict/);
    const restored=s.store.trash(a.id,trash.revision,false);assert.equal(restored.title,'new');
  }finally{s.close();}
});
test('Vault encrypts title, body and tags; tampering and record swapping fail closed',()=>{
  const key=randomBytes(32),text=seal(key,doc,'record-a');
  assert(!text.includes(doc.title));assert.deepEqual(unseal(key,text,'record-a'),doc);
  assert.throws(()=>unseal(key,text,'record-b'));assert.throws(()=>unseal(randomBytes(32),text,'record-a'));
  const p=JSON.parse(text);p.c=Buffer.from('tampered').toString('base64');assert.throws(()=>unseal(key,JSON.stringify(p),'record-a'));
  const s=setup('vault');try{
    s.store.save({...doc,kind:'diary'});
    const raw=s.store.db.prepare('SELECT payload FROM documents').get().payload;assert(!raw.includes(doc.title));assert(!raw.includes('Private draft marker'));
    assert.throws(()=>s.store.save(doc),/wrongSpace/);
  }finally{s.close();}
});
test('Vault has no publishing API and does not accept admin cookies',async()=>{
  const a=setup(),v=setup('vault');try{
    const csrf=await login(v);
    await write(v.agent,'post','/api/publish',csrf,{id:randomUUID(),revision:1}).expect(404);
    await write(v.agent,'post','/api/documents',csrf,doc).expect(400);
    await request(v.app).get('/api/documents').set('Cookie','__Host-admin=forged').expect(401);
  }finally{a.close();v.close();}
});
test('Publishing snapshots exclude drafts, freeze revisions, serialize jobs and apply results',async()=>{
  const s=setup();try{
    const csrf=await login(s),draft=s.store.save({...doc,title:'DO NOT PUBLISH'}),ready=s.store.save({...doc,body:'Approved'});
    const job=await write(s.agent,'post','/api/publish',csrf,{id:ready.id,revision:1}).expect(202);
    const snap=JSON.parse(readFileSync(path.join(s.queue,`${job.body.id}.json`),'utf8'));
    assert.equal(snap.documents.length,1);assert(!JSON.stringify(snap).includes(draft.title));
    s.store.save({...doc,body:'New draft only'},ready.id,1);assert.equal(snap.documents[0].body,'Approved');
    await write(s.agent,'post','/api/publish',csrf,{id:ready.id,revision:2}).expect(409);
    writeFileSync(path.join(s.results,`${job.body.id}.json`),JSON.stringify({state:'succeeded'}));
    await s.agent.get('/api/jobs').expect(200);assert.equal(s.store.get(ready.id).publishedRevision,1);
    assert.equal(s.store.get(ready.id).body,'New draft only');
    const target=path.join(s.root,'content');mkdirSync(target);exportSnapshot(snap,target);
    const files=readdirSync(path.join(target,'posts','workspace'));assert.equal(files.length,1);
    const text=readFileSync(path.join(target,'posts','workspace',files[0]),'utf8');assert(text.includes('Approved'));assert(!text.includes('New draft only'));
    assert.throws(()=>exportSnapshot({...snap,documents:[{...snap.documents[0],id:'../../escape'}]},target));
    assert.throws(()=>exportSnapshot({...snap,documents:[{...snap.documents[0],kind:'diary'}]},target));
  }finally{s.close();}
});
test('Markdown rejects HTML, remote images, reference URLs and unsafe links; directives stay inert',()=>{
  for(const value of ['<script>alert(1)</script>','![image](https://evil.example/x)','[x](javascript:alert%281%29)','[x][ref]\n\n[ref]: https://example.com'])assert.throws(()=>safeTree(value));
  const result=preview(':::code-tree{src="/etc/passwd"}\n\n```mermaid\ngraph TD\n```');
  assert(!result.includes('<script'));assert(!result.includes('class="language-mermaid"') || result.includes('<code'));
  assert(preview('[link](https://example.com)').includes('noreferrer'));
});
test('Rich authoring preserves theme syntax and metadata but rejects executable or file-reading input',()=>{
  const body=':::tip[提示]\n正文\n:::\n\n![cover](/blog-media/example.webp)\n\n```mermaid\ngraph TD\nA-->B\n```\n\n| A | B |\n|---|---|\n|1|2|';
  const d=validateDocument({...doc,body,metadata:{image:'/images/cover.webp',pinned:true,comment:false,series:'notes',seriesOrder:2,permalink:'/notes/first/'}},'admin');
  assert.equal(d.body,body);assert.equal(d.metadata.seriesOrder,2);
  for(const body of ['<script>alert(1)</script>',':script[alert(1)]',':::tip{onclick="alert(1)"}\nx\n:::','::: tip{onmouseover="bad()"}\nx\n:::','<!-- @include: /etc/passwd -->','@[code-tree](/run/secrets)','::code-tree{dir="/run/secrets"}','![x](javascript:alert%281%29)'])assert.throws(()=>validateDocument({...doc,body},'admin'),/unsafeMarkdown/);
  assert.throws(()=>validateDocument({...doc,metadata:{permalink:'/../escape'}},'admin'));
  assert.throws(()=>validateDocument({...doc,metadata:{internal:'unexpected'}},'admin'));
});
test('Image uploads require authorization, decode as images and publish only approved references',async()=>{
  const s=setup();try{
    const png=await sharp({create:{width:2,height:2,channels:3,background:{r:128,g:64,b:192}}}).png().toBuffer();
    await request(s.app).post('/api/media').set('Content-Type','image/png').send(png).expect(401);
    const csrf=await login(s);
    await s.agent.post('/api/media').set('Content-Type','image/png').send(png).expect(403);
    await s.agent.post('/api/media').set('Origin','http://localhost').set('X-CSRF-Token',csrf).set('Content-Type','image/png').send(Buffer.from('<script>bad</script>')).expect(400);
    const upload=await s.agent.post('/api/media').set('Origin','http://localhost').set('X-CSRF-Token',csrf).set('Content-Type','image/png').send(png).expect(201);
    const media=path.join(s.root,'media');assert.equal((await sharp(readFileSync(path.join(media,upload.body.name))).metadata()).format,'webp');
    await s.agent.get(upload.body.preview).expect(200);await request(s.app).get(upload.body.preview).expect(401);
    const published=s.store.save({...doc,metadata:{image:upload.body.url}}),target=path.join(s.root,'out'),pub=path.join(s.root,'public');mkdirSync(target);mkdirSync(pub);
    writeFileSync(path.join(media,randomUUID()+'.webp'),png);
    exportSnapshot({version:1,id:randomUUID(),documents:[published]},target,media,pub);
    assert.deepEqual(readdirSync(path.join(pub,'blog-media')),[upload.body.name]);
  }finally{s.close();}
});

test('New remote images and filesystem traversal cannot become build fetch targets',()=>{
  const s=setup();try{
    for(const value of ['http://127.0.0.1:3000/secrets','https://arbitrary.example/image.png','../outside.png']){
      assert.throws(()=>s.store.save({...doc,metadata:{image:value}}),/unsafeMarkdown/);
      assert.throws(()=>s.store.save({...doc,body:`![image](${value})`}),/unsafeMarkdown/);
    }
  }finally{s.close();}
});

test('Source covers work below dot-directories and traversal stays denied',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'asset-boundary-')),source=path.join(root,'.checkout','content'),pub=path.join(root,'.checkout','public');
  mkdirSync(path.join(source,'posts','guide'),{recursive:true});mkdirSync(pub,{recursive:true});
  writeFileSync(path.join(source,'posts','guide','index.md'),'---\ntitle: Cover\npublished: 2026-10-08\nimage: ./cover.webp\n---\nBody');
  const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#8060a0'}}).webp().toBuffer();
  writeFileSync(path.join(source,'posts','guide','cover.webp'),bytes);writeFileSync(path.join(pub,'cover.webp'),bytes);writeFileSync(path.join(root,'secret.webp'),bytes);
  const s=setup('admin',{source,sourcePublic:pub});
  try{
    s.store.importSource(source);const id=s.store.list()[0].id;await login(s);
    await s.agent.get(`/api/source-asset/${id}`).query({src:'./cover.webp'}).expect(200).expect('Content-Type',/image\/webp/);
    await s.agent.get(`/api/source-asset/${id}`).query({src:'../../../../secret.webp'}).expect(404);
    const fresh=s.store.save(doc);await s.agent.get(`/api/source-asset/${fresh.id}`).query({src:'/cover.webp'}).expect(200);
  }finally{s.close();rmSync(root,{recursive:true,force:true});}
});

test('Editor style nonce is unique per response and does not loosen script CSP',async()=>{
 const s=setup();try{
  const a=await request(s.app).get('/?signedOut=1').expect(200),b=await request(s.app).get('/?signedOut=1').expect(200);
  const nonce=r=>r.text.match(/name="editor-nonce" content="([^"]+)"/)[1];
  assert.notEqual(nonce(a),nonce(b));assert(a.headers['content-security-policy'].includes(`'nonce-${nonce(a)}'`));
  assert(!a.headers['content-security-policy'].includes("'unsafe-inline'"));assert(!a.text.includes('__EDITOR_NONCE__'));
 }finally{s.close();}
});

test('Entry opens authentication directly while explicit logout stays signed out',async()=>{
 const s=setup();try{
  await s.agent.get('/').expect(303).expect('Location','/auth/login');
  await s.agent.get('/?signedOut=1').expect(200);
  const csrf=await login(s);await s.agent.get('/').expect(200);
  await write(s.agent,'post','/api/logout',csrf,{}).expect(200);
  await s.agent.get('/').expect(303);await s.agent.get('/api/documents').expect(401);
 }finally{s.close();}
});
test('Publishing an already approved revision does not create another build',async()=>{
 const s=setup();try{
 const csrf=await login(s),d=s.store.save(doc);
 const job=await write(s.agent,'post','/api/publish',csrf,{id:d.id,revision:1}).expect(202);
 writeFileSync(path.join(s.results,job.body.id+'.json'),JSON.stringify({state:'succeeded'}));
 const again=await write(s.agent,'post','/api/publish',csrf,{id:d.id,revision:1}).expect(200);
 assert.equal(again.body.unchanged,true);assert.equal(readdirSync(s.queue).length,1);
 }finally{s.close();}
});
