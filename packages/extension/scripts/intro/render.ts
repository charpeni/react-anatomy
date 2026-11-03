import type { RenderedCue, IntroTimeline, Narration } from './types.ts';
// Mixes the narration, burns the subtitle plates over the composed footage, and exports the
// share copy, masters, sidecar subtitles, poster, the sharing kit (video, subtitles, poster,
// notes; no extension or install instructions) and a separate developer-only extension archive.
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import ffmpegBinary from 'ffmpeg-static';

if (!ffmpegBinary) {
  throw new Error('FFmpeg is not available on this platform.');
}
const ffmpeg: string = ffmpegBinary;

const dir = resolve('artifacts/intro');
const out = dir + '/deliverables';
const timeline: IntroTimeline = JSON.parse(await readFile(dir + '/timeline.json', 'utf8'));
const narration: Narration = JSON.parse(await readFile(dir + '/narration.json', 'utf8'));
const cues: RenderedCue[] = JSON.parse(await readFile(dir + '/cues.json', 'utf8'));
const { duration, speech, events } = timeline;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const name = 'react-anatomy-intro';
const version = JSON.parse(await readFile('dist/extension/manifest.json', 'utf8')).version;

function ff(args: string[], label?: string): Promise<string> {
  if (label) {
    console.log(label);
  }

  return new Promise<string>((res, rej) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-nostats', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';

    child.stderr.on('data', (d: string) => {
      err = (err + d).slice(-20000);
    });
    child.on('exit', (c) => (c ? rej(new Error(err.slice(-3000))) : res(err)));
    child.on('error', rej);
  });
}

// ---- Narration mix: clips at their recorded times, loudness-normalised (two-pass) -------
const clips = speech.map((s) => ({
  ...s,
  clip: narration.clips.find((c) => c.id === s.id)!,
  loudness: 0,
  gain: 0,
}));
const inputs = clips.flatMap((c) => ['-i', c.clip.file]);

// Level each clip toward the median clip loudness (±4 dB max) so lines sit evenly in the mix.
for (const c of clips) {
  c.loudness = +(await ff(['-nostats', '-i', c.clip.file, '-af', 'ebur128', '-f', 'null', '-']))
    .match(/I:\s+(-?[\d.]+) LUFS/g)!
    .at(-1)!
    .match(/-?[\d.]+/)![0];
}

const median = clips.map((c) => c.loudness).sort((a: number, b: number) => a - b)[
  clips.length >> 1
];

for (const c of clips) {
  c.gain = +Math.max(-4, Math.min(4, median - c.loudness)).toFixed(2);
}

const graph =
  clips
    .map((c, i) => `[${i}:a]volume=${c.gain}dB,adelay=${Math.round(c.start * 1000)}:all=1[a${i}]`)
    .join(';') +
  ';' +
  clips.map((_, i) => `[a${i}]`).join('') +
  `amix=inputs=${clips.length}:normalize=0:dropout_transition=0,apad=whole_dur=${duration.toFixed(3)},atrim=0:${duration.toFixed(3)},pan=stereo|c0=c0|c1=c0`;

await ff(
  [
    '-y',
    ...inputs,
    '-filter_complex',
    graph,
    '-ar',
    '48000',
    '-c:a',
    'pcm_s24le',
    dir + '/narration-raw.wav',
  ],
  'Mixing narration…',
);

const measured = JSON.parse(
  (
    await ff([
      '-i',
      dir + '/narration-raw.wav',
      '-af',
      'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
      '-f',
      'null',
      '-',
    ])
  ).match(/\{[\s\S]*?\}/)![0],
);
const norm = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;

await ff(
  [
    '-y',
    '-i',
    dir + '/narration-raw.wav',
    '-af',
    `${norm},aresample=48000`,
    '-c:a',
    'pcm_s24le',
    dir + '/narration.wav',
  ],
  'Normalising loudness…',
);

// ---- Subtitles (sidecars) ----------------------------------------------------------------
const clock = (s: number, sep: string) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const sec = Math.floor(ms / 1000) % 60;

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
};

await writeFile(
  `${out}/${name}.en.srt`,
  cues
    .map((c, i) => `${i + 1}\n${clock(c.start, ',')} --> ${clock(c.end, ',')}\n${c.text}\n`)
    .join('\n'),
);
await writeFile(
  `${out}/${name}.en.vtt`,
  'WEBVTT\n\n' +
    cues
      .map(
        (c) =>
          `${clock(c.start, '.')} --> ${clock(c.end, '.')} line:0 position:50% align:center\n${c.text}\n`,
      )
      .join('\n'),
);

// ---- Chapters / metadata -----------------------------------------------------------------
const startOf = (id: string) => speech.find((s) => s.id === id)!.start;

const chapters: [string, number][] = [
  ['A React app', 0],
  ['Open DevTools', startOf('c03')],
  ['Anatomy captures the page', events.panel],
  ['Pull it apart', startOf('c07')],
  ['Select a component', startOf('c10')],
  ['Read its props', startOf('c13')],
  ['Work in progress', startOf('c15')],
];
const meta = [
  ';FFMETADATA1',
  'title=React Anatomy — see how a React page is composed',
  'comment=Concept introduction to React Anatomy, a Chrome DevTools extension that is still a work in progress. Recorded with the real extension.',
];

chapters.forEach(([title, start], i) =>
  meta.push(
    '[CHAPTER]',
    'TIMEBASE=1/1000',
    `START=${Math.round(start * 1000)}`,
    `END=${Math.round((chapters[i + 1]?.[1] ?? duration) * 1000)}`,
    `title=${title}`,
  ),
);
await writeFile(dir + '/chapters.txt', meta.join('\n') + '\n');

// ---- Video exports -------------------------------------------------------------------------
const color = [
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-colorspace',
  'bt709',
  '-color_range',
  'tv',
];

const video = (crf: number) => [
  '-c:v',
  'libx264',
  '-profile:v',
  'high',
  '-preset',
  'slow',
  '-crf',
  String(crf),
  '-pix_fmt',
  'yuv420p',
  ...color,
  '-g',
  '60',
  '-threads',
  '8',
];

const audio = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];
const common = [
  '-map_metadata',
  '2',
  '-map_chapters',
  '2',
  '-t',
  duration.toFixed(3),
  '-movflags',
  '+faststart',
];
const probe = (await ff(['-i', dir + '/clean-1440p.mkv']).catch((e) => e.message)).match(
  /Video: .*?, (\d+)x(\d+)/,
);

if (!probe || probe[1] !== '2560' || probe[2] !== '1440') {
  throw new Error('The composed video must be 2560×1440; run compose.ts again.');
}

const plates = cues.flatMap((c: { file: string }) => ['-i', dir + '/' + c.file]);

const overlay = (size?: string) => {
  let g = '[0:v]setsar=1[v0]';

  cues.forEach((c: { start: number; end: number }, i: number) => {
    g += `;[${i + 3}:v]scale=2560:1440,format=rgba[p${i}];[v${i}][p${i}]overlay=0:0:eof_action=repeat:enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'[v${i + 1}]`;
  });

  return g + `;[v${cues.length}]${size ? `scale=${size}:flags=lanczos,` : ''}format=yuv420p[out]`;
};

const base = [
  '-y',
  '-i',
  dir + '/clean-1440p.mkv',
  '-i',
  dir + '/narration.wav',
  '-f',
  'ffmetadata',
  '-i',
  dir + '/chapters.txt',
];

await ff(
  [
    ...base,
    ...plates,
    '-filter_complex',
    overlay('1920:1080'),
    '-map',
    '[out]',
    '-map',
    '1:a',
    ...video(17),
    ...audio,
    ...common,
    `${out}/${name}-1080p.mp4`,
  ],
  'Rendering 1080p captioned share copy…',
);
await ff(
  [
    ...base,
    ...plates,
    '-filter_complex',
    overlay(),
    '-map',
    '[out]',
    '-map',
    '1:a',
    ...video(15),
    ...audio,
    ...common,
    `${out}/${name}-1440p.mp4`,
  ],
  'Rendering 1440p captioned master…',
);
await ff(
  [
    ...base,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-vf',
    'format=yuv420p',
    ...video(15),
    ...audio,
    ...common,
    `${out}/${name}-1440p-clean.mp4`,
  ],
  'Rendering 1440p clean master (no burned-in subtitles)…',
);

const posterTime = startOf('c08') + 3.9;

await ff(
  [
    '-y',
    '-ss',
    posterTime.toFixed(3),
    '-i',
    dir + '/clean-1440p.mkv',
    '-frames:v',
    '1',
    '-vf',
    'scale=1920:1080:flags=lanczos',
    `${out}/${name}-poster.png`,
  ],
  'Exporting poster…',
);

// ---- Developer-only extension archive (never part of the sharing kit) ------------------
const zip = (entries: string[][], dst: string, method = 'ZIP_DEFLATED') =>
  new Promise<void>((res, rej) => {
    const p = spawn(
      'python3',
      [
        '-I',
        '-c',
        `import zipfile,os,sys,json
entries=json.loads(sys.argv[1]);dst=sys.argv[2]
with zipfile.ZipFile(dst,'w',zipfile.${method}) as z:
  for src,arc in entries:
    if os.path.isdir(src):
      for root,_,files in os.walk(src):
        for f in sorted(files):
          path=os.path.join(root,f);z.write(path,os.path.join(arc,os.path.relpath(path,src)))
    else: z.write(src,arc)`,
        JSON.stringify(entries),
        dst,
      ],
      { stdio: 'inherit' },
    );

    p.on('exit', (c) => (c ? rej(new Error('zip failed')) : res()));
  });

await mkdir(`${out}/developer-only`, { recursive: true });
await zip(
  [[resolve('dist/extension'), '']],
  `${out}/developer-only/react-anatomy-extension-${version}.zip`,
);
await writeFile(
  `${out}/developer-only/README.txt`,
  `REACT ANATOMY ${version} — DEVELOPER BUILD (for your own local use)

react-anatomy-extension-${version}.zip is the unpacked extension build that was recorded for the video.
It is intentionally NOT part of react-anatomy-intro-share-kit.zip: the video is shared as a concept, not for testing.

Local install: extract the archive, open chrome://extensions, enable Developer mode, choose Load unpacked and select the extracted folder, then open DevTools on a React app and choose the Anatomy tab.
`,
);

// ---- Sharing notes ------------------------------------------------------------------------
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const script = clips.map((c) => `[${mmss(c.start)}] ${c.clip.text}`).join('\n');

await writeFile(
  `${out}/README.txt`,
  `REACT ANATOMY — CONCEPT INTRODUCTION
${duration.toFixed(1)} seconds · narrated · English subtitles · work in progress

IN THIS KIT
${name}-1080p.mp4      1920×1080, H.264 High, 30 fps, AAC stereo, subtitles burned in. Send this one.
${name}.en.srt / .vtt  English subtitles matching the narration (for players that show captions).
${name}-poster.png     1920×1080 thumbnail (the exploded 3D view).
README.txt                 These notes.
Higher-quality 2560×1440 masters (captioned, and clean without burned-in subtitles) are kept alongside this kit.

STATUS
React Anatomy is a work in progress and is not ready to use yet. The video introduces the concept; reactions to the idea are the most useful feedback right now.

HOW THE VIDEO WAS MADE
Everything inside the DevTools window is the real React Anatomy extension (a work-in-progress build) running in Chromium against a small sample React app (“Orbit”). The browser toolbar and window frames are drawn around the real page and DevTools captures; DevTools is shown undocked. The page→3D transitions are the panel's own transitions, played in slow motion for the video (in the extension they take about 0.2 s). Camera moves, the pointer, click ripples and the keyboard hint are added in editing.

CHAPTERS
${chapters.map(([t, s]) => `${mmss(s)} ${t}`).join('\n')}

NARRATION
${script}

SUGGESTED MESSAGE
Hey! I've been working on an idea called React Anatomy: a Chrome DevTools panel that turns a running React page into a 3D stack of its components, so you can see how the page is put together and look at the props of any piece. It's still a work in progress, but here's a ${Math.round(duration)}-second video of the concept:

[video]

I'd love your honest reactions:
• Did the 3D view make it clearer how the page is built?
• Can you picture a moment where this would help you — or not really?
• What felt confusing, or what's missing?
`,
);
await zip(
  [
    [`${out}/${name}-1080p.mp4`, `${name}/${name}-1080p.mp4`],
    [`${out}/${name}.en.srt`, `${name}/${name}.en.srt`],
    [`${out}/${name}.en.vtt`, `${name}/${name}.en.vtt`],
    [`${out}/${name}-poster.png`, `${name}/${name}-poster.png`],
    [`${out}/README.txt`, `${name}/README.txt`],
  ],
  `${out}/${name}-share-kit.zip`,
  'ZIP_STORED',
);
console.log('Deliverables:', (await readdir(out)).join(', '));
