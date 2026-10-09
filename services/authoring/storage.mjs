import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { Fault, idSchema, validateDocument } from './content.mjs';
import { sourceEntries } from './legacy.mjs';
import { validateAssetReferences } from './rich-markdown.mjs';

export function seal(key, value, aad) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({v:1,n:nonce.toString('base64'),t:cipher.getAuthTag().toString('base64'),c:body.toString('base64')});
}
export function unseal(key, value, aad) {
  const p = JSON.parse(value);
  if (p.v !== 1) throw new Error('Unsupported encrypted record');
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(p.n,'base64'));
  cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(Buffer.from(p.t,'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(p.c,'base64')),cipher.final()]).toString('utf8'));
}
export class Store {
  constructor(path, mode, key) {
    this.mode=mode; this.key=key;
    if (mode === 'vault' && key?.length !== 32) throw new Error('Vault key required');
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, approved TEXT, published_revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, time TEXT NOT NULL, action TEXT NOT NULL, resource TEXT NOT NULL);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS legacy(id TEXT PRIMARY KEY, source_path TEXT NOT NULL, original_body TEXT NOT NULL, protected_body INTEGER NOT NULL, source_hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS withdrawals(id TEXT PRIMARY KEY);');
  }
  encode(id, d) { return this.mode==='vault' ? seal(this.key,d,`diary:v1:${id}`) : JSON.stringify(d); }
  decode(row) { return this.mode==='vault' ? unseal(this.key,row.payload,`diary:v1:${row.id}`) : JSON.parse(row.payload); }
  audit(action, id='') { this.db.prepare('INSERT INTO audit(time,action,resource) VALUES(?,?,?)').run(new Date().toISOString(),action,id); }
  list() { return this.db.prepare('SELECT * FROM documents ORDER BY updated DESC LIMIT 1001').all().map(r=>{
    const {title,date,kind,tags}=this.decode(r);const source=this.db.prepare('SELECT source_path FROM legacy WHERE id=?').get(r.id); return {id:r.id,revision:r.revision,updated:r.updated,deleted:!!r.deleted,publishedRevision:r.published_revision,title,date,kind,tags,source:source?.source_path??null};
  }); }
  get(id) {
    idSchema.parse(id); const r=this.db.prepare('SELECT * FROM documents WHERE id=?').get(id);
    if(!r) throw new Fault('notFound',404);
    const source=this.db.prepare('SELECT source_path,protected_body,source_hash FROM legacy WHERE id=?').get(id);
    return {id:r.id,revision:r.revision,updated:r.updated,deleted:!!r.deleted,publishedRevision:r.published_revision,...this.decode(r),source:source?.source_path??null,protectedBody:!!source?.protected_body,sourceHash:source?.source_hash??null};
  }
  save(value, id, revision=0) {
    const legacy=id?this.db.prepare('SELECT * FROM legacy WHERE id=?').get(id):null;
    const d=validateDocument(value,this.mode,legacy?.original_body,legacy?.source_path.endsWith('.mdx')); const now=new Date().toISOString();
    try{validateAssetReferences(d,id?this.get(id):{});}catch{throw new Fault('unsafeMarkdown');}
    if(legacy&&this.get(id).kind!==d.kind)throw new Fault('invalid');
    if(!id) {
      if(this.db.prepare('SELECT count(*) AS n FROM documents').get().n>=1000) throw new Fault('quota',409);
      id=randomUUID(); this.db.prepare('INSERT INTO documents(id,revision,payload,updated) VALUES(?,1,?,?)').run(id,this.encode(id,d),now);
    } else {
      idSchema.parse(id);
      const result=this.db.prepare('UPDATE documents SET revision=revision+1,payload=?,updated=? WHERE id=? AND revision=? AND deleted=0').run(this.encode(id,d),now,id,revision);
      if(!result.changes) throw new Fault('conflict',409);
    }
    this.audit('save',id); return this.get(id);
  }
  trash(id, revision, deleted) {
    idSchema.parse(id);
    const r=this.db.prepare('UPDATE documents SET deleted=?,revision=revision+1,updated=? WHERE id=? AND revision=? AND published_revision=0').run(deleted?1:0,new Date().toISOString(),id,revision);
    if(!r.changes) throw new Fault('conflict',409);
    this.audit(deleted?'trash':'restore',id); return this.get(id);
  }
  close() { this.db.close(); }
  importSource(root) {
    if(this.mode!=='admin')throw new Error('Only admin imports blog content');
    let count=0;
    for(const source of sourceEntries(root)){
      if(this.db.prepare('SELECT id FROM documents WHERE id=?').get(source.id)){
        this.db.prepare('UPDATE legacy SET protected_body=? WHERE id=? AND source_hash=?').run(source.relative.endsWith('.mdx')?1:0,source.id,source.hash);
        const row=this.db.prepare('SELECT * FROM documents WHERE id=?').get(source.id),payload=JSON.parse(row.payload);
        if(!payload.metadata){payload.metadata=source.document.metadata;const approved=row.approved?{...JSON.parse(row.approved),metadata:source.document.metadata,protectedBody:false}:null;this.db.prepare('UPDATE documents SET payload=?,approved=? WHERE id=?').run(JSON.stringify(payload),approved?JSON.stringify(approved):null,source.id);}
        continue;
      }
      const now=new Date().toISOString();
      this.db.exec('BEGIN IMMEDIATE');
      try{
        this.db.prepare('INSERT INTO documents(id,revision,payload,updated,published_revision) VALUES(?,1,?,?,?)').run(source.id,JSON.stringify(source.document),now,source.published?1:0);
        this.db.prepare('INSERT INTO legacy VALUES(?,?,?,?,?)').run(source.id,source.relative,source.body,source.relative.endsWith('.mdx')?1:0,source.hash);
        if(source.published)this.db.prepare('UPDATE documents SET approved=? WHERE id=?').run(JSON.stringify(this.get(source.id)),source.id);
        this.db.exec('COMMIT');count++;
      }catch(e){this.db.exec('ROLLBACK');throw e;}
    }
    this.audit('source-import');return count;
  }
}
