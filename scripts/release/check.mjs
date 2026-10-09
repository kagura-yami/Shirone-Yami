import fs from 'node:fs';
import path from 'node:path';
import { root, releaseFiles } from './files.mjs';
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:ghp_|github_pat_|AKIA)[A-Za-z0-9_]{20,}/,
  /https?:\/\/[^\s/:]+:[^\s/@]+@(?!example\.invalid|github\.com\/OWNER|\.\.\.)/,
  /[A-Z]:\\(?:Users|Dev)\\/,
];
const files = releaseFiles(), errors = [];
for (const file of files) {
  const data = fs.readFileSync(path.join(root, file));
  if (data.includes(0) || /\.(webp|png|jpe?g|avif|woff2?|ttf|ico)$/i.test(file)) continue;
  if (file === 'scripts/release/check.mjs') continue;
  // This exact synthetic credential exercises the content-export redaction test.
  const text = file === 'tests/content/content-export.test.mjs'
    ? data.toString('utf8').replaceAll('ghp_0123456789abcdefghijklmnopqrstuvwxyz', 'SYNTHETIC_TEST_TOKEN')
    : data.toString('utf8');
  if (patterns.some(p => p.test(text))) errors.push(file);
}
if (errors.length) { console.error('Review possible private material in:\n'+errors.join('\n')); process.exit(1); }
if (process.argv.includes('--list')) console.log(JSON.stringify(files));
else console.log(`Release check passed: ${files.length} source files. Runtime, dependencies and generated bundles excluded. Pattern checks do not replace review of newly added content.`);
