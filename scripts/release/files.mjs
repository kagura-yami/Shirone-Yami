import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../../', import.meta.url));
const directories = new Set(['src','public','services','deploy','scripts','docs','rules','tests','.agents','.github']);
const rootFiles = new Set(['README.md','LICENSE','DESIGN.md','.gitattributes','.gitignore','.npmrc','.env.example','package.json','pnpm-lock.yaml','astro.config.mjs','svelte.config.js','tsconfig.json','biome.json','playwright.config.ts','pagefind.yml','shirone.content.example.json']);
const ignored = new Set(['node_modules','generated','.subset','.astro','.demo','dist','.git','preview-fonts','__pycache__']);
const generated = new Set(['copy.json','editor.bundle.mjs','syntaxes.json','theme-style.mjs']);
export function releaseFiles() {
  const files = [];
  function walk(relative = '') {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = entry.name, next = relative ? `${relative}/${name}` : name;
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not publishable: ${next}`);
      if (entry.isDirectory()) {
        if (!ignored.has(name) && (relative || directories.has(name))) walk(next);
      } else if ((relative || rootFiles.has(name)) && !(next.startsWith('services/authoring/public/') && generated.has(name))) {
        if (/^(\.env(?:\..+)?|config\.json)$/i.test(name) && name !== '.env.example') throw new Error(`Private config: ${next}`);
        if (/\.(sqlite\d*(?:-wal|-shm)?|db|pem|key|log|zip|bak|pyc)$/i.test(name)) throw new Error(`Private or generated file: ${next}`);
        files.push(next);
      }
    }
  }
  walk(); return files.sort();
}
