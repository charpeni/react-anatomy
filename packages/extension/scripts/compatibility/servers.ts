import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile, open, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve, extname, sep } from 'node:path';

export async function startApps() {
  const root = resolve('artifacts/compatibility/apps');
  const assets = dirname(fileURLToPath(import.meta.resolve('@excalidraw/excalidraw')));
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const asset = pathname.startsWith('/excalidraw-assets/');
    const base = asset ? assets : root;
    let file = resolve(
      base,
      '.' + (asset ? pathname.slice('/excalidraw-assets'.length) : pathname),
    );

    if (!file.startsWith(base + sep)) {
      res.writeHead(403).end();

      return;
    }

    if (!asset && (pathname.endsWith('/') || !extname(pathname))) {
      file = resolve(root, pathname.split('/')[1], 'index.html');
    }

    try {
      const body = await readFile(file);

      res
        .writeHead(200, {
          'Content-Type': types[extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        })
        .end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

export async function startNext(mode: string) {
  await mkdir('artifacts/compatibility', { recursive: true });

  const log = await open(`artifacts/compatibility/next-${mode}.log`, 'w');
  const child = spawn(
    process.execPath,
    [
      resolve('validation/node_modules/next/dist/bin/next'),
      mode === 'production' ? 'start' : 'dev',
      ...(mode === 'production' ? [] : ['--webpack']),
      '-H',
      '127.0.0.1',
      '-p',
      '0',
    ],
    {
      cwd: resolve('validation/next-app'),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
        ANATOMY_NEXT_DEV: mode === 'development' ? '1' : '0',
        ANATOMY_VALIDATION_ID: String(process.pid),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';

  child.stdout.on('data', (data) => {
    output += data;
    log.write(data);
  });
  child.stderr.on('data', (data) => {
    output += data;
    log.write(data);
  });

  let url;
  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js exited (${child.exitCode}): ${output.slice(-1500)}`);
    }

    url =
      output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] || output.match(/http:\/\/localhost:\d+/)?.[0];

    if (url && /Ready|ready/.test(output)) {
      break;
    }

    await new Promise((r) => setTimeout(r, 150));
  }

  if (!url) {
    child.kill();

    throw new Error('Next.js server did not start');
  }

  return {
    url,
    close: async () => {
      child.kill('SIGTERM');
      await new Promise<void>((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
      await log.close();
    },
  };
}
