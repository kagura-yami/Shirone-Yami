import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync,sign } from 'node:crypto';
import * as oidc from 'openid-client';
import { identityFromClient } from '../auth.mjs';

test('OIDC validates signatures, nonce, state, owner subject and two-factor claims',async()=>{
  const keys=generateKeyPairSync('rsa',{modulusLength:2048});
  const wrong=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...keys.publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'};
  let claims={},badSignature=false,origin='';
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/jwks'){res.end(JSON.stringify({keys:[jwk]}));return;}
    if(req.url==='/token'){
      for await(const _ of req){};
      const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
      const unsigned=`${b64({alg:'RS256',kid:'test',typ:'JWT'})}.${b64(claims)}`;
      const signature=sign('RSA-SHA256',Buffer.from(unsigned),badSignature?wrong.privateKey:keys.privateKey).toString('base64url');
      res.end(JSON.stringify({access_token:'test-access-token',token_type:'Bearer',expires_in:300,id_token:`${unsigned}.${signature}`}));return;
    }res.writeHead(404);res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  try{
    const client=new oidc.Configuration({issuer:origin,authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',jwks_uri:origin+'/jwks'},'test-client','test-secret');
    oidc.allowInsecureRequests(client); // Loopback mock only; production construction requires HTTPS.
    const identity=identityFromClient({issuer:origin,origin:'https://manage.example.test',subject:'owner'},client);
    const pending=await identity.begin();
    const good={iss:origin,sub:'owner',aud:'test-client',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,nonce:pending.nonce,amr:['pwd','otp'],auth_time:Math.floor(Date.now()/1000)};
    const url=`https://manage.example.test/auth/callback?code=test-code&state=${pending.state}`;
    claims=good;assert.equal((await identity.finish(url,pending)).sub,'owner');
    badSignature=true;await assert.rejects(()=>identity.finish(url,pending));badSignature=false;
    for(const changed of [{nonce:'wrong'},{sub:'someone-else'},{amr:['pwd']},{iss:'https://evil.example'},{aud:'wrong-client'},{exp:1}]){claims={...good,...changed};await assert.rejects(()=>identity.finish(url,pending));}
    claims=good;await assert.rejects(()=>identity.finish(url,{...pending,state:'wrong-state'}));
  }finally{await new Promise(resolve=>server.close(resolve));}
});
