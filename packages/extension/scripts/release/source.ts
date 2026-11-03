import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collect, repository } from './common.ts';

export async function sourceFiles(version: string) {
  const source: Record<string, Uint8Array> = {};

  for (const file of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'LICENSE',
    '.nvmrc',
    'packages/website/package.json',
    'packages/extension/package.json',
    'packages/extension/tsconfig.json',
    'packages/extension/scripts/build-extension.ts',
    'packages/extension/scripts/extension-target.ts',
  ]) {
    source[file] = new Uint8Array(await readFile(join(repository, file)));
  }

  for (const path of [
    'packages/brand',
    'packages/extension/extension',
    'packages/extension/src',
    'packages/extension/licenses',
    'packages/extension/scripts/fixtures',
  ]) {
    Object.assign(source, await collect(join(repository, path), path));
  }

  source['BUILDING.md'] = new TextEncoder().encode(
    `# React Anatomy ${version} source\n\nUse Node 24.22.1 and pnpm 12.16.1. Enable Corepack (corepack enable) to use the pinned package manager. From this directory:\n\n\`\`\`sh\npnpm install --frozen-lockfile\npnpm run build:firefox\npnpm run build:extension\n\`\`\`\n\nOutputs: packages/extension/dist/firefox and packages/extension/dist/extension. No credentials or external service accounts are needed. pnpm downloads the pinned dependencies in pnpm-lock.yaml.\n\nThis is the source needed to reproduce the extension, including original TypeScript/TSX, styles, fonts and licenses, fixtures used by the build, and shared brand assets. The website package manifest is present so pnpm can reproduce the workspace lockfile; website sources and private demo recordings are not part of this extension source submission. esbuild bundles the code without minification.\n`,
  );

  return source;
}
