import type { Narration } from './types.ts';
// Extracts review stills from the encoded captioned share copy, plus a contact sheet.
// Times are derived from the recorded timeline so they follow re-recordings.
import { rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ffmpegBinary from 'ffmpeg-static';

if (!ffmpegBinary) {
  throw new Error('FFmpeg is not available on this platform.');
}
const ffmpeg: string = ffmpegBinary;

const dir = 'artifacts/intro/review';
const video = 'artifacts/intro/deliverables/react-anatomy-intro-1080p.mp4';
const { speech, events, duration } = JSON.parse(
  await readFile('artifacts/intro/timeline.json', 'utf8'),
);
const narration: Narration = JSON.parse(await readFile('artifacts/intro/narration.json', 'utf8'));

const start = (id: string) => speech.find((s: { id: string }) => s.id === id).start;

const end = (id: string) => start(id) + narration.clips.find((c) => c.id === id)!.duration;

const second = (id: string) => start(id) + narration.clips.find((c) => c.id === id)!.cues[1].start;

const points = [
  ['website', 2],
  ['devtools-open', events.devtools + 0.9],
  ['anatomy-tab', events.panel - 0.15],
  ['flat', start('c06') + 1],
  ['exploding', events.explode + 1.3],
  ['exploded', start('c08') + 4],
  ['structure', second('c09') + 1.2],
  ['select', events.select + 0.7],
  ['focus', start('c12') + 2.6],
  ['props', start('c13') + 2.6],
  ['props-nested', end('c14') + 0.3],
  ['whole-page', start('c15') + 3],
  ['work-in-progress', start('c16') + 1],
  ['feedback', start('c17') + 2],
  ['end-card', duration - 1],
];

await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });

const run = (args: string[]) => {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8',
  });

  if (r.status) {
    throw new Error(r.stderr);
  }
};

points.forEach(([name, t], i) =>
  run([
    '-ss',
    t.toFixed(2),
    '-i',
    video,
    '-frames:v',
    '1',
    `${dir}/${String(i).padStart(2, '0')}-${name}.png`,
  ]),
);
run([
  '-pattern_type',
  'glob',
  '-i',
  dir + '/[0-9]*.png',
  '-vf',
  'scale=640:360,tile=3x5:padding=4:color=black',
  '-frames:v',
  '1',
  dir + '/contact-sheet.png',
]);
await writeFile(
  dir + '/times.json',
  JSON.stringify(Object.fromEntries(points.map(([n, t]) => [n, +t.toFixed(2)])), null, 2),
);
console.log('Review stills:', points.map(([n, t]) => `${n}@${t.toFixed(1)}`).join(', '));
