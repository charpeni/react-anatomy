import './build.ts';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = Number(process.env.PORT || 4173);
const root = resolve('.');

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);

  if (path === '/favicon.ico') {
    res.writeHead(204).end();

    return;
  }

  const file =
    path === '/' || path.startsWith('/prototype') ? 'dist/prototype.html' : path.slice(1);
  const target = resolve(root, file);

  if (!target.startsWith(root + '/')) {
    res.writeHead(403).end();

    return;
  }

  try {
    const data = await readFile(target);
    const type = file.endsWith('.html')
      ? 'text/html'
      : file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : file.endsWith('.json')
            ? 'application/json'
            : file.endsWith('.mp4')
              ? 'video/mp4'
              : file.endsWith('.webm')
                ? 'video/webm'
                : 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }).end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '0.0.0.0', () => console.log(`Prototype: http://localhost:${port}`));
