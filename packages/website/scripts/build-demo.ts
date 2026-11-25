import { type BuildOptions, build } from 'esbuild';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  analyzeUnusedPropsFixture,
  UNUSED_PROPS_ROOT,
} from '../../extension/scripts/unused-props/build-fixture.ts';
import { anatomySourcePlugin } from '../../extension/scripts/source-trace/esbuild-plugin.ts';

const outdir = fileURLToPath(new URL('../public/interactive/', import.meta.url));

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

await mkdir(outdir, { recursive: true });

const options: BuildOptions = {
  bundle: true,
  format: 'iife',
  minify: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'text', '.jpg': 'dataurl' },
  legalComments: 'inline',
};

await build({
  ...options,
  entryPoints: [source('../demo/source.ts')],
  outfile: outdir + '/source.js',
});
await build({
  ...options,
  entryPoints: [source('../demo/bridge.ts')],
  outfile: outdir + '/bridge.js',
});
await build({
  ...options,
  entryPoints: [source('../../extension/scripts/fixtures/context-app.tsx')],
  keepNames: true,
  outfile: outdir + '/context.js',
});
const billingRoot = source('../../extension/' + UNUSED_PROPS_ROOT);
await build({
  ...options,
  entryPoints: [billingRoot + '/main.tsx'],
  keepNames: true,
  outfile: outdir + '/billing.js',
  plugins: [anatomySourcePlugin({ root: billingRoot })],
});
await writeFile(
  outdir + '/billing-analysis.json',
  JSON.stringify(analyzeUnusedPropsFixture(billingRoot)),
);
await build({
  ...options,
  entryPoints: [fileURLToPath(import.meta.resolve('@react-anatomy/extension/inspector/panel.tsx'))],
  outfile: outdir + '/panel.js',
  plugins: [
    {
      name: 'bundled-example-transport',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/transport\.ts$/ }, () => ({
          path: source('../demo/transport.ts'),
        }));
      },
    },
  ],
});
await copyFile(source('../demo/billing.css'), outdir + '/billing.css');
await copyFile(source('../demo/context.css'), outdir + '/context.css');
await copyFile(source('../demo/source.css'), outdir + '/source.css');
await copyFile(source('../demo/panel.css'), outdir + '/panel.css');
await build({
  bundle: true,
  entryPoints: [source('../demo/guide-target.css')],
  outfile: outdir + '/guide-target.css',
});
await copyFile(
  fileURLToPath(import.meta.resolve('@react-anatomy/extension/fonts.css')),
  outdir + '/fonts.css',
);

for (const [name, title, body] of [
  ['source', 'Orbit — interactive example', '<div id="app"></div><div id="portal"></div>'],
  [
    'context',
    'Context providers',
    '<div id="app"></div><div id="context-portal"></div><div id="context-other-root"></div>',
  ],
  ['billing', 'Billing plans', '<div id="app"></div>'],
  ['panel', 'Anatomy — example inspector', '<div id="root"></div>'],
]) {
  await writeFile(
    `${outdir}/${name}.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="./fonts.css"><link rel="stylesheet" href="./${name}.css"><link rel="stylesheet" href="./guide-target.css"></head><body>${body}<script src="./${name}.js"></script>${name === 'panel' ? '' : '<script src="./bridge.js"></script>'}</body></html>`,
  );
}

console.log(
  'Built interactive example with the extension’s capture engine, 3D viewer, and props inspector.',
);
