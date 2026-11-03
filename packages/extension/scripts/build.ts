import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

const result = await build({
  entryPoints: ['src/prototype.tsx'],
  bundle: true,
  write: false,
  minify: true,
  keepNames: true,
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.css': 'text' },
});
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const fonts = await readFile('src/fonts.css', 'utf8');

await writeFile(
  'dist/prototype.html',
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>React Anatomy — React composition prototype</title><style>${fonts}</style></head><body><div id="root"></div><script>${script}</script></body></html>`,
);
console.log('Built dist/prototype.html — self-contained React prototype');
