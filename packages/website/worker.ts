// The static asset binding can return the whole video for a Range request.
// Browsers use a 206 response to enable seeking in their native player.
export default {
  async fetch(request: Request, env: { ASSETS: Pick<typeof globalThis, 'fetch'> }) {
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 200 || !asset.headers.get('Content-Type')?.startsWith('video/')) {
      return asset;
    }

    const response = new Response(asset.body, asset);
    response.headers.set('Accept-Ranges', 'bytes');
    const range = request.headers
      .get('Range')
      ?.trim()
      .match(/^bytes=(\d*)-(\d*)$/i);
    if (request.method !== 'GET' || !range || (!range[1] && !range[2])) {
      return response;
    }

    const validator = request.headers.get('If-Range');
    if (
      validator !== null &&
      (validator.startsWith('W/') ||
        (validator !== asset.headers.get('ETag') &&
          validator !== asset.headers.get('Last-Modified')))
    ) {
      return response;
    }

    // Start playback from the asset stream when the browser asks for the whole file.
    const length = asset.headers.get('Content-Length');
    if (range[1] === '0' && !range[2] && length && Number(length) > 0) {
      response.headers.set('Content-Range', `bytes 0-${Number(length) - 1}/${length}`);
      return new Response(response.body, { status: 206, headers: response.headers });
    }

    const video = await response.blob();
    const start = range[1] ? Number(range[1]) : Math.max(0, video.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), video.size - 1) : video.size - 1;
    const headers = response.headers;
    if (start > end) {
      headers.set('Content-Range', `bytes */${video.size}`);
      headers.set('Content-Length', '0');
      return new Response(null, { status: 416, headers });
    }

    headers.set('Content-Range', `bytes ${start}-${end}/${video.size}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(video.slice(start, end + 1), { status: 206, headers });
  },
};
