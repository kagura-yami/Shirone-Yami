#!/bin/sh
set -eu
if [ ! -f node_modules/.blog-dependencies-ready ]; then
  pnpm install --frozen-lockfile --store-dir /pnpm-store
  touch node_modules/.blog-dependencies-ready
else
  printf '%s\n' '[cache] Reusing installed dependencies'
fi
key=$(node deploy/check-key.mjs)
previous=$(cat node_modules/.blog-check-key 2>/dev/null || true)
if [ "$key" != "$previous" ]; then
  # Font subset stamps otherwise only track characters, not changed font files.
  node --input-type=module -e 'import{readdirSync,unlinkSync,mkdirSync}from"node:fs";const p="src/assets/fonts/.subset/";mkdirSync(p,{recursive:true});for(const n of readdirSync(p))if(n.endsWith(".stamp"))unlinkSync(p+n);'
  pnpm exec astro check
  pnpm check:manifest
  printf '%s' "$key" > node_modules/.blog-check-key
else
  printf '%s\n' '[cache] Theme unchanged; content is revalidated by exporter and build'
fi
pnpm build
