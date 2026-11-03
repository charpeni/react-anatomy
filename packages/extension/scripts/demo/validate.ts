import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ffmpegBinary from 'ffmpeg-static';

if (!ffmpegBinary) {
  throw new Error('FFmpeg is not available on this platform.');
}
const ffmpeg: string = ffmpegBinary;

const folder = 'artifacts/demo/deliverables';
const results = [];
const expected = JSON.parse(await readFile('artifacts/demo/timeline.json', 'utf8')).duration;

for (const size of ['1440p', '1080p']) {
  const file = `${folder}/react-anatomy-demo-${size}.mp4`;
  const buffer = await readFile(file);
  const atoms = [];

  for (let offset = 0; offset + 8 <= buffer.length;) {
    let length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);

    if (length === 1) {
      length = Number(buffer.readBigUInt64BE(offset + 8));
    }

    if (length === 0) {
      length = buffer.length - offset;
    }

    atoms.push({ type, offset, length });

    if (length < 8) {
      throw Error('Invalid MP4 atom');
    }

    offset += length;
  }

  if (atoms.find((a) => a.type === 'moov')!.offset > atoms.find((a) => a.type === 'mdat')!.offset) {
    throw Error('Fast-start metadata missing');
  }

  const info = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  const durationMatch = info.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!durationMatch) {
    throw new Error('Missing video duration');
  }
  const actual = +durationMatch[1] * 3600 + +durationMatch[2] * 60 + +durationMatch[3];

  if (Math.abs(actual - expected) > 0.05) {
    throw Error(`Export duration ${actual} differs from timeline ${expected}`);
  }

  const stream = info.split('\n').find((line) => line.includes('Video:'));
  if (!stream) {
    throw new Error('Missing video stream');
  }

  if (
    !stream.includes(size === '1440p' ? '2560x1440' : '1920x1080') ||
    !stream.includes('30 fps') ||
    !stream.includes('yuv420p')
  ) {
    throw Error('Unexpected video format: ' + stream);
  }

  const decoded = spawnSync(
    ffmpeg,
    ['-v', 'error', '-threads', '4', '-i', file, '-map', '0:v:0', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );

  if (decoded.status !== 0 || decoded.stderr.trim()) {
    throw Error('Video decode failed: ' + decoded.stderr);
  }

  const result = {
    file,
    bytes: buffer.length,
    stream: stream.trim(),
    duration: info.match(/Duration: ([^,]+)/)?.[1],
    fastStart: true,
    fullDecode: 'passed',
    audio: info.includes('Audio:'),
  };

  results.push(result);
  console.log(result);
}

await writeFile('artifacts/demo/validation.json', JSON.stringify(results, null, 2));
