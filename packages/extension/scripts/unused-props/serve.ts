import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { buildUnusedPropsFixture } from './build-fixture.ts';

// Serves the "Unused props" fixture for a manual run or a browser check.
//   /        the billing app, built with call-site metadata
//   /plain   the same app without metadata

export async function startUnusedPropsServer(port = 0) {
  await buildUnusedPropsFixture();

  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const file =
      path === '/'
        ? 'dist/unused-props-app.html'
        : path === '/plain'
          ? 'dist/unused-props-plain.html'
          : null;

    if (!file) {
      response.writeHead(path === '/favicon.ico' ? 204 : 404).end();

      return;
    }

    response
      .writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
      .end(await readFile(file));
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (import.meta.main) {
  const server = await startUnusedPropsServer(Number(process.env.ANATOMY_PORT || 4175));

  console.log(`Billing fixture: ${server.url} (without metadata: ${server.url}/plain)`);
  console.log('Source analysis to load in the panel: dist/unused-props-report.json');
}
