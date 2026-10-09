// Local demonstration only. Production server.mjs never imports this module.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import express from 'express';
import { Store } from '../storage.mjs';
import { createApp } from '../app.mjs';
import { exportSnapshot } from '../export.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Demo is disabled in production');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const runtime = path.join(root, '.demo');
for (const dir of ['queue', 'results', 'media']) fs.mkdirSync(path.join(runtime, dir), { recursive: true });
const url = port => `http://127.0.0.1:${port}`;
const servers = [], resources = [];
let child, busy = false, stopping = false;
let site = path.join(runtime, 'current.json');
let current = fs.existsSync(site) ? JSON.parse(fs.readFileSync(site, 'utf8')).directory : path.join(root, 'dist');
if (!fs.existsSync(current)) throw new Error('Run pnpm build before starting the demo');
function localOnly(app, port) {
  app.use((req, res, next) => req.get('host') === `127.0.0.1:${port}` ? next() : res.sendStatus(403));
}
const web = express(); localOnly(web, 4322);
web.use((req, res, next) => express.static(current, { dotfiles: 'deny', etag: false, maxAge: 0 })(req, res, next));
servers.push(web.listen(4322, '127.0.0.1'));
for (const [mode, port] of [['admin', 18490], ['vault', 18491]]) {
  const keyFile = path.join(runtime, 'vault-key');
  if (mode === 'vault' && !fs.existsSync(keyFile)) fs.writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
  const store = new Store(path.join(runtime, `${mode}.sqlite3`), mode, mode === 'vault' ? fs.readFileSync(keyFile) : undefined);
  if (mode === 'admin') store.importSource(path.join(root, 'src/content'));
  const identity = {
    async begin() { const code = randomBytes(24).toString('hex'); return { url: `/auth/callback?code=${code}`, code, time: Date.now() }; },
    async finish(callback, pending) {
      if (new URL(callback).searchParams.get('code') !== pending.code) throw new Error('Invalid demo session');
      return { sub: 'local-demo' };
    },
  };
  const config = {
    mode, secure: false, origin: url(port), sessionSecret: randomBytes(48).toString('hex'),
    queue: path.join(runtime, 'queue'), results: path.join(runtime, 'results'), media: path.join(runtime, 'media'),
    source: path.join(root, 'src/content'), sourcePublic: path.join(root, 'public'),
    blogUrl: url(4322), adminUrl: url(18490), vaultUrl: url(18491),
  };
  const app = express(); localOnly(app, port);
  const workspace = createApp(config, store, identity); app.use(workspace.app);
  servers.push(app.listen(port, '127.0.0.1'));
  resources.push(() => { workspace.close(); store.close(); });
}
function result(id, state) {
  const file = path.join(runtime, 'results', `${id}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ state })); fs.renameSync(`${file}.tmp`, file);
}
// Interrupted builds fail visibly, rather than remaining queued indefinitely.
for (const file of fs.readdirSync(path.join(runtime, 'results'))) {
  if (file.endsWith('.json') && JSON.parse(fs.readFileSync(path.join(runtime, 'results', file))).state === 'building') result(file.slice(0, -5), 'failed');
}
async function publish() {
  if (busy || stopping) return;
  const file = fs.readdirSync(path.join(runtime, 'queue')).find(f => /^[0-9a-f-]{36}\.json$/.test(f) && !fs.existsSync(path.join(runtime, 'results', f)));
  if (!file) return;
  busy = true; const id = file.slice(0, -5); result(id, 'building');
  try {
    const build = path.join(runtime, `build-${id}`); fs.mkdirSync(build);
    for (const name of ['src', 'public', 'scripts', 'package.json', 'astro.config.mjs', 'svelte.config.js', 'tsconfig.json']) {
      fs.cpSync(path.join(root, name), path.join(build, name), { recursive: true });
    }
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(build, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    exportSnapshot(JSON.parse(fs.readFileSync(path.join(runtime, 'queue', file))), path.join(build, 'src/content'), path.join(runtime, 'media'), path.join(build, 'public'));
    const run = (script, args) => new Promise((resolve, reject) => {
      child = spawn(process.execPath, [script, ...args], { cwd: build, stdio: 'inherit', windowsHide: true,
        env: { ...process.env, SHIRONE_CONTENT_SYNC: '0' } });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Build exited ${code}`)));
    });
    await run(path.join(root, 'node_modules/astro/bin/astro.mjs'), ['build']);
    await run(path.join(root, 'node_modules/pagefind/lib/runner/bin.cjs'), ['--site', 'dist']);
    const directory = path.join(build, 'dist');
    if (!fs.existsSync(path.join(directory, 'index.html'))) throw new Error('Missing built homepage');
    fs.writeFileSync(`${site}.tmp`, JSON.stringify({ directory })); fs.renameSync(`${site}.tmp`, site);
    current = directory; result(id, 'succeeded'); console.log('Demo publication complete');
  } catch (error) { result(id, 'failed'); console.error(error.message); }
  finally { busy = false; child = undefined; }
}
const timer = setInterval(publish, 1500);
function stop() { stopping = true; clearInterval(timer); child?.kill(); for (const server of servers) server.close(); for (const close of resources) close(); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
console.log(`LOCAL DEMO — automatic login, never expose through a proxy or public tunnel.\nBlog: ${url(4322)}\nAdmin: ${url(18490)}\nDiary: ${url(18491)}\nData: .demo/ (ignored by Git). Stop: Ctrl+C.`);
