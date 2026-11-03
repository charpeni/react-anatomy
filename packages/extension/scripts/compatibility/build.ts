import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const destination = 'artifacts/compatibility/apps';

await mkdir(destination, { recursive: true });

const modules = resolve('validation/node_modules');
const versions = ['18-2', '18-3', '19-0', '19-1', '19-2', '19-3'];
const cases = [];

for (const version of versions) {
  const suffix = version === '19-3' ? '' : '-' + version;
  const reactPath = resolve(modules, 'react' + suffix);
  const domPath = resolve(modules, 'react-dom' + suffix);
  const react = JSON.parse(await readFile(reactPath + '/package.json', 'utf8')).version;

  for (const mode of ['development', 'production']) {
    const id = `router-${react}-${mode}`;

    cases.push({ id, kind: 'router', mode, react });
    await compile(id, 'validation/workspace.tsx', mode, reactPath, domPath);
  }

  if (['18-3', '19-3'].includes(version)) {
    const id = `excalidraw-${react}`;

    cases.push({
      id,
      kind: 'editor',
      mode: 'production',
      react,
      application: '@excalidraw/excalidraw@0.18.1',
    });
    await compile(id, 'validation/excalidraw.tsx', 'production', reactPath, domPath);
  }
}

async function compile(
  id: string,
  entry: string,
  mode: string,
  reactPath: string,
  domPath: string,
) {
  await build({
    entryPoints: [entry],
    outfile: `${destination}/${id}/app.js`,
    bundle: true,
    format: 'iife',
    minify: mode === 'production',
    conditions: [mode],
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    alias: {
      react: reactPath,
      'react-dom': domPath,
      'react-router-dom': resolve(modules, 'react-router-dom'),
    },
    loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file' },
    logLevel: 'warning',
  });
  await writeFile(
    `${destination}/${id}/index.html`,
    `<!doctype html><html><head><meta charset="utf-8"><title>${id}</title><link rel="stylesheet" href="/${id}/app.css"></head><body data-base="/${id}"><div id="app"></div><script src="/${id}/app.js"></script></body></html>`,
  );
}

await writeFile('artifacts/compatibility/cases.json', JSON.stringify(cases, null, 2) + '\n');
console.log(`Built ${cases.length} pinned React/router/Excalidraw workloads.`);
