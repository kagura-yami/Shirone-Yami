import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,statSync,existsSync} from 'node:fs';
const hash=createHash('sha256');
const excluded=['src/content','src/generated','src/assets/fonts/.subset'];
function walk(p){if(excluded.some(x=>p===x||p.startsWith(x+'/')))return;if(statSync(p).isDirectory()){for(const n of readdirSync(p).sort())walk(p+'/'+n);}else{hash.update(p+'\0');hash.update(readFileSync(p));}}
for(const p of ['src','scripts','rules','docs','.agents','deploy'])if(existsSync(p))walk(p);
for(const p of readdirSync('.').sort())if(statSync(p).isFile()&&!p.startsWith('.env')){hash.update(p+'\0');hash.update(readFileSync(p));}
console.log(hash.digest('hex'));
