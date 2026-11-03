import type { IntroTimeline, Narration, Point, Cue } from './types.ts';
// Composes the recorded screenshots into 30 fps video frames: a browser window with the
// real page, the real undocked DevTools window, camera moves, cursor, clicks and keycaps.
// Also renders the subtitle plates used by render.ts. Writes a clean (subtitle-free)
// near-lossless 1440p intermediate.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { browserOptions } from '../browser-options.ts';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import ffmpegBinary from 'ffmpeg-static';

if (!ffmpegBinary) {
  throw new Error('FFmpeg is not available on this platform.');
}
const ffmpeg: string = ffmpegBinary;
import { DESKTOP, CHROME_HEIGHT, WINDOW, TITLE_HEIGHT, SUBTITLE_BAND } from './layout.ts';

const dir = resolve('artifacts/intro');
const timeline: IntroTimeline = JSON.parse(await readFile(dir + '/timeline.json', 'utf8'));
const narration: Narration = JSON.parse(await readFile(dir + '/narration.json', 'utf8'));
const { frames, cursor, clicks, camera, keys, speech, events, url } = timeline;
const fps = 30;
const total = Math.round(timeline.duration * fps);
const host = new URL(url).host + new URL(url).pathname;
const only = process.argv.includes('--plates')
  ? 'plates'
  : process.argv.find((a) => a.startsWith('--still='))?.slice(8);

const options = browserOptions();
const browser = await chromium.launch({
  ...options,
  headless: true,
  env: { ...options.env, FONTCONFIG_FILE: resolve('scripts/demo/fonts.conf') },
});

const icon = (d: string, size = 16, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#5f6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

const lights = `<span class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:${DESKTOP.w}px;height:${DESKTOP.h}px;overflow:hidden;background:#202124;font-family:'Noto Sans',sans-serif;-webkit-font-smoothing:antialiased}
#desk{position:absolute;left:0;top:0;width:${DESKTOP.w}px;height:${DESKTOP.h}px;transform-origin:0 0;will-change:transform}
#browser{position:absolute;inset:0;background:#fff;overflow:hidden}
.tabs{height:36px;background:#dee3ea;position:relative}
.lights{position:absolute;left:14px;top:13px;display:flex;gap:8px}.lights i{width:12px;height:12px;border-radius:50%;display:block;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.18)}
.tab{position:absolute;left:84px;top:6px;width:236px;height:30px;background:#fff;border-radius:9px 9px 0 0;display:flex;align-items:center;gap:8px;padding:0 10px 0 12px;font-size:12.5px;color:#202124}
.tab:before,.tab:after{content:'';position:absolute;bottom:0;width:10px;height:10px;background:radial-gradient(circle at 0 0,transparent 9.5px,#fff 10px)}
.tab:before{left:-10px;transform:scaleX(-1)}.tab:after{right:-10px}
.fav{width:16px;height:16px;border-radius:4px;background:#6d5bd0;color:#fff;font:700 10px/16px 'Noto Sans';text-align:center}
.tab span{flex:1;white-space:nowrap;overflow:hidden}.tab .x{flex:0;color:#5f6368;font-size:15px}
.newtab{position:absolute;left:334px;top:11px;color:#5f6368;font-size:20px;line-height:20px}
.toolbar{height:${CHROME_HEIGHT - 36}px;background:#fff;display:flex;align-items:center;gap:14px;padding:0 12px;border-bottom:1px solid #dadce0}
.omni{flex:1;height:24px;border-radius:12px;background:#eef1f6;display:flex;align-items:center;gap:8px;padding:0 12px;font-size:13px;color:#202124}
.omni b{font-weight:400;color:#5f6368}
.avatar{width:22px;height:22px;border-radius:50%;background:#3a8a70;color:#fff;font:600 10px/22px 'Noto Sans';text-align:center}
#page{position:absolute;left:0;top:${CHROME_HEIGHT}px;width:${DESKTOP.w}px;height:${DESKTOP.h - CHROME_HEIGHT}px;display:block}
#win{position:absolute;left:${WINDOW.x}px;top:${WINDOW.y}px;width:${WINDOW.w}px;height:${WINDOW.h}px;border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 22px 70px rgba(0,0,0,.34),0 4px 16px rgba(0,0,0,.16),0 0 0 .5px rgba(0,0,0,.35);opacity:0;transform-origin:50% 40%}
.title{height:${TITLE_HEIGHT}px;background:#e8eaed;border-bottom:1px solid #d2d5da;position:relative;font-size:12px;color:#3c4043;text-align:center;line-height:${TITLE_HEIGHT}px}
.title .lights{top:7px;left:10px}
#dev{display:block;width:${WINDOW.w}px;height:${WINDOW.h - TITLE_HEIGHT}px}
#cursor{position:absolute;left:0;top:0;width:15px;height:23px;margin:-1px 0 0 -1px;filter:drop-shadow(0 1.5px 1.5px rgba(0,0,0,.35));display:none;z-index:5}
#ripple{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(26,115,232,.28);border:2px solid rgba(26,115,232,.55);opacity:0;z-index:4}
#keys{position:absolute;left:50%;top:560px;transform:translateX(-50%);display:flex;gap:10px;padding:14px 18px;border-radius:16px;background:rgba(32,33,36,.86);box-shadow:0 10px 30px rgba(0,0,0,.25);opacity:0}
#keys span{min-width:52px;height:52px;padding:0 12px;border-radius:10px;background:linear-gradient(#fff,#eceef1);box-shadow:inset 0 -3px 0 #c9ccd1,0 1px 2px rgba(0,0,0,.3);font:500 25px/50px 'Noto Sans','Noto Sans Symbols','Noto Sans Symbols2','DejaVu Sans',sans-serif;color:#202124;text-align:center}
#end{position:absolute;inset:0;background:rgba(18,19,22,.9);opacity:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center}
#end h1{font:700 72px/1 'Noto Sans';letter-spacing:-.5px;margin:0 0 20px}
#end p{margin:0;font-size:24px;color:#dfe3e8}
#end .meta{margin-top:30px;font-size:17px;color:#aab0b8}
</style></head><body>
<div id="desk">
  <div id="browser">
    <div class="tabs">${lights}<div class="tab"><div class="fav">o</div><span>Orbit — sample React app</span><div class="x">×</div></div><div class="newtab">+</div></div>
    <div class="toolbar">${icon('<path d="M19 12H5M12 19l-7-7 7-7"/>')}${icon('<path d="M5 12h14M12 5l7 7-7 7"/>', 16, 'style="opacity:.45"')}${icon('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>')}
      <div class="omni">${icon('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>', 14)}<span>${host.replace(/^([^/]+)/, '$1<b>')}</b></span></div>
      <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#5f6368" d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4c-1.1 0-2 .9-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20c0 1.1.9 2 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17c1.1 0 2-.9 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z"/></svg><div class="avatar">NC</div>${icon('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>', 16)}</div>
    <img id="page">
  </div>
  <div id="win"><div class="title">${lights}DevTools - ${host}</div><img id="dev"></div>
  <div id="ripple"></div>
  <svg id="cursor" viewBox="0 0 15 23"><path d="M1.5 1.5v17.6l4.3-4.1 3 6.6 3.1-1.4-3-6.5h6.1z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>
</div>
<div id="keys"></div>
<div id="end"><h1>React Anatomy</h1><p>Understand how a React page is composed — in 3D, inside Chrome DevTools.</p><div class="meta">Work in progress · Feedback on the concept welcome</div></div>
<script>
const $=id=>document.getElementById(id);
window.apply=async s=>{
  const waits=[];
  for(const [id,src] of [['page',s.page],['dev',s.dev]]){const img=$(id);if(src&&img.getAttribute('src')!==src){img.setAttribute('src',src);waits.push(img.decode());}}
  await Promise.all(waits);
  $('desk').style.transform='translate('+(-s.cam.x*s.cam.s)+'px,'+(-s.cam.y*s.cam.s)+'px) scale('+s.cam.s+')';
  const w=$('win');w.style.opacity=s.win;w.style.transform='translateY('+(1-s.win)*14+'px) scale('+(0.965+0.035*s.win)+')';
  const c=$('cursor');c.style.display=s.cursor?'block':'none';if(s.cursor)c.style.transform='translate('+s.cursor.x+'px,'+s.cursor.y+'px)';
  const r=$('ripple');r.style.opacity=s.ripple?s.ripple.o:0;if(s.ripple)r.style.transform='translate('+s.ripple.x+'px,'+s.ripple.y+'px) scale('+s.ripple.s+')';
  const k=$('keys');if(k.dataset.label!==s.keys.label){k.dataset.label=s.keys.label;k.innerHTML=s.keys.label.split(' ').filter(Boolean).map(x=>'<span>'+x+'</span>').join('');}
  k.style.opacity=s.keys.o;k.style.transform='translateX(-50%) translateY('+(1-s.keys.o)*8+'px)';
  $('end').style.opacity=s.end;
};
</script></body></html>`;

await writeFile(dir + '/compose.html', html);

// ---- Timeline evaluation ----------------------------------------------------------------
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function frameAt(t: number) {
  let lo = 0;
  let hi = frames.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;

    if (frames[mid].start <= t + 1e-6) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return frames[lo];
}

function cameraAt(t: number) {
  let rect = { x: 0, y: 0, w: DESKTOP.w };

  for (const k of camera) {
    if (k.start > t) {
      break;
    }

    const p = k.duration ? ease(clamp((t - k.start) / k.duration)) : 1;
    // Interpolate zoom geometrically so the move feels even.
    const s0 = DESKTOP.w / rect.w;
    const s1 = DESKTOP.w / k.rect.w;
    const s = s0 * Math.pow(s1 / s0, p);
    const c0 = { x: rect.x + rect.w / 2, y: rect.y + (rect.w * 9) / 32 };
    const c1 = { x: k.rect.x + k.rect.w / 2, y: k.rect.y + (k.rect.w * 9) / 32 };
    const w = DESKTOP.w / s;
    const cx = c0.x + (c1.x - c0.x) * p;
    const cy = c0.y + (c1.y - c0.y) * p;

    rect = { x: cx - w / 2, y: cy - (w * 9) / 32, w };
  }

  const s = DESKTOP.w / rect.w;

  return { x: +rect.x.toFixed(3), y: +rect.y.toFixed(3), s: +s.toFixed(5) };
}

function cursorAt(t: number) {
  let state: Point | null = null;

  for (const c of cursor) {
    if (c.start > t + 1e-6) {
      break;
    }

    if (c.hide) {
      state = null;
      continue;
    }

    if (t < c.end) {
      const p =
        c.end - c.start > 0.1
          ? ease(clamp((t - c.start) / (c.end - c.start)))
          : clamp((t - c.start) / (c.end - c.start || 1));

      state = { x: c.from.x + (c.to.x - c.from.x) * p, y: c.from.y + (c.to.y - c.from.y) * p };
    } else {
      state = { ...c.to };
    }
  }

  return state && { x: +state.x.toFixed(2), y: +state.y.toFixed(2) };
}

function rippleAt(t: number) {
  const c = clicks.findLast((c: { time: number }) => c.time <= t && t < c.time + 0.45);

  if (!c) {
    return null;
  }

  const p = (t - c.time) / 0.45;

  return { x: c.x, y: c.y, s: +(0.35 + 0.75 * easeOut(p)).toFixed(3), o: +(1 - p).toFixed(3) };
}

function keysAt(t: number) {
  const k = keys.find((k: { start: number; end: number }) => t >= k.start - 0.2 && t < k.end + 0.2);

  if (!k) {
    return { label: '', o: 0 };
  }

  const o = Math.min(clamp((t - k.start + 0.2) / 0.2), clamp((k.end + 0.2 - t) / 0.2));

  return { label: k.label.join(' '), o: +ease(o).toFixed(3) };
}

function stateAt(t: number) {
  const f = frameAt(t);

  return {
    page: f.page,
    dev: f.dev,
    cam: cameraAt(t),
    win: +easeOut(clamp((t - events.devtools) / 0.32)).toFixed(3),
    cursor: t < events.end ? cursorAt(t) : null,
    ripple: rippleAt(t),
    keys: keysAt(t),
    end: +ease(clamp((t - events.end) / 0.7)).toFixed(3),
  };
}

declare global {
  interface Window {
    apply: (state: ReturnType<typeof stateAt>) => Promise<void>;
  }
}

const page = await browser.newPage({
  viewport: { width: DESKTOP.w, height: DESKTOP.h },
  deviceScaleFactor: 2,
});

await page.goto('file://' + dir + '/compose.html');
await page.evaluate(() => document.fonts.ready);

const cdp = await page.context().newCDPSession(page);

await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: DESKTOP.w,
  height: DESKTOP.h,
  deviceScaleFactor: 2,
  mobile: false,
});

const grab = async () => {
  const png = Buffer.from(
    (await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })).data,
    'base64',
  );

  if (png.readUInt32BE(16) !== DESKTOP.w * 2) {
    throw new Error('Unexpected compositor frame size');
  }

  return png;
};

// ---- Subtitle plates (transparent, full frame) -------------------------------------------
async function plates() {
  await rm(dir + '/subtitles', { recursive: true, force: true });
  await mkdir(dir + '/subtitles', { recursive: true });

  const plate = await browser.newPage({
    viewport: { width: DESKTOP.w, height: DESKTOP.h },
    deviceScaleFactor: 2,
  });

  await plate.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;width:${DESKTOP.w}px;height:${DESKTOP.h}px}
  div{position:absolute;top:12px;left:50%;transform:translateX(-50%);max-width:820px;width:max-content;padding:7px 18px 8px;border-radius:10px;background:rgba(17,18,21,.82);color:#fff;font:400 23px/31px 'Noto Sans',sans-serif;text-align:center;text-wrap:balance;letter-spacing:.1px}</style><div id="t"></div>`);
  await plate.evaluate(() => document.fonts.ready);

  const cues: Cue[] = [];

  for (const s of speech) {
    const c = narration.clips.find((c) => c.id === s.id)!;

    for (const cue of c.cues) {
      cues.push({
        text: cue.text,
        start: +(s.start + cue.start).toFixed(3),
        end: +(s.start + cue.end).toFixed(3),
      });
    }
  }

  // Keep each cue up through short pauses so subtitles do not flicker between lines.
  cues.forEach((c, i) => {
    const next = cues[i + 1];

    c.end = +(next && next.start - c.end < 0.6 ? next.start - 0.04 : c.end + 0.35).toFixed(3);
  });

  for (const [i, cue] of cues.entries()) {
    await plate.evaluate((text) => {
      document.getElementById('t')!.textContent = text;
    }, cue.text);

    const box = await plate.evaluate(() => {
      const r = document.getElementById('t')!.getBoundingClientRect();

      return { bottom: r.bottom, lines: Math.round((r.height - 15) / 31) };
    });

    if (box.bottom > SUBTITLE_BAND || box.lines > 2) {
      throw new Error(`Subtitle too large: ${cue.text}`);
    }

    cue.file = `subtitles/${String(i).padStart(2, '0')}.png`;
    cue.lines = box.lines;
    await plate.screenshot({ path: dir + '/' + cue.file, omitBackground: true });
  }

  await writeFile(dir + '/cues.json', JSON.stringify(cues, null, 2));
  console.log(`${cues.length} subtitle plates.`);
  await plate.close();
}

try {
  if (only === 'plates') {
    await plates();
  } else if (only) {
    for (const t of only.split(',').map(Number)) {
      await page.evaluate((s) => window.apply(s), stateAt(t));
      await writeFile(`${dir}/still-${t}.png`, await grab());
    }

    console.log('Stills written.');
  } else {
    await plates();

    const out = dir + '/clean-1440p.mkv';
    const child = spawn(
      ffmpeg,
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'image2pipe',
        '-framerate',
        String(fps),
        '-c:v',
        'png',
        '-i',
        '-',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '4',
        '-pix_fmt',
        'yuv444p',
        '-vf',
        'scale=out_color_matrix=bt709:out_range=tv',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        '-colorspace',
        'bt709',
        out,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const done = new Promise<void>((res, rej) => {
      child.on('exit', (c: string) => (c ? rej(new Error('ffmpeg failed ' + c)) : res()));
      child.on('error', rej);
    });

    const write = (b: Buffer<ArrayBuffer> | null) =>
      new Promise<void>((r) => (child.stdin.write(b) ? r() : child.stdin.once('drain', r)));

    let previous = null;
    let buffer = null;
    let unique = 0;
    const started = Date.now();

    for (let i = 0; i < total; i++) {
      const state = stateAt(i / fps);
      const key = JSON.stringify(state);

      if (key !== previous) {
        await page.evaluate((s) => window.apply(s), state);
        buffer = await grab();
        previous = key;
        unique++;
      }

      await write(buffer);

      if (i % 300 === 0) {
        console.log(
          `frame ${i}/${total} · ${unique} unique · ${((Date.now() - started) / 1000).toFixed(0)}s`,
        );
      }
    }

    child.stdin.end();
    await done;
    console.log(`Composed ${total} frames (${unique} unique) → ${out}`);
  }
} finally {
  await browser.close();
}
