import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

const result = await build({
  entryPoints: ['scripts/demo/app.tsx'],
  bundle: true,
  write: false,
  format: 'iife',
  keepNames: true,
  minify: true,
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.css': 'text' },
});

await writeFile(
  'dist/demo-app.html',
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Orbit — sample React app</title></head><body><div id="app"></div><div id="portal"></div><script>${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`,
);
