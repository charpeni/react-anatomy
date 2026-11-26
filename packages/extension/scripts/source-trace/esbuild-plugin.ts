import type { Plugin } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { instrumentSource } from './instrument.ts';
import { isSourcePath, projectPath, stripBom } from './shared.ts';

/**
 * Adds call-site metadata to a development build. Use the same `root` as the
 * analyzer so that both describe a file by the same relative path.
 */
export function anatomySourcePlugin(options: { root: string; filter?: RegExp }): Plugin {
  return {
    name: 'react-anatomy-source',
    setup(build) {
      build.onLoad(
        { namespace: 'file', filter: options.filter ?? /\.[cm]?[jt]sx?$/ },
        async (args) => {
          const path = projectPath(options.root, args.path);

          if (!isSourcePath(args.path) || path.startsWith('..')) {
            return undefined;
          }

          const text = stripBom(await readFile(args.path, 'utf8'));

          return {
            contents: instrumentSource(text, { fileName: args.path, path }).code,
            loader: args.path.endsWith('.tsx')
              ? 'tsx'
              : args.path.endsWith('.jsx')
                ? 'jsx'
                : /\.[cm]?ts$/.test(args.path)
                  ? 'ts'
                  : (build.initialOptions.loader?.['.js'] ?? 'js'),
          };
        },
      );
    },
  };
}
