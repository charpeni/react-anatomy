import type { PageCall } from './types.ts';

// Exported images are drawn by the panel itself, without a screenshot
// permission: the composition is copied with its computed styles inlined into
// an SVG <foreignObject>, and the browser draws that SVG onto a canvas.
//
// An SVG drawn as an image cannot load anything, so remote images and fonts
// are embedded as data URLs first. That work is bounded: one byte budget for
// everything embedded, a few requests at a time, one deadline, and it stops
// when the dialog closes. Anything that does not fit is left out and reported.

const SCALE = 2;
const ASSET_BUDGET = 16 * 1024 * 1024;
const MAX_ASSET = 4 * 1024 * 1024;
// Every use of an image is copied into the SVG; this bounds the drawn SVG's size.
const MAX_EMBEDDED = 24 * 1024 * 1024;
const MAX_FONT_FACES = 24;
const CONCURRENCY = 6;
const DEADLINE_MS = 15000;
// Well inside every supported browser's canvas limits.
const MAX_SIDE = 16000;
const MAX_AREA = 50_000_000;

// The two engines need opposite techniques for a sharp 2x image. Firefox paints
// 3D-transformed content inside an SVG image at its CSS size and scales the
// result, which blurs the planes, so the copy is laid out at 2x with `zoom`.
// Chromium paints at the final scale, but `zoom` changes its text metrics and
// rewraps captured text, so there the SVG itself is scaled.
//
// Firefox's `zoom` shifts text metrics slightly too: text that barely fits its
// captured box can wrap. Laying captured content out at 1x and scaling it back
// up avoids that, but Firefox then paints it at 1x and blurs it again. Sharp
// planes are the better trade for an image meant to be read.
const zoomLayout = /\bFirefox\//.test(navigator.userAgent);

const urlPattern = /url\("?((?:https?:)?[^")]+)"?\)/gi;
const bitmapDataUrl = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function isRemote(url: string) {
  return /^https?:/i.test(url);
}

/** The bytes left for embedded images and fonts, shared by one export. */
export interface AssetBudget {
  remaining: number;
  signal: AbortSignal;
}

/** One budget per export: it ends at the deadline or when `signal` aborts. */
export function assetBudget(signal: AbortSignal): AssetBudget {
  return {
    remaining: ASSET_BUDGET,
    signal: AbortSignal.any([signal, AbortSignal.timeout(DEADLINE_MS)]),
  };
}

function spend(budget: AssetBudget, data: string) {
  if (data.length > budget.remaining) {
    return false;
  }

  budget.remaining -= data.length;

  return true;
}

async function eachLimited<T>(items: T[], run: (item: T) => Promise<void>) {
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        await run(items[next++]);
      }
    }),
  );
}

/** Remote image URLs used by `<img>` elements and inline style backgrounds, with their largest drawn size. */
export function collectImageUrls(root: HTMLElement) {
  const sizes = new Map<string, number>();

  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    const drawn = Math.max(el.offsetWidth || 0, el.offsetHeight || 0);
    const urls = [...(el.getAttribute('style') ?? '').matchAll(urlPattern)].map(([, url]) => url);
    const src = el instanceof HTMLImageElement ? el.getAttribute('src') : null;

    for (const url of src ? [src, ...urls] : urls) {
      if (isRemote(url)) {
        sizes.set(url, Math.max(sizes.get(url) ?? 0, drawn));
      }
    }
  }

  return sizes;
}

async function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Reads at most `maxBytes`, stopping a larger response as soon as it is known.
async function fetchDataUrl(url: string, budget: AssetBudget, type?: RegExp) {
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      cache: 'force-cache',
      signal: budget.signal,
    });
    const maxBytes = Math.min(MAX_ASSET, budget.remaining);

    if (
      !response.ok ||
      !response.body ||
      Number(response.headers.get('content-length')) > maxBytes
    ) {
      await response.body?.cancel();

      return null;
    }

    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let size = 0;

    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      size += value.byteLength;

      if (size > maxBytes) {
        await reader.cancel();

        return null;
      }

      chunks.push(value);
    }

    const blob = new Blob(chunks, { type: response.headers.get('content-type') ?? '' });

    if (type && !type.test(blob.type)) {
      return null;
    }

    const data = await dataUrl(blob);

    return spend(budget, data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Reads images the page has already loaded first: the page can read its own
 * same-origin assets, which the panel's origin usually cannot. The panel then
 * fetches the rest, which works when the asset server allows CORS.
 */
export async function loadImages(sizes: Map<string, number>, call: PageCall, budget: AssetBudget) {
  const images = new Map<string, string>();
  const urls = [...sizes.keys()];

  if (!urls.length) {
    return images;
  }

  try {
    const result = await call({
      action: 'images',
      urls,
      sizes: urls.map((url) => sizes.get(url)!),
    });

    for (const url of urls) {
      const data = result?.images?.[url];

      // The page is untrusted: accept only well-formed, bounded bitmap data URLs.
      if (
        typeof data === 'string' &&
        data.length <= MAX_ASSET * 1.4 &&
        bitmapDataUrl.test(data) &&
        spend(budget, data)
      ) {
        images.set(url, data);
      }
    }
  } catch {
    // The panel can still fetch CORS-enabled images below.
  }

  await eachLimited(
    urls.filter((url) => !images.has(url)),
    async (url) => {
      const data = budget.signal.aborted ? null : await fetchDataUrl(url, budget, /^image\//);

      if (data) {
        images.set(url, data);
      }
    },
  );

  return images;
}

function familyNames(value: string) {
  return value
    .split(',')
    .map((name) =>
      name
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .toLowerCase(),
    )
    .filter(Boolean);
}

// `U+0000-00FF, U+0131, U+4??` as code point ranges. No descriptor covers all.
function unicodeRanges(value: string) {
  const ranges: [number, number][] = [];

  for (const [, start, end] of value.matchAll(/U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/gi)) {
    ranges.push(
      start.includes('?')
        ? [parseInt(start.replace(/\?/g, '0'), 16), parseInt(start.replace(/\?/g, 'f'), 16)]
        : [parseInt(start, 16), parseInt(end ?? start, 16)],
    );
  }

  return ranges.length ? ranges : [[0, 0x10ffff] as [number, number]];
}

/**
 * Embeds the captured page's @font-face rules that the exported planes need:
 * the families they use, and only faces whose unicode-range covers characters
 * they show. Each face uses its first source that loads. Faces that cannot be
 * fetched are dropped, as the live panel cannot load them either; their text
 * then uses a fallback font.
 */
export async function embedFonts(fontsCss: string | undefined, root: Element, budget: AssetBudget) {
  const used = new Set<string>();
  const characters = new Set<number>();

  for (const el of root.querySelectorAll<HTMLElement>('.plane-content *')) {
    for (const name of familyNames(el.style.fontFamily)) {
      used.add(name);
    }
  }

  for (const el of root.querySelectorAll('.plane-content')) {
    for (const character of el.textContent ?? '') {
      characters.add(character.codePointAt(0)!);
    }
  }

  const sheet = new CSSStyleSheet();

  try {
    sheet.replaceSync(fontsCss || '');
  } catch {
    return { css: '', missing: 0 };
  }

  const faces = Array.from(sheet.cssRules)
    .filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule)
    .filter((rule) => {
      const family = familyNames(rule.style.getPropertyValue('font-family'))[0];
      const ranges = unicodeRanges(rule.style.getPropertyValue('unicode-range'));

      return (
        !!family &&
        used.has(family) &&
        [...characters].some((c) => ranges.some(([start, end]) => c >= start && c <= end))
      );
    })
    .slice(0, MAX_FONT_FACES);
  const rules: string[] = [];
  let missing = 0;

  await eachLimited(faces, async (rule) => {
    // Commas inside url(...) or format(...) do not separate sources.
    const sources = rule.style.getPropertyValue('src').split(/,(?![^(]*\))/);
    let source: string | undefined;

    for (const candidate of sources) {
      const url = [...candidate.matchAll(urlPattern)][0]?.[1];
      const data =
        !url || budget.signal.aborted
          ? null
          : isRemote(url)
            ? await fetchDataUrl(url, budget)
            : url;

      if (data) {
        source = candidate.trim().replace(urlPattern, `url("${data}")`);
        break;
      }
    }

    if (!source) {
      missing++;

      return;
    }

    const descriptors = Array.from(rule.style, (name) =>
      name === 'src' ? `src:${source}` : `${name}:${rule.style.getPropertyValue(name)}`,
    );

    rules.push(`@font-face{${descriptors.join(';')}}`);
  });

  return { css: rules.join('\n'), missing };
}

function inlineComputedStyle(source: Element, target: Element) {
  const computed = getComputedStyle(source);
  const declarations: string[] = [];

  for (let i = 0; i < computed.length; i++) {
    const name = computed[i];

    if (!name.startsWith('--') && !name.startsWith('transition') && !name.startsWith('animation')) {
      declarations.push(`${name}:${computed.getPropertyValue(name)}`);
    }
  }

  target.setAttribute('style', declarations.join(';'));
}

/*
 * Page text can contain characters XML forbids, such as a form feed, and a
 * capture can split a surrogate pair. Either makes the whole SVG fail to load,
 * or fail to encode. Replace broken pairs and drop forbidden characters.
 */
function wellFormed(markup: string) {
  return (
    markup
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�')
      // oxlint-disable-next-line no-control-regex -- These are the characters XML 1.0 forbids.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  );
}

/**
 * Draws a laid-out element into a PNG, at twice its CSS size when the browser
 * allows a canvas that large. The element must be attached to the document so
 * that its computed styles are final.
 */
export async function rasterize(
  root: HTMLElement,
  { fonts, images }: { fonts: string; images: Map<string, string> },
) {
  const width = root.offsetWidth;
  const height = root.offsetHeight;
  const scale = Math.min(
    SCALE,
    MAX_SIDE / Math.max(width, height),
    Math.sqrt(MAX_AREA / (width * height)),
  );
  const copy = root.cloneNode(true) as HTMLElement;
  const sources = [root, ...root.querySelectorAll('*')];
  const targets = [copy, ...copy.querySelectorAll('*')];
  const missing = new Set<string>();
  // An image used twice is embedded twice; count every use.
  let embedded = MAX_EMBEDDED;

  const embed = (url: string) => {
    const data = images.get(url);

    if (!data || data.length > embedded) {
      missing.add(url);

      return null;
    }

    embedded -= data.length;

    return data;
  };

  sources.forEach((source, index) => {
    const target = targets[index];

    // Captured page content is already fully inline-styled by the page agent.
    if (!source.parentElement?.closest('.plane-content')) {
      inlineComputedStyle(source, target);
    }

    if (target instanceof HTMLImageElement) {
      const src = target.getAttribute('src') ?? '';
      const data = isRemote(src) ? embed(src) : null;

      if (data) {
        target.setAttribute('src', data);
      } else if (isRemote(src)) {
        // Keep the image's box visible so the layout still reads correctly.
        target.removeAttribute('src');
        target.style.setProperty('background', '#e8eaed');
      }
    }

    const style = target.getAttribute('style');

    if (style?.includes('url(')) {
      target.setAttribute(
        'style',
        style.replace(urlPattern, (match, url: string) => {
          if (!isRemote(url)) {
            return match;
          }

          const data = embed(url);

          return data ? `url("${data}")` : 'none';
        }),
      );
    }
  });

  if (fonts) {
    copy.prepend(Object.assign(document.createElement('style'), { textContent: fonts }));
  }

  // XMLSerializer adds the XHTML namespace that foreignObject content needs.
  const markup = wellFormed(new XMLSerializer().serializeToString(copy));
  const pixels = { width: Math.round(width * scale), height: Math.round(height * scale) };
  const svg = zoomLayout
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels.width}" height="${pixels.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="zoom:${scale}">${markup}</div></foreignObject></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels.width}" height="${pixels.height}" viewBox="0 0 ${width} ${height}"><foreignObject width="${width}" height="${height}">${markup}</foreignObject></svg>`;
  const image = new Image();

  // A data: URL keeps the canvas readable. Chromium taints a canvas that draws
  // a foreignObject SVG loaded from a blob: URL.
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await image.decode();

  // Chromium encodes canvas.toBlob() in the page's idle time, and waits up to
  // six seconds for some when the panel is busy. OffscreenCanvas encodes
  // without waiting: about 0.1 s instead of 1 to 7 s for a 2x image.
  const canvas = new OffscreenCanvas(pixels.width, pixels.height);

  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await canvas.convertToBlob({ type: 'image/png' }).catch(() => null);

  if (!blob) {
    throw new Error('The browser could not encode the image.');
  }

  return { blob, ...pixels, cssWidth: width, missingImages: missing.size };
}
