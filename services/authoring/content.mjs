import { z } from 'zod';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import MarkdownIt from 'markdown-it';
import sanitize from 'sanitize-html';
import { metadataSchema } from './fields.mjs';
import { validateRichMarkdown } from './rich-markdown.mjs';

export class Fault extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const idSchema = z.string().uuid();
export const documentSchema = z.object({
  kind: z.enum(['posts', 'moments', 'diary']),
  title: z.string().trim().min(1).max(160),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().startsWith(v)),
  description: z.string().max(500).default(''),
  category: z.string().max(60).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  body: z.string().max(100000),
  metadata: metadataSchema.default({}),
}).strict();
const parser = unified().use(remarkParse).use(remarkStringify, { fences: true });
const allowed = new Set(['root', 'paragraph', 'text', 'heading', 'emphasis', 'strong', 'blockquote', 'list', 'listItem', 'code', 'inlineCode', 'break', 'thematicBreak', 'link']);
export function safeTree(body) {
  const tree = parser.parse(body);
  let count = 0;
  function visit(node, depth) {
    if (++count > 12000 || depth > 30 || !allowed.has(node.type)) throw new Fault('unsafeMarkdown');
    if (node.type === 'link') {
      let u; try { u = new URL(node.url); } catch { throw new Fault('unsafeMarkdown'); }
      if (!['https:', 'http:', 'mailto:'].includes(u.protocol)) throw new Fault('unsafeMarkdown');
    }
    // Code is rendered as text only; language/meta cannot enable Mermaid or theme-specific executable extensions.
    if (node.type === 'code') { node.lang = null; node.meta = null; }
    for (const child of node.children ?? []) visit(child, depth + 1);
  }
  visit(tree, 0); return tree;
}
export function validateDocument(value, mode, trustedBody,mdx=false) {
  const d = documentSchema.parse(value);
  if ((mode === 'vault') !== (d.kind === 'diary')) throw new Fault('wrongSpace');
  try { validateRichMarkdown(d.body,{original:trustedBody??'',mdx}); } catch { throw new Fault('unsafeMarkdown'); }
  return d;
}
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
export function preview(body) {
  safeTree(body);
  return sanitize(markdown.render(body), {
    allowedTags: ['p','h1','h2','h3','h4','h5','h6','em','strong','blockquote','ul','ol','li','pre','code','br','hr','a'],
    allowedAttributes: { a: ['href','rel','target'] }, allowedSchemes: ['http','https','mailto'],
    transformTags: { a: (_, attrs) => ({ tagName: 'a', attribs: { href: attrs.href ?? '', rel: 'noreferrer noopener', target: '_blank' } }) },
  });
}
// Serialize only approved AST into HTML, then publish the sanitized HTML body.
// This prevents Shirone's custom Markdown directives/includes from reinterpreting text.
export function publishedBody(body) { return preview(parser.stringify(safeTree(body))); }
