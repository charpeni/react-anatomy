import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function startFixtureServer(port = 0) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (path === '/favicon.ico') {
      res.writeHead(204).end();

      return;
    }

    const file =
      path === '/'
        ? 'dist/test-app.html'
        : path === '/plain'
          ? 'dist/plain.html'
          : path === '/demo'
            ? 'dist/demo-app.html'
            : path === '/deep'
              ? 'dist/deep-app.html'
              : path === '/layout'
                ? 'dist/layout-app.html'
                : path === '/fidelity'
                  ? 'dist/fidelity-app.html'
                  : null;

    if (!file) {
      res.writeHead(404).end('Not found');

      return;
    }

    try {
      res
        .writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
        .end(await readFile(file));
    } catch {
      res.writeHead(500).end('Run pnpm run build:extension first.');
    }
  });

  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await startFixtureServer(Number(process.env.ANATOMY_PORT || 4174));

  console.log(`Independent React app: ${fixture.url}`);
}
