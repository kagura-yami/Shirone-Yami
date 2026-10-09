import {build} from 'esbuild';
await build({entryPoints:[new URL('./client/editor.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1')],outfile:new URL('./public/editor.bundle.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'),bundle:true,minify:true,format:'esm',platform:'browser',target:['es2022'],legalComments:'eof'});
