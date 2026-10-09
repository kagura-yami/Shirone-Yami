import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Text} from '@codemirror/state';
import {markdownLanguage} from '@codemirror/lang-markdown';
import {imageNodes} from '../client/image-nodes.mjs';
const images=source=>imageNodes(markdownLanguage.parser.parse(source),Text.of(source.split('\n')));
test('Inline image projection preserves Unicode, nested URLs and reference images',()=>{
 const source='中文 ![封面](https://example.com/a(b).webp)\n\n![说明][photo]\n\n[photo]: /blog-media/test.webp';
 const result=images(source);assert.equal(result.length,2);assert.equal(result[0].alt,'封面');assert.equal(result[0].src,'https://example.com/a(b).webp');assert.equal(result[1].src,'/blog-media/test.webp');assert.equal(source.slice(result[0].from,result[0].to),'![封面](https://example.com/a(b).webp)');
});
test('Code examples and HTML never become editor image widgets',()=>{
 assert.deepEqual(images('`![inline](/a.png)`\n\n```md\n![fenced](/b.png)\n```\n\n<img src="/c.png" onerror="alert(1)">'),[]);
});
