import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../worker.ts';

const url = 'https://example.test/media/docs/demo.webm';
const env = {
  ASSETS: {
    async fetch() {
      return new Response('0123456789', {
        headers: { 'Content-Length': '10', 'Content-Type': 'video/webm', ETag: '"demo"' },
      });
    },
  },
};

test('serve the bytes requested by a video player when the asset binding returns a whole file', async () => {
  for (const [range, span, expected] of [
    ['bytes=0-', '0-9', '0123456789'],
    ['bytes=0-1', '0-1', '01'],
    ['bytes=4-6', '4-6', '456'],
    ['bytes=8-', '8-9', '89'],
    ['bytes=-3', '7-9', '789'],
    ['bytes=8-50', '8-9', '89'],
  ]) {
    const response = await worker.fetch(new Request(url, { headers: { Range: range } }), env);
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
    assert.equal(response.headers.get('Content-Range'), `bytes ${span}/10`);
    assert.equal(response.headers.get('Content-Length'), String(expected.length));
    assert.equal(response.headers.get('Content-Type'), 'video/webm');
    assert.equal(await response.text(), expected);
  }
});

test('report the file size for an unsatisfiable range', async () => {
  const response = await worker.fetch(new Request(url, { headers: { Range: 'bytes=10-' } }), env);
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('Content-Range'), 'bytes */10');
  assert.equal(await response.text(), '');
});

test('serve a full video for a normal request or an outdated If-Range validator', async () => {
  for (const headers of [new Headers(), new Headers({ Range: 'bytes=3-5', 'If-Range': '"old"' })]) {
    const response = await worker.fetch(new Request(url, { headers }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Range'), null);
    assert.equal(await response.text(), '0123456789');
  }
});
