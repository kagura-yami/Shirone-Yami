import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fault, documentSchema, idSchema, preview } from './content.mjs';
import { authRoutes, sessionMiddleware, requireLogin, requireCsrf, authenticated } from './auth.mjs';

import { previewStyle } from './public/preview-style.mjs';
import { mediaRoutes } from './media.mjs';
import { themePreview } from './render.mjs';
import { validateDocument } from './content.mjs';
const previewHash=createHash('sha256').update(previewStyle).digest('base64');
const publicDir=fileURLToPath(new URL('./public/',import.meta.url));
export function createApp(config,store,identity) {
  const app=express(); app.disable('x-powered-by');
  app.use((req,res,next)=>{res.locals.editorNonce=randomBytes(18).toString('base64');next();});
  // Production trusts only the known Caddy peer, never a client-supplied forwarded chain.
  app.set('trust proxy',config.proxy ?? false);
  app.use(helmet({strictTransportSecurity:false,contentSecurityPolicy:{directives:{defaultSrc:["'none'"],scriptSrc:["'self'"],styleSrc:["'self'",`'sha256-${previewHash}'`,(req,res)=>`'nonce-${res.locals.editorNonce}'`],imgSrc:["'self'","https:"],connectSrc:["'self'"],fontSrc:["'self'"],frameSrc:["'self'"],frameAncestors:["'none'"],baseUri:["'none'"],formAction:["'self'"]}}}));
  app.use((req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}); next();});
  app.get('/health',(_,res)=>res.json({ok:true}));
  app.use(rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'rateLimit'}}));
  const sessions=sessionMiddleware(config); app.use(sessions.middleware);
  app.use('/auth',rateLimit({windowMs:60000,limit:20,legacyHeaders:false,message:{error:'rateLimit'}}));
  authRoutes(app,config,identity,(action)=>store.audit(action));
  app.get('/api/session',requireLogin,(req,res)=>res.json({mode:config.mode,csrf:req.session.csrf}));
  app.use('/api',requireLogin,requireCsrf(config.origin),express.json({limit:'256kb',strict:true}));
  app.post('/api/logout',(req,res)=>{store.audit('logout');req.session.destroy(()=>{res.clearCookie(`${config.secure?'__Host-':'test-'}${config.mode}`,{path:'/',secure:config.secure,httpOnly:true,sameSite:'lax'});res.json({ok:true});});});
  app.post('/api/logout-all',(req,res)=>{store.audit('logout-all');sessions.store.clear(()=>res.json({ok:true}));});
  app.get('/api/documents',(_,res)=>res.json(store.list()));
  app.get('/api/documents/:id',(req,res)=>res.json(store.get(req.params.id)));
  app.post('/api/documents',(req,res)=>res.status(201).json(store.save(req.body)));
  app.put('/api/documents/:id',(req,res)=>{
    const {revision,document}=z.object({revision:z.number().int().positive(),document:documentSchema}).strict().parse(req.body);
    res.json(store.save(document,req.params.id,revision));
  });
  app.post('/api/documents/:id/trash',(req,res)=>{
    const b=z.object({revision:z.number().int().positive(),deleted:z.boolean()}).strict().parse(req.body);
    res.json(store.trash(req.params.id,b.revision,b.deleted));
  });
  app.post('/api/preview',(req,res)=>res.json({html:preview(z.string().max(100000).parse(req.body.body))}));
  mediaRoutes(app,{...config,media:config.media??path.join(path.dirname(config.queue??'/tmp'),'media')},store);
  app.post('/api/theme-preview',async(req,res)=>{
    const b=z.object({id:idSchema.optional(),document:documentSchema}).strict().parse(req.body);
    const original=b.id?store.db.prepare('SELECT * FROM legacy WHERE id=?').get(b.id):null;
    const doc=validateDocument(b.document,config.mode,original?.original_body,original?.source_path.endsWith('.mdx'));
    if(original?.source_path.endsWith('.mdx'))throw new Fault('unsafeMarkdown');
    res.json({html:await themePreview(doc.body)});
  });
  if(config.mode==='admin') {
    function reconcile() {
      for(const job of store.db.prepare("SELECT * FROM jobs WHERE state IN ('queued','building')").all()) {
        const p=path.join(config.results,`${job.id}.json`); if(!existsSync(p)) continue;
        const result=JSON.parse(readFileSync(p,'utf8'));
        if(!['building','succeeded','failed'].includes(result.state)) continue;
        if(result.state==='succeeded') {
          const snap=JSON.parse(readFileSync(path.join(config.queue,`${job.id}.json`),'utf8'));
          store.db.exec('BEGIN IMMEDIATE');
          try {
            store.db.prepare('UPDATE documents SET approved=NULL,published_revision=0').run();
            store.db.prepare('DELETE FROM withdrawals').run();
            for(const id of snap.removed??[])store.db.prepare('INSERT INTO withdrawals(id) VALUES(?)').run(id);
            for(const d of snap.documents) store.db.prepare('UPDATE documents SET approved=?,published_revision=? WHERE id=?').run(JSON.stringify(d),d.revision,d.id);
            store.db.prepare('UPDATE jobs SET state=? WHERE id=?').run(result.state,job.id);
            store.db.exec('COMMIT');
          } catch(e) {store.db.exec('ROLLBACK');throw e;}
        } else store.db.prepare('UPDATE jobs SET state=? WHERE id=?').run(result.state,job.id);
      }
    }
    app.get('/api/jobs',(_,res)=>{reconcile();res.json(store.db.prepare('SELECT * FROM jobs ORDER BY created DESC LIMIT 30').all());});
    app.post('/api/publish',(req,res)=>{
      reconcile();
      const {id,revision,withdraw}=z.object({id:idSchema,revision:z.number().int().positive(),withdraw:z.boolean().default(false)}).strict().parse(req.body);
      if(store.db.prepare("SELECT id FROM jobs WHERE state IN ('queued','building')").get()) throw new Fault('busy',409);
      const doc=store.get(id); if(doc.revision!==revision || doc.deleted) throw new Fault('conflict',409);
      if(!withdraw&&doc.publishedRevision===revision)return res.json({unchanged:true});
      const documents=store.db.prepare('SELECT approved FROM documents WHERE approved IS NOT NULL AND id<>?').all(id).map(r=>JSON.parse(r.approved));
      if(!withdraw) documents.push(doc);
      const removed=store.db.prepare('SELECT id FROM withdrawals WHERE id<>?').all(id).map(r=>r.id);
      if(withdraw)removed.push(id);
      const job=randomUUID(),data=JSON.stringify({version:1,id:job,documents,removed});
      if(Buffer.byteLength(data)>16*1024*1024) throw new Fault('quota',409);
      const temp=path.join(config.queue,`${job}.tmp`),dest=path.join(config.queue,`${job}.json`);
      writeFileSync(temp,data,{mode:0o600,flag:'wx'}); renameSync(temp,dest);
      store.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(job,id,revision,'queued',new Date().toISOString());
      store.audit(withdraw?'withdraw':'publish',id);res.status(202).json({id:job});
    });
  }
  app.use('/api',(_,res)=>res.status(404).json({error:'notFound'}));
  const escapeAttribute=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  const shell=readFileSync(path.join(publicDir,'index.html'),'utf8').replace('__BLOG_URL__',escapeAttribute(config.blogUrl??'https://blog.example.com')).replace('__VAULT_URL__',escapeAttribute(config.vaultUrl??'https://vault.example.com')).replace('<body>', '<body data-admin-url="'+escapeAttribute(config.adminUrl??'https://manage.example.com')+'">');
  app.get(['/','/index.html'],(req,res)=>{
    // Explicit sign-out lands on a stable screen instead of immediately re-entering SSO.
    if(!authenticated(req.session)&&req.query.signedOut!=='1')return res.redirect(303,'/auth/login');
    res.type('html').send(shell.replace('__EDITOR_NONCE__',res.locals.editorNonce));
  });
  app.use(express.static(publicDir,{index:false,dotfiles:'deny',etag:false,lastModified:false}));
  app.use((_,res)=>res.status(404).json({error:'notFound'}));
  app.use((error,req,res,next)=>{
    // Do not log request bodies, OIDC query strings, tokens or private content.
    const known=error instanceof Fault,invalid=error instanceof z.ZodError;
    if(!known&&!invalid) console.error(JSON.stringify({event:'request-error',type:error.name,code:error.code??'internal'}));
    res.status(known?error.status:invalid?400:error.type==='entity.too.large'?413:500).json({error:known?error.code:invalid?'invalid':'serverError'});
  });
  return {app,close:()=>sessions.store.stopInterval()};
}
