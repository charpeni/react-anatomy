import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import ffmpegBinary from 'ffmpeg-static';

if (!ffmpegBinary) {
  throw new Error('FFmpeg is not available on this platform.');
}
const ffmpeg: string = ffmpegBinary;

const dir = resolve('artifacts/demo');
const data = JSON.parse(await readFile(dir + '/timeline.json', 'utf8'));

await mkdir(dir + '/review', { recursive: true });

const points = [2, 10, 17, 25, 36, 45, 52, 63, 76, 85, 92, 100];
let t = 0;
const spans = data.frames.map((frame: { duration: number }) => {
  const span = { ...frame, start: t, end: t + frame.duration };

  t = span.end;

  return span;
});

for (const [i, time] of points.entries()) {
  const frame = spans.find((f: { start: number; end: number }) => f.start <= time && f.end > time);
  const result = spawnSync(
    ffmpeg,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      dir + '/' + frame.file,
      '-vf',
      `setpts=PTS+${time}/TB,pad=2560:1440:0:0:color=0x17191c,ass=${dir}/overlays.ass:fontsdir=${resolve('scripts/demo/fonts')},scale=1280:720`,
      '-frames:v',
      '1',
      dir + `/review/${String(i).padStart(2, '0')}.png`,
    ],
    {
      env: { ...process.env, FONTCONFIG_FILE: resolve('scripts/demo/fonts.conf') },
      encoding: 'utf8',
    },
  );

  if (result.status) {
    throw new Error(result.stderr);
  }
}

const tiled = spawnSync(
  ffmpeg,
  [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-framerate',
    '1',
    '-i',
    dir + '/review/%02d.png',
    '-vf',
    'scale=640:360,tile=3x4',
    '-frames:v',
    '1',
    dir + '/review/contact-sheet.png',
  ],
  { encoding: 'utf8' },
);

if (tiled.status) {
  throw new Error(tiled.stderr);
}

console.log('Review frames:', points.join(', '), 'seconds');
await writeFile(dir + '/review/times.json', JSON.stringify(points));
