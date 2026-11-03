import type { DemoTimeline } from '../intro/types.ts';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import ffmpegBinary from 'ffmpeg-static';

if (!ffmpegBinary) {
  throw new Error('FFmpeg is not available on this platform.');
}
const ffmpeg: string = ffmpegBinary;

const directory = resolve('artifacts/demo');
const timeline: DemoTimeline = JSON.parse(await readFile(directory + '/timeline.json', 'utf8'));
const { frames, captions, cursors, clicks, chapters, duration } = timeline;

if (captions.at(-1)!.end === null) {
  throw new Error('Recording is incomplete.');
}

await mkdir(directory + '/deliverables', { recursive: true });

const clock = (seconds: number, separator = '.', precision = 2) => {
  const units = 10 ** precision;
  const total = Math.round(seconds * units);
  const hours = Math.floor(total / (3600 * units));
  const minutes = Math.floor(total / (60 * units)) % 60;
  const whole = Math.floor(total / units) % 60;
  const fraction = total % units;

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}${separator}${String(fraction).padStart(precision, '0')}`;
};

function requireEnd(end: number | null): number {
  if (end === null) {
    throw new Error('Recording is incomplete.');
  }
  return end;
}

const assTime = (s: number) => clock(s);

const srtTime = (s: number | null) => clock(requireEnd(s), ',', 3).padStart(12, '0');

const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\n/g, '\\N');

const line = (start: number, end: number | null, style: string, text: string, layer = 0) =>
  `Dialogue: ${layer},${assTime(start)},${assTime(requireEnd(end))},${style},,0,0,0,,${text}`;

const ass = [
  `[Script Info]
ScriptType: v4.00+
PlayResX: 2560
PlayResY: 1440
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,FreeSans,38,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Detail,FreeSans,28,&H00D0C9C4,&H00D0C9C4,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Chapter,FreeSans,22,&H00A6A09A,&H00A6A09A,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,9,0,0,0,1
Style: Pointer,FreeSans,20,&H00FFFFFF,&H00FFFFFF,&H0033312D,&H60000000,0,0,0,0,100,100,0,0,1,2,1,7,0,0,0,1
Style: Pulse,FreeSans,20,&H00F8B48A,&H00F8B48A,&H00F8B48A,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`,
];

for (const c of captions) {
  ass.push(line(c.start, c.end, 'Title', `{\\pos(56,1320)}${escape(c.title)}`));
  ass.push(line(c.start, c.end, 'Detail', `{\\pos(56,1380)}${escape(c.detail)}`));
  ass.push(line(c.start, c.end, 'Chapter', `{\\pos(2504,1328)}${escape(c.chapter)}`));
}

const cursorShape = 'm 0 0 l 0 34 l 9 25 l 17 43 l 24 40 l 16 23 l 32 23';

for (const c of cursors) {
  const a = { x: Math.round(c.from.x * 2), y: Math.round(c.from.y * 2) };
  const b = { x: Math.round(c.to.x * 2), y: Math.round(c.to.y * 2) };
  const position =
    a.x === b.x && a.y === b.y ? `\\pos(${a.x},${a.y})` : `\\move(${a.x},${a.y},${b.x},${b.y})`;

  ass.push(line(c.start, c.end, 'Pointer', `{${position}\\p1}${cursorShape}`, 5));
}

for (const c of clicks) {
  const x = Math.round(c.x * 2 - 16);
  const y = Math.round(c.y * 2 - 16);

  ass.push(
    line(
      c.time,
      c.time + 0.28,
      'Pulse',
      `{\\pos(${x},${y})\\alpha&H70&\\fad(0,220)\\p1}m 16 0 b 25 0 32 7 32 16 b 32 25 25 32 16 32 b 7 32 0 25 0 16 b 0 7 7 0 16 0`,
      4,
    ),
  );
}

await writeFile(directory + '/overlays.ass', ass.join('\n') + '\n');

const srt = captions
  .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.title}\n${c.detail}\n`)
  .join('\n');

await writeFile(directory + '/deliverables/react-anatomy-demo.srt', srt);
await writeFile(
  directory + '/frames.txt',
  frames
    .map((f) => `file '${f.file}'\noption framerate 30\nduration ${f.duration.toFixed(9)}`)
    .join('\n') + `\nfile '${frames.at(-1)!.file}'\noption framerate 30\n`,
);

const metadata = [
  ';FFMETADATA1',
  'title=React Anatomy — React in 3D',
  'comment=Real Chrome extension demonstration. Caption-led; no audio.',
];

chapters.forEach((c, i) =>
  metadata.push(
    '[CHAPTER]',
    'TIMEBASE=1/1000',
    `START=${Math.round(c.start * 1000)}`,
    `END=${Math.round((chapters[i + 1]?.start ?? duration) * 1000)}`,
    `title=${c.name}`,
  ),
);
await writeFile(directory + '/chapters.txt', metadata.join('\n'));

async function encode(args: readonly string[], label: string) {
  console.log(label);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(ffmpeg, args, {
      env: { ...process.env, FONTCONFIG_FILE: resolve('scripts/demo/fonts.conf') },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let tail = '';
    let last = 0;

    child.stderr.on('data', (chunk: string) => {
      tail = (tail + chunk).slice(-12000);

      if (Date.now() - last > 15000) {
        const progress = tail.match(/frame=\s*\d+.*?time=([^\s]+).*?speed=\s*([^\s]+)/g);

        if (progress?.length) {
          console.log(progress.at(-1));
        }

        last = Date.now();
      }
    });
    child.on('exit', (code: number) => (code === 0 ? resolvePromise() : reject(new Error(tail))));
    child.on('error', reject);
  });
}

const base = [
  '-y',
  '-hide_banner',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  directory + '/frames.txt',
  '-f',
  'ffmetadata',
  '-i',
  directory + '/chapters.txt',
  '-map_metadata',
  '1',
  '-map_chapters',
  '1',
];
const color = [
  '-pix_fmt',
  'yuv420p',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-colorspace',
  'bt709',
  '-color_range',
  'tv',
];

await encode(
  [
    ...base,
    '-vf',
    `fps=30:start_time=0,pad=2560:1440:0:0:color=0x17191c,ass=${directory}/overlays.ass:fontsdir=${resolve('scripts/demo/fonts')},scale=2560:1440:out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    '-r',
    '30',
    '-t',
    duration.toFixed(3),
    '-c:v',
    'libx264',
    '-threads',
    '4',
    '-crf',
    '16',
    '-preset',
    'medium',
    ...color,
    '-movflags',
    '+faststart',
    directory + '/deliverables/react-anatomy-demo-1440p.mp4',
  ],
  'Rendering 1440p master…',
);
await encode(
  [
    '-y',
    '-hide_banner',
    '-i',
    directory + '/deliverables/react-anatomy-demo-1440p.mp4',
    '-vf',
    'scale=1920:1080:flags=lanczos:in_color_matrix=bt709:out_color_matrix=bt709',
    '-c:v',
    'libx264',
    '-threads',
    '4',
    '-crf',
    '18',
    '-preset',
    'medium',
    ...color,
    '-map_metadata',
    '0',
    '-map_chapters',
    '0',
    '-movflags',
    '+faststart',
    directory + '/deliverables/react-anatomy-demo-1080p.mp4',
  ],
  'Rendering 1080p sharing copy…',
);
await encode(
  [
    '-y',
    '-hide_banner',
    '-ss',
    '17',
    '-i',
    directory + '/deliverables/react-anatomy-demo-1440p.mp4',
    '-frames:v',
    '1',
    directory + '/deliverables/react-anatomy-demo-poster.png',
  ],
  'Exporting poster…',
);

const chapterText = chapters
  .map(
    (c) =>
      `${String(Math.floor(c.start / 60)).padStart(2, '0')}:${String(Math.floor(c.start % 60)).padStart(2, '0')} ${c.name}`,
  )
  .join('\n');

await writeFile(
  directory + '/deliverables/README.txt',
  `REACT ANATOMY — REACT IN 3D\n\nFull product demo • ${duration.toFixed(1)} seconds • Preview v0.4.2\n\nreact-anatomy-demo-1080p.mp4: 1920 × 1080, H.264, 30 fps, captioned, ready to share.\nreact-anatomy-demo-1440p.mp4: 2560 × 1440, H.264, 30 fps, higher-quality master.\nreact-anatomy-demo.srt: captions for accessibility and distribution.\nreact-anatomy-demo-poster.png: matching thumbnail.\n\nBoth videos are intentionally silent and use readable captions outside the application frame.\nThe recording uses the real unpacked Chrome extension and a purpose-built React sample app. Camera and pointer movements are captured frame by frame and edited to a consistent 30 fps.\n\nCHAPTERS\n${chapterText}\n\nSUGGESTED DESCRIPTION\nExplore how a React page is composed with React Anatomy, a 3D component inspector in Chrome DevTools. Pull apart rendered layers, focus component subtrees, inspect nested props, pick components on the page, follow live changes, and reveal their output in Elements. No package or app code changes required.\n\nStatus: unpacked extension preview. Tested with React 19 in Chromium. Captures the top document’s current viewport.\n`,
);
console.log(`Finished: ${duration.toFixed(2)} seconds, 1440p and 1080p.`);
