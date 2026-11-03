// Shared narration post-processing for every TTS provider: trims each generated clip to a
// consistent 48 kHz mono WAV, measures it, splits multi-cue clips at their natural pauses,
// and writes the manifest (artifacts/intro/narration.json) that the recorder and renderer read.
import type { ClipScript, NarrationClip, Cue } from './types.ts';
import { readFile, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ffmpegBinary from 'ffmpeg-static';

if (!ffmpegBinary) {
  throw new Error('FFmpeg is not available on this platform.');
}
const ffmpeg: string = ffmpegBinary;
import type { PathLike } from 'node:fs';

export const exists = (file: PathLike) =>
  access(file).then(
    () => true,
    () => false,
  );

export const sanitize = (text: string) =>
  String(text)
    .replace(/(sk|xi|el)[-_][A-Za-z0-9_-]{8,}/g, '…')
    .replace(/[A-Za-z0-9]{32,}/g, '…')
    .slice(0, 400);

function run(args: string[]) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-nostats', ...args], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });

  if (result.status) {
    throw new Error(result.stderr.slice(-2000));
  }

  return result.stderr;
}

// `input` is an array of ffmpeg input arguments, e.g. ['-i',file] or ['-f','s16le','-ar','24000','-ac','1','-i',file].
export async function finishClip(
  clip: ClipScript,
  input: string[],
  clean: string,
): Promise<NarrationClip> {
  if (!(await exists(clean))) {
    // 48 kHz mono, leading and trailing silence trimmed to a consistent 40–60 ms.
    run([
      '-y',
      ...input,
      '-af',
      'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.06,areverse',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      clean,
    ]);
  }

  const info = run(['-i', clean, '-af', 'silencedetect=noise=-38dB:d=0.12', '-f', 'null', '-']);
  const wav = await readFile(clean);
  const data = wav.indexOf('data', 12, 'ascii');
  const seconds = wav.readUInt32LE(data + 4) / 2 / 48000;

  if (seconds < 0.3) {
    throw new Error(`Clip ${clip.id} is unexpectedly short (${seconds.toFixed(2)} s).`);
  }

  const silences = [...info.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)]
    .map((m) => ({ start: +m[1], end: +m[2] }))
    .filter((s) => s.start > 0.2 && s.end < seconds - 0.2);
  // Split multi-cue clips at the pause closest to each cue's share of the characters.
  const total = clip.cues.join(' ').length;
  let chars = 0;
  let start = 0;
  const cues: Cue[] = [];

  clip.cues.forEach((text, i) => {
    chars += text.length + 1;

    let end = seconds;

    if (i < clip.cues.length - 1) {
      const estimate = (seconds * chars) / total;
      const pause = silences.sort(
        (a, b) =>
          Math.abs((a.start + a.end) / 2 - estimate) - Math.abs((b.start + b.end) / 2 - estimate),
      )[0];

      end =
        pause && Math.abs((pause.start + pause.end) / 2 - estimate) < 0.8
          ? pause.start + 0.05
          : estimate;
    }

    cues.push({ text, start: +start.toFixed(3), end: +end.toFixed(3) });
    start = end;
  });

  return {
    id: clip.id,
    file: clean,
    duration: +seconds.toFixed(3),
    text: clip.cues.join(' '),
    cues,
  };
}

// `voice` describes the provider and carries the AI-voice disclosure texts used on the end
// card (card), in the notes (notes) and in the suggested sharing message (message).
export async function writeManifest(voice: Record<string, unknown>, clips: NarrationClip[]) {
  await writeFile('artifacts/intro/narration.json', JSON.stringify({ ...voice, clips }, null, 2));
  console.log(clips.map((c) => `${c.id} ${c.duration.toFixed(2)}s  ${c.text}`).join('\n'));
  console.log('Total speech:', clips.reduce((s, c) => s + c.duration, 0).toFixed(1), 'seconds');
}
