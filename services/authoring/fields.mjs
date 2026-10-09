import { z } from 'zod';

// Author-owned fields from src/content.config.ts; generated prev/next fields are never writable.
const text=n=>z.string().max(n);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal(''));
const instant=z.string().datetime({offset:true}).or(z.literal(''));
const route=text(240).refine(v=>!v||(/^\/[\p{L}\p{N}/._~-]*$/u.test(v)&&!v.split('/').includes('..')));
export function safeUrl(value) {
  if(typeof value!=='string'||value.length>2000||/[\u0000-\u001f\\]/.test(value))return false;
  if(!value)return true;
  if(value.startsWith('//'))return false;
  if(/^[a-z][a-z0-9+.-]*:/i.test(value)){try{return ['http:','https:','mailto:'].includes(new URL(value).protocol);}catch{return false;}}
  return !value.includes('%') && !value.startsWith('~');
}
const asset=text(2000).refine(safeUrl);
export const metadataSchema=z.object({
  image:asset.optional(),publishedAt:instant.optional(),updated:date.optional(),updatedAt:instant.optional(),
  pinned:z.boolean().optional(),comment:z.boolean().optional(),series:text(100).optional(),seriesOrder:z.number().int().min(-100000).max(100000).nullable().optional(),
  lang:text(30).optional(),encrypted:z.boolean().optional(),password:text(200).optional(),passwordHint:text(300).optional(),hideHomeContent:z.boolean().optional(),
  alias:route.optional(),permalink:route.optional(),location:text(200).optional(),mood:text(150).optional(),
  images:z.array(z.object({src:asset,alt:text(300)}).strict()).max(30).optional(),
}).strict();
export function sourceMetadata(front){
  const result={};for(const key of Object.keys(metadataSchema.shape))if(front[key]!==undefined)result[key]=key==='password'?String(front[key]):front[key];
  return metadataSchema.parse(result);
}
