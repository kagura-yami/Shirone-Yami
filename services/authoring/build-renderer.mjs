import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('../..',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'));
mkdirSync(new URL('./generated/',import.meta.url),{recursive:true});
await build({stdin:{contents:`import {siteMarkdownProcessor} from './src/utils/markdown-processor.mjs'; export const renderer = await siteMarkdownProcessor.createRenderer({syntaxHighlight:false});`,resolveDir:root},bundle:true,minify:true,format:'esm',platform:'node',target:'node24',external:['sharp'],outfile:new URL('./generated/renderer.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'),banner:{js:"import {createRequire as cmsCreateRequire} from 'node:module';const require=cmsCreateRequire(import.meta.url);"}});
const manifest=JSON.parse(readFileSync(path.join(root,'src/plugins/markdown/manifest.json'),'utf8'));
writeFileSync(new URL('./public/syntaxes.json',import.meta.url),JSON.stringify(manifest.syntaxes.filter(s=>s.status==='stable'&&s.id!=='include').map(s=>({id:s.id,name:s.name,example:s.forms?.[0]?.example??''}))));
const styles=[...new Set(manifest.stylesheetPacks.flatMap(s=>s.styles))];
const css=await build({stdin:{contents:styles.map(s=>`@import "./${s}";`).join('\n')+'\n@import "katex/dist/katex.min.css";',resolveDir:root,loader:'css'},bundle:true,minify:true,write:false,outdir:path.join(root,'services/authoring/public'),assetNames:'preview-fonts/[name]-[hash]',publicPath:'/',loader:{'.woff2':'file','.woff':'file','.ttf':'file'}});
for(const file of css.outputFiles){
  if(file.path.endsWith('.css'))writeFileSync(new URL('./public/theme-style.mjs',import.meta.url),'export const themeStyle='+JSON.stringify(file.text)+';\n');
  else{mkdirSync(path.dirname(file.path),{recursive:true});writeFileSync(file.path,file.contents);}
}
