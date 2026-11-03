import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extensionTarget } from './extension-target.ts';

const target = extensionTarget();
const outdir = target.directory;
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));

if (target.browser === 'firefox') {
  Object.assign(manifest, JSON.parse(await readFile('extension/manifest.firefox.json', 'utf8')));
}

const pkg = JSON.parse(await readFile('package.json', 'utf8'));

if (manifest.version !== pkg.version) {
  throw new Error('Package and manifest versions must match.');
}

await mkdir(outdir, { recursive: true });
// Do not minify or add esbuild's keepNames helper to pageAgent: Chrome must be
// able to serialize this function without references to bundler helpers.
await build({
  entryPoints: {
    background: 'extension/background.ts',
    devtools: 'extension/devtools.ts',
    panel: 'src/inspector/panel.tsx',
  },
  outdir,
  bundle: true,
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'text' },
  minify: false,
});
await writeFile(outdir + '/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
await mkdir(outdir + '/icons', { recursive: true });

for (const size of [16, 24, 32, 48, 128]) {
  await copyFile(
    fileURLToPath(import.meta.resolve(`@react-anatomy/brand/png/icon-${size}.png`)),
    `${outdir}/icons/icon-${size}.png`,
  );
}

await copyFile('src/fonts.css', outdir + '/fonts.css');
await mkdir(outdir + '/licenses', { recursive: true });

for (const name of ['DM-Sans-OFL.txt', 'IBM-Plex-Mono-OFL.txt']) {
  await copyFile('licenses/' + name, outdir + '/licenses/' + name);
}

await copyFile(target.installNotes, outdir + '/README.md');
await writeFile(
  outdir + '/devtools.html',
  '<!doctype html><html><head><meta charset="utf-8"><title>React Anatomy</title><link rel="icon" href="icons/icon-32.png"></head><body><script src="devtools.js"></script></body></html>',
);
await writeFile(
  outdir + '/panel.html',
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>React Anatomy · React composition</title><link rel="stylesheet" href="fonts.css"></head><body><div id="root"></div><script src="panel.js"></script></body></html>',
);
console.log(`Built ${outdir} — ${target.browser} development extension`);

// An independently served, uninstrumented app for browser-level verification.
const fixture = await build({
  entryPoints: ['scripts/fixtures/app.tsx'],
  bundle: true,
  write: false,
  format: 'iife',
  keepNames: true,
  minify: true,
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.css': 'text' },
});

await writeFile(
  'dist/test-app.html',
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Orbit — independent React app</title><style>${await readFile('src/fonts.css', 'utf8')}</style></head><body><div id="app"></div><div id="portal"></div><div id="other-root"></div><script>${fixture.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`,
);
await writeFile(
  'dist/plain.html',
  '<!doctype html><html><head><title>Plain HTML</title></head><body><h1>This page does not use React.</h1></body></html>',
);

const deepFixture = await build({
  entryPoints: ['scripts/fixtures/deep-app.tsx'],
  bundle: true,
  write: false,
  format: 'iife',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});

await writeFile(
  'dist/deep-app.html',
  `<!doctype html><html><head><title>Deep production React app</title></head><body><div id="app"></div><script>${deepFixture.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`,
);

const layoutFixture = await build({
  entryPoints: ['scripts/fixtures/layout-app.tsx'],
  bundle: true,
  write: false,
  format: 'iife',
  minify: true,
  keepNames: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});

await writeFile(
  'dist/layout-app.html',
  `<!doctype html><html><head><title>Uneven React layout</title></head><body><div id="app"></div><script>${layoutFixture.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`,
);
