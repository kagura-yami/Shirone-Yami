import { renderer } from './generated/renderer.mjs';
process.on('message',async body=>{
  try{const result=await renderer.render(body);process.send({html:result.code});}catch{process.send({error:true});}
});
