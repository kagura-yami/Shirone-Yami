import express from 'express';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdirSync,readdirSync,statSync,writeFileSync,readFileSync,realpathSync,existsSync } from 'node:fs';
import path from 'node:path';
import { Fault } from './content.mjs';

export function mediaRoutes(app,config,store){
  if(config.mode!=='admin')return;
  const root=config.media;mkdirSync(root,{recursive:true,mode:0o700});
  const list=()=>readdirSync(root).filter(n=>/^[0-9a-f-]{36}\.webp$/.test(n)).map(name=>({name,url:`/blog-media/${name}`,preview:`/api/media/${name}`,size:statSync(path.join(root,name)).size}));
  app.get('/api/media',(_,res)=>res.json(list()));
  app.post('/api/media',express.raw({type:['image/jpeg','image/png','image/webp','image/avif','image/gif'],limit:'10mb'}),async(req,res)=>{
    if(!Buffer.isBuffer(req.body)||!req.body.length)throw new Fault('invalid');
    const assets=list();if(assets.length>=1000||assets.reduce((n,f)=>n+f.size,0)>500*1024*1024)throw new Fault('quota',409);
    let bytes;try{bytes=await sharp(req.body,{limitInputPixels:25000000,animated:false}).rotate().resize({width:4096,height:4096,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();}catch{throw new Fault('invalid');}
    const name=randomUUID()+'.webp';writeFileSync(path.join(root,name),bytes,{flag:'wx',mode:0o600});store.audit('media-upload',name);
    res.status(201).json({name,url:`/blog-media/${name}`,preview:`/api/media/${name}`,size:bytes.length});
  });
  app.get('/api/media/:name',(req,res)=>{
    if(!/^[0-9a-f-]{36}\.webp$/.test(req.params.name))throw new Fault('notFound',404);
    const file=path.join(root,req.params.name);if(!existsSync(file))throw new Fault('notFound',404);
    res.type('image/webp').send(readFileSync(file));
  });
  app.get('/api/source-asset/:id',(req,res)=>{
    const doc=store.get(req.params.id),src=String(req.query.src??'');
    if(!config.source||(!doc.source&&!src.startsWith('/'))||!src||src.includes('\0')||src.includes('\\')||src.includes('%')||!(/\.(?:webp|png|jpe?g|gif|avif)$/i.test(src)))throw new Fault('notFound',404);
    const rootDir=path.resolve(config.source),publicDir=path.resolve(config.sourcePublic),base=src.startsWith('/')?publicDir:path.dirname(path.join(rootDir,doc.source));
    const file=path.resolve(base,src.startsWith('/')?src.slice(1):src);
    const inside=(r,p)=>p.startsWith(r+path.sep);
    if(!inside(src.startsWith('/')?publicDir:rootDir,file)||!existsSync(file)||!inside(src.startsWith('/')?publicDir:rootDir,realpathSync(file)))throw new Fault('notFound',404);
    // The checkout may live below .codex; sendFile's dotfile filter hides valid assets there.
    res.type(path.extname(file)).send(readFileSync(file));
  });
}
