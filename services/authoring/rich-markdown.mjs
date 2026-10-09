import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkDirective from 'remark-directive';
import { parseDocument } from 'htmlparser2';
import { safeUrl } from './fields.mjs';

const parser=unified().use(remarkParse).use(remarkDirective),mdxParser=unified().use(remarkParse).use(remarkMdx);
const directiveNames=new Set('tip note info important caution warning details collapse tabs field field-group steps file-tree code-tree github grid spoiler m3-mark audio-reader artplayer bilibili acfun youtube active'.split(' '));
const allowedTags=new Set('p div span section article header footer aside h1 h2 h3 h4 h5 h6 strong em b i u s del mark abbr blockquote pre code ul ol li dl dt dd table thead tbody tfoot tr td th details summary a img br hr figure figcaption video audio source track iframe kbd sup sub input'.split(' '));
const dynamicTypes=new Set(['mdxjsEsm','mdxFlowExpression','mdxTextExpression']);
const fail=()=>{throw Object.assign(new Error('unsafeMarkdown'),{name:'MarkdownPolicyError'});};
function walk(node,fn){fn(node);for(const child of node.children??[])walk(child,fn);}
function attributes(attrs){
  for(const [name,value] of Object.entries(attrs)){
    if(/^on/i.test(name)||['srcdoc','formaction'].includes(name.toLowerCase()))fail();
    if(['href','src','poster'].includes(name)&&!safeUrl(String(value)))fail();
    if(name==='style'&&/(?:url\s*\(|expression\s*\(|@import|behavior\s*:)/i.test(value))fail();
  }
}
function html(value){walk(parseDocument(value),node=>{
  if(['tag','script','style'].includes(node.type)){
    if(!allowedTags.has(node.name))fail();attributes(node.attribs??{});
    if(node.name==='iframe'){
      let url;try{url=new URL(node.attribs.src);}catch{fail();}
      if(url.protocol!=='https:'||!['www.youtube.com','www.youtube-nocookie.com','player.bilibili.com'].includes(url.hostname))fail();
    }
    if(node.name==='input'&&node.attribs.type!=='checkbox')fail();
  }
});}
function fileDirectives(tree,body){
  // Ignore examples inside fenced/inline code. File-reading constructs may only retain their original spelling.
  let source=body;const ranges=[];walk(tree,n=>{if(['code','inlineCode'].includes(n.type))ranges.push([n.position.start.offset,n.position.end.offset]);});
  for(const [a,b] of ranges.sort((a,b)=>b[0]-a[0]))source=source.slice(0,a)+' '.repeat(b-a)+source.slice(b);
  if(/(?:[\s{])on[a-z]+\s*=/i.test(source))fail();
  const tokens=[...source.matchAll(/<!--[\s\S]*?@include[\s\S]*?-->|@\[code-tree[^\n]*|:{2,}code-tree[^\n]*\bdir\s*=[^\n]*/g)].map(m=>m[0]);
  walk(tree,n=>{if(n.name==='code-tree'&&n.attributes?.dir)tokens.push('directory:'+n.attributes.dir);});return tokens;
}
export function validateRichMarkdown(body,{original='',mdx=false}={}){
  if(mdx){if(body!==original)fail();return body;}
  const parse=mdx?mdxParser:parser;
  let tree,baseline;try{tree=parse.parse(body);baseline=parse.parse(original);}catch{fail();}
  const trustedFiles=new Set(fileDirectives(baseline,original));
  for(const item of fileDirectives(tree,body))if(!trustedFiles.has(item))fail();
  const trustedCode=new Set(),components=new Set();walk(baseline,n=>{
    if(dynamicTypes.has(n.type))trustedCode.add(n.value);
    if(n.type.startsWith('mdxJsx')){components.add(n.name);for(const a of n.attributes??[])if(typeof a.value==='object'&&a.value)trustedCode.add(a.value.value);}
  });
  let count=0;walk(tree,n=>{
    if(++count>20000)fail();
    if(n.type==='html')html(n.value);
    if(n.type.endsWith('Directive')){if(!directiveNames.has(n.name)&&!/^\d+$/.test(n.name))fail();attributes(n.attributes??{});}
    if(['link','image','definition'].includes(n.type)&&!safeUrl(n.url))fail();
    if(dynamicTypes.has(n.type)&&!trustedCode.has(n.value))fail();
    if(n.type.startsWith('mdxJsx')){
      if(n.name&&!allowedTags.has(n.name)&&!components.has(n.name))fail();
      const attrs={};for(const a of n.attributes??[]){
        if(a.type==='mdxJsxExpressionAttribute')fail();
        if(a.value&&typeof a.value==='object'){if(!trustedCode.has(a.value.value))fail();}
        else attrs[a.name]=a.value??'';
      }attributes(attrs);
    }
  });
  return body;
}

// New images use uploads or site-local assets. Existing remote images may be retained,
// but CMS input cannot introduce arbitrary build-time HTTP targets or filesystem traversal.
export function validateAssetReferences(document,original={}){
  function collect(d){
    const result=[d.metadata?.image,...(d.metadata?.images??[]).map(i=>i.src)].filter(Boolean);
    const tree=parser.parse(d.body??''),definitions=new Map();walk(tree,n=>{if(n.type==='definition')definitions.set(n.identifier,n.url);});
    walk(tree,n=>{
      if(n.type==='image')result.push(n.url);
      if(n.type==='imageReference'&&definitions.has(n.identifier))result.push(definitions.get(n.identifier));
      if(n.type==='html')walk(parseDocument(n.value),el=>{for(const key of ['src','poster'])if(el.attribs?.[key])result.push(el.attribs[key]);});
      for(const key of ['src','poster','image'])if(n.attributes?.[key])result.push(n.attributes[key]);
    });return result;
  }
  const trusted=new Set(collect(original));
  for(const value of collect(document))if(!trusted.has(value)&&(/^[a-z][a-z0-9+.-]*:/i.test(value)||value.startsWith('//')||value.split('/').includes('..')))fail();
}
