import { fork } from 'node:child_process';
import sanitize from 'sanitize-html';
let running=false;
export async function themePreview(body){
  if(running)throw Object.assign(new Error('busy'),{status:409});running=true;
  try{
    const html=await new Promise((resolve,reject)=>{
      const child=fork(new URL('./render-worker.mjs',import.meta.url),[],{execArgv:['--max-old-space-size=128'],stdio:['ignore','ignore','ignore','ipc'],env:{NODE_ENV:'production'}});
      let settled=false;const end=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill();error?reject(error):resolve(value);};
      const timer=setTimeout(()=>end(new Error('Preview timeout')),15000);
      child.on('error',e=>end(e));child.on('exit',()=>end(new Error('Preview exited')));child.on('message',m=>m.error?end(new Error('Preview failed')):end(null,m.html));child.send(body);
    });
    return sanitize(html,{allowedTags:[...sanitize.defaults.allowedTags,'img','aside','section','figure','figcaption','details','summary','button','input','svg','path','line','circle','rect'],allowedAttributes:{'*':['class','id','style','title','role','aria-*','data-*'],'img':['src','alt','width','height','loading','referrerpolicy'],a:['href','rel','target'],details:['open'],input:['type','checked','disabled'],svg:['viewBox','width','height','fill','stroke'],path:['d','fill','stroke'],button:['type','disabled']},allowedSchemes:['https','http','mailto'],allowProtocolRelative:false,transformTags:{a:(_,a)=>({tagName:'a',attribs:{...a,rel:'noreferrer noopener',target:'_blank'}}),img:(_,a)=>({tagName:'img',attribs:{...a,referrerpolicy:'no-referrer'}})}});
  }finally{running=false;}
}
