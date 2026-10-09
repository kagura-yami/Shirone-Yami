import session from 'express-session';
import memorystore from 'memorystore';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as oidc from 'openid-client';
import { Fault } from './content.mjs';

export const token = () => randomBytes(32).toString('base64url');
export function same(a,b) {
  return typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
export function sessionMiddleware(config) {
  const MemoryStore=memorystore(session);
  const store=new MemoryStore({checkPeriod:60000,max:500,ttl:30*60*1000});
  return {store,middleware:session({name:`${config.secure?'__Host-':'test-'}${config.mode}`,secret:config.sessionSecret,store,
    resave:false,saveUninitialized:false,rolling:true,
    cookie:{secure:config.secure,httpOnly:true,sameSite:'lax',path:'/',maxAge:30*60*1000}})};
}
export function authenticated(session) {
  return !!session?.user && Date.now()-session.created<=8*60*60*1000 && Date.now()-(session.activity??session.created)<=30*60*1000;
}
export function requireLogin(req,res,next) {
  if(!authenticated(req.session)) {
    req.session.destroy(()=>{}); return res.status(401).json({error:'signIn'});
  }
  if(req.get('X-Background')!=='1')req.session.activity=Date.now();
  next();
}
export function requireCsrf(origin) {
  return (req,res,next)=> {
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && (req.get('Origin')!==origin || !same(req.get('X-CSRF-Token'),req.session.csrf))) return next(new Fault('forbidden',403));
    next();
  };
}
export async function provider(config) {
  const client=await oidc.discovery(new URL(config.issuer),config.clientId,config.clientSecret);
  return identityFromClient(config,client);
}
export function identityFromClient(config,client) {
  oidc.enableNonRepudiationChecks(client);
  return {
    async begin() {
      const verifier=oidc.randomPKCECodeVerifier(),state=oidc.randomState(),nonce=oidc.randomNonce();
      const url=oidc.buildAuthorizationUrl(client,{redirect_uri:`${config.origin}/auth/callback`,scope:'openid profile',
        code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce});
      return {url:url.href,verifier,state,nonce,time:Date.now()};
    },
    async finish(url,pending) {
      const tokens=await oidc.authorizationCodeGrant(client,new URL(url),{pkceCodeVerifier:pending.verifier,expectedState:pending.state,expectedNonce:pending.nonce,idTokenExpected:true});
      const claims=tokens.claims();
      if(!claims || claims.sub!==config.subject || claims.iss!==config.issuer) throw new Fault('forbidden',403);
      // Authelia's registered client policy also enforces MFA. Fail closed if AMR is absent or weaker.
      if(!Array.isArray(claims.amr) || !claims.amr.includes('pwd') || !claims.amr.includes('otp')) throw new Fault('forbidden',403);
      return {sub:claims.sub,authTime:claims.auth_time};
    },
  };
}
export function authRoutes(app,config,identity,audit) {
  app.get('/auth/login',async(req,res)=> {
    const pending=await identity.begin();
    await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
    req.session.pending=pending;
    await new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
    res.redirect(303,pending.url);
  });
  app.get('/auth/callback',async(req,res)=> {
    const pending=req.session.pending; delete req.session.pending;
    if(!pending || Date.now()-pending.time>300000) throw new Fault('signIn',401);
    const user=await identity.finish(`${config.origin}${req.originalUrl}`,pending);
    await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
    req.session.user=user; req.session.created=Date.now(); req.session.csrf=token();
    audit('login');
    await new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
    res.redirect(303,'/');
  });
}
