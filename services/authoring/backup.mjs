import { DatabaseSync } from 'node:sqlite';
import { readFileSync,writeFileSync,mkdirSync,unlinkSync,readdirSync,existsSync,lstatSync,renameSync } from 'node:fs';
import { randomBytes,createCipheriv,createDecipheriv } from 'node:crypto';
import { gzipSync,gunzipSync } from 'node:zlib';
// Whole-file backup uses AES-256-GCM and a separate backup key. Plain snapshots stay on tmpfs.
const key=Buffer.from(readFileSync('/run/secrets/backup-key','utf8').trim(),'hex');
if(key.length!==32)throw new Error('Invalid backup key');
const mode=process.argv[2];
function mediaBackup(verify=false){
  if(verify){
    if(!existsSync('/backup/media'))return;
    let count=0;for(const name of readdirSync('/backup/media')){
      if(!/^[0-9a-f-]{36}\.webp\.enc$/.test(name))continue;
      const b=readFileSync('/backup/media/'+name);if(b.subarray(0,8).toString()!=='BLOGMED1')throw new Error('Invalid media backup');
      const d=createDecipheriv('aes-256-gcm',key,b.subarray(8,20));d.setAAD(Buffer.from('blog-media-v1:'+name.slice(0,-4)));d.setAuthTag(b.subarray(20,36));
      const plain=Buffer.concat([d.update(b.subarray(36)),d.final()]);if(plain.subarray(0,4).toString()!=='RIFF'||plain.subarray(8,12).toString()!=='WEBP')throw new Error('Invalid restored media');count++;
    }console.log('Encrypted media verified:',count);return;
  }
  if(!existsSync('/data/media'))return;
  mkdirSync('/backup/media',{recursive:true,mode:0o700});
  for(const name of readdirSync('/data/media')){
    if(!/^[0-9a-f-]{36}\.webp$/.test(name))continue;
    const source='/data/media/'+name,target='/backup/media/'+name+'.enc';
    if(lstatSync(source).isSymbolicLink())throw new Error('Symlink media');if(existsSync(target))continue;
    const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from('blog-media-v1:'+name));
    const body=Buffer.concat([cipher.update(readFileSync(source)),cipher.final()]);
    writeFileSync(target+'.tmp',Buffer.concat([Buffer.from('BLOGMED1'),nonce,cipher.getAuthTag(),body]),{mode:0o600,flag:'w'});renameSync(target+'.tmp',target);
  }
}
if(mode==='create'){
  const db=new DatabaseSync('/data/content.sqlite3',{readOnly:true});
  db.exec("VACUUM INTO '/tmp/snapshot.sqlite3'");db.close();
  mediaBackup();
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from('blog-backup-v1'));
  const body=Buffer.concat([cipher.update(gzipSync(readFileSync('/tmp/snapshot.sqlite3'))),cipher.final()]);
  const output=Buffer.concat([Buffer.from('BLOGBAK1'),nonce,cipher.getAuthTag(),body]);
  mkdirSync('/backup',{recursive:true});const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  writeFileSync(`/backup/${stamp}.enc`,output,{mode:0o600,flag:'wx'});unlinkSync('/tmp/snapshot.sqlite3');
  console.log('Encrypted backup created.');
}else if(mode==='verify'){
  const b=readFileSync(process.argv[3]);if(b.subarray(0,8).toString()!=='BLOGBAK1')throw new Error('Invalid backup');
  const decipher=createDecipheriv('aes-256-gcm',key,b.subarray(8,20));decipher.setAAD(Buffer.from('blog-backup-v1'));decipher.setAuthTag(b.subarray(20,36));
  const plain=gunzipSync(Buffer.concat([decipher.update(b.subarray(36)),decipher.final()]));
  writeFileSync('/tmp/restored.sqlite3',plain,{mode:0o600,flag:'wx'});
  const db=new DatabaseSync('/tmp/restored.sqlite3');const check=db.prepare('PRAGMA integrity_check').get();
  if(check.integrity_check!=='ok')throw new Error('Restore integrity failed');
  console.log('Restored database integrity verified; records:',db.prepare('SELECT count(*) AS n FROM documents').get().n);
  db.close();unlinkSync('/tmp/restored.sqlite3');mediaBackup(true);
}else throw new Error('Unknown backup operation');
