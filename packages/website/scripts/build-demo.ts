import { type BuildOptions, build } from 'esbuild';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const outdir = fileURLToPath(new URL('../public/interactive/', import.meta.url));

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

await mkdir(outdir, { recursive: true });

const options: BuildOptions = {
  bundle: true,
  format: 'iife',
  minify: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'text' },
  legalComments: 'inline',
};

await build({
  ...options,
  entryPoints: [source('../demo/source.ts')],
  outfile: outdir + '/source.js',
});
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
await copyFile(source('../demo/source.css'), outdir + '/source.css');
await copyFile(source('../demo/panel.css'), outdir + '/panel.css');
await copyFile(
  fileURLToPath(import.meta.resolve('@react-anatomy/extension/fonts.css')),
  outdir + '/fonts.css',
);

for (const [name, title, body] of [
  ['source', 'Orbit — interactive example', '<div id="app"></div><div id="portal"></div>'],
  ['panel', 'Anatomy — example inspector', '<div id="root"></div>'],
]) {
  await writeFile(
    `${outdir}/${name}.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="./fonts.css"><link rel="stylesheet" href="./${name}.css"></head><body>${body}<script src="./${name}.js"></script></body></html>`,
  );
}

console.log(
  'Built interactive example with the extension’s capture engine, 3D viewer, and props inspector.',
);
