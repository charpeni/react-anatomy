import type { RenderedCue, IntroTimeline, Narration } from './types.ts';
// Validates the exported deliverables: container, codecs, colour tags, fast start, full
// decode, loudness, narration/subtitle sync, and the extension archive.
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ffmpegBinary from 'ffmpeg-static';

if (!ffmpegBinary) {
  throw new Error('FFmpeg is not available on this platform.');
}
const ffmpeg: string = ffmpegBinary;

const dir = 'artifacts/intro';
const out = dir + '/deliverables';
const name = 'react-anatomy-intro';
const version = JSON.parse(await readFile('dist/extension/manifest.json', 'utf8')).version;
const timeline: IntroTimeline = JSON.parse(await readFile(dir + '/timeline.json', 'utf8'));
const cues: RenderedCue[] = JSON.parse(await readFile(dir + '/cues.json', 'utf8'));
const narration: Narration = JSON.parse(await readFile(dir + '/narration.json', 'utf8'));

const fail = (m: string): never => {
  throw new Error(m);
};

const run = (args: string[]) =>
  spawnSync(ffmpeg, ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

const results: {
  duration: number;
  videos: {
    file: string;
    bytes: number;
    duration: number;
    video: string;
    audio: string;
    fastStart: boolean;
    fullDecode: string;
    integratedLoudness: number;
    truePeak: number;
    chapters: number;
  }[];
  [section: string]: unknown;
} = { duration: timeline.duration, videos: [] };

for (const [file, size] of [
  [`${name}-1080p.mp4`, '1920x1080'],
  [`${name}-1440p.mp4`, '2560x1440'],
  [`${name}-1440p-clean.mp4`, '2560x1440'],
]) {
  const path = `${out}/${file}`;
  const buffer = await readFile(path);
  const atoms = [];

  for (let o = 0; o + 8 <= buffer.length;) {
    let l = buffer.readUInt32BE(o);
    const type = buffer.toString('ascii', o + 4, o + 8);

    if (l === 1) {
      l = Number(buffer.readBigUInt64BE(o + 8));
    }

    if (l === 0) {
      l = buffer.length - o;
    }

    if (l < 8) {
      fail('Invalid MP4 atom');
    }

    atoms.push({ type, o });
    o += l;
  }

  if (atoms.find((a) => a.type === 'moov')!.o > atoms.find((a) => a.type === 'mdat')!.o) {
    fail(file + ': moov after mdat');
  }

  const info = run(['-i', path]).stderr;
  const d = info.match(/Duration: (\d+):(\d+):([\d.]+)/) ?? fail('Missing video duration');
  const actual = +d[1] * 3600 + +d[2] * 60 + +d[3];

  if (Math.abs(actual - timeline.duration) > 0.06) {
    fail(`${file}: duration ${actual} vs ${timeline.duration}`);
  }

  const v = info.split('\n').find((l) => l.includes('Video:')) ?? fail('Missing video stream');
  const a = info.split('\n').find((l) => l.includes('Audio:')) ?? fail('Missing audio stream');

  for (const want of ['h264 (High)', 'yuv420p(tv, bt709, progressive)', size, '30 fps']) {
    if (!v.includes(want)) {
      fail(`${file}: video missing ${want}: ${v}`);
    }
  }

  for (const want of ['aac', '48000 Hz', 'stereo']) {
    if (!a?.includes(want)) {
      fail(`${file}: audio missing ${want}: ${a}`);
    }
  }

  const decode = run(['-v', 'error', '-threads', '8', '-i', path, '-f', 'null', '-']);

  if (decode.status || decode.stderr.trim()) {
    fail(`${file}: decode errors ${decode.stderr.slice(0, 500)}`);
  }

  const loud = run([
    '-nostats',
    '-i',
    path,
    '-map',
    '0:a',
    '-af',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ]).stderr;
  const I = +loud
    .match(/I:\s+(-?[\d.]+) LUFS/g)!
    .at(-1)!
    .match(/-?[\d.]+/)![0];
  const peak = +loud
    .match(/Peak:\s+(-?[\d.]+) dBFS/g)!
    .at(-1)!
    .match(/-?[\d.]+/)![0];

  if (Math.abs(I + 16) > 1 || peak > -1) {
    fail(`${file}: loudness ${I} LUFS, true peak ${peak}`);
  }

  const chapters = (info.match(/Chapter #/g) || []).length;

  results.videos.push({
    file: path,
    bytes: buffer.length,
    duration: actual,
    video: v.trim().replace(/^.*Video: /, ''),
    audio: a.trim().replace(/^.*Audio: /, ''),
    fastStart: true,
    fullDecode: 'clean',
    integratedLoudness: I,
    truePeak: peak,
    chapters,
  });
  console.log(file, 'ok', actual.toFixed(2) + 's', I + ' LUFS', peak + ' dBTP');
}

// Narration onsets in the final audio must match the recorded speech schedule.
const sil = run([
  '-nostats',
  '-i',
  `${out}/${name}-1080p.mp4`,
  '-map',
  '0:a',
  '-af',
  'silencedetect=noise=-45dB:d=0.18',
  '-f',
  'null',
  '-',
]).stderr;
const onsets = [...sil.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
const sync = timeline.speech.map((s) => {
  const near = onsets.reduce(
    (b, o) => (Math.abs(o - s.start) < Math.abs(b - s.start) ? o : b),
    Infinity,
  );

  return { id: s.id, scheduled: s.start, detected: near, offset: +(near - s.start).toFixed(3) };
});
const late = sync.filter((s: { offset: number }) => Math.abs(s.offset) > 0.12);

if (late.length) {
  fail('Narration out of sync: ' + JSON.stringify(late));
}

results.narrationSync = {
  maxOffset: Math.max(...sync.map((s: { offset: number }) => Math.abs(s.offset))),
  clips: sync.length,
};
// Subtitles: one cue sequence, ordered, non-overlapping, starting with each clip.
cues.forEach((c: { end: number; start: number; text: string; lines: number }, i: number) => {
  if (c.end <= c.start) {
    fail('Empty cue ' + c.text);
  }

  if (i && cues[i - 1].end > c.start + 1e-3) {
    fail('Overlapping cues at ' + c.text);
  }

  if (c.lines > 2) {
    fail('Cue over two lines');
  }
});

for (const s of timeline.speech) {
  const first = narration.clips.find((c) => c.id === s.id)!.cues[0].text;
  const cue = cues.find((c) => c.text === first) ?? fail('Missing subtitle cue');

  if (Math.abs(cue.start - s.start) > 0.01) {
    fail('Cue not aligned ' + first);
  }
}

const spoken = narration.clips.flatMap((c) => c.cues.map((q) => q.text)).join(' ');
const shown = cues.map((c) => c.text).join(' ');

if (spoken !== shown) {
  fail('Subtitles do not match narration');
}

if (cues.at(-1)!.end > timeline.duration) {
  fail('Subtitle past end');
}

const srt = (await readFile(`${out}/${name}.en.srt`, 'utf8')).trim().split(/\n\n/).length;

if (srt !== cues.length) {
  fail('SRT cue count');
}

// Subtitle bounds measured on the encoded share copy: diff each cue's mid frame against the
// clean master at the same time and require a compact, centered caption in the top band.
const gray = (file: string, t: number) => {
  const r = spawnSync(
    ffmpeg,
    [
      '-v',
      'error',
      '-ss',
      t.toFixed(3),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      'scale=1920:1080,format=gray',
      '-f',
      'rawvideo',
      '-',
    ],
    { maxBuffer: 1 << 23 },
  );

  if (r.status || r.stdout.length !== 1920 * 1080) {
    fail('Frame extraction failed at ' + t);
  }

  return r.stdout;
};

const bounds = [];

for (const c of cues) {
  const t = (c.start + c.end) / 2;
  const a = gray(`${out}/${name}-1080p.mp4`, t);
  const b = gray(`${out}/${name}-1440p-clean.mp4`, t);
  const rows = Array.from({ length: 1080 }, () => 0);
  const cols = Array.from({ length: 1920 }, () => 0);

  for (let y = 0; y < 1080; y++) {
    for (let x = 0; x < 1920; x++) {
      if (Math.abs(a[y * 1920 + x] - b[y * 1920 + x]) > 48) {
        rows[y]++;
        cols[x]++;
      }
    }
  }

  const ys = rows.flatMap((n, y) => (n >= 4 ? [y] : []));
  const xs = cols.flatMap((n, x) => (n >= 4 ? [x] : []));

  if (!ys.length) {
    fail('Subtitle not visible: ' + c.text);
  }

  const box = { left: xs[0], right: xs.at(-1)!, top: ys[0], bottom: ys.at(-1)! };
  const center = (box.left + box.right) / 2;

  if (
    box.left < 60 ||
    box.right > 1860 ||
    box.top < 4 ||
    box.bottom > 140 ||
    Math.abs(center - 960) > 12 ||
    box.right - box.left > 1300
  ) {
    fail(`Subtitle bounds wrong for “${c.text}”: ${JSON.stringify(box)}`);
  }

  bounds.push({ text: c.text, time: +t.toFixed(2), ...box });
}

await writeFile(dir + '/subtitle-bounds.json', JSON.stringify(bounds, null, 2));
results.subtitles = {
  encodedBounds: {
    maxBottom: Math.max(...bounds.map((b) => b.bottom)),
    minLeft: Math.min(...bounds.map((b) => b.left)),
    maxRight: Math.max(...bounds.map((b) => b.right)),
    maxCenterOffset: Math.max(...bounds.map((b) => Math.abs((b.left + b.right) / 2 - 960))),
  },
  cues: cues.length,
  maxLines: Math.max(...cues.map((c) => c.lines)),
  srt,
  matchesNarration: true,
};
results.ending = {
  lastSpeechEnd: +(
    timeline.speech.at(-1)!.start +
    narration.clips.find((c) => c.id === timeline.speech.at(-1)!.id)!.duration
  ).toFixed(2),
  endCard: timeline.events.end,
  duration: timeline.duration,
};

const listZip = (file: string) => {
  const r = spawnSync(
    'python3',
    [
      '-I',
      '-c',
      'import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);bad=z.testzip();print(json.dumps({"bad":bad,"files":z.namelist()}))',
      file,
    ],
    { encoding: 'utf8' },
  );

  if (r.status) {
    fail('Cannot read ' + file);
  }

  return JSON.parse(r.stdout);
};

const dev = listZip(`${out}/developer-only/react-anatomy-extension-${version}.zip`);

if (
  dev.bad ||
  !dev.files.includes('manifest.json') ||
  dev.files.some((f: string) => /\.env|secret/i.test(f))
) {
  fail('Developer extension archive problem');
}

const manifest = JSON.parse(
  spawnSync(
    'python3',
    [
      '-I',
      '-c',
      'import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read("manifest.json").decode())',
      `${out}/developer-only/react-anatomy-extension-${version}.zip`,
    ],
    { encoding: 'utf8' },
  ).stdout,
);

if (manifest.name !== 'React Anatomy' || manifest.version !== version) {
  fail('Developer archive manifest mismatch');
}

// The sharing kit is the concept video only: no extension, no install or try-it instructions.
const kit = listZip(`${out}/${name}-share-kit.zip`);
const expected = ['-1080p.mp4', '.en.srt', '.en.vtt', '-poster.png']
  .map((s) => `${name}/${name}${s}`)
  .concat(`${name}/README.txt`);

if (kit.bad || kit.files.slice().sort().join() !== expected.slice().sort().join()) {
  fail('Share kit contents: ' + kit.files.join(', '));
}

const notes = await readFile(`${out}/README.txt`, 'utf8');
const spokenText = narration.clips.map((c) => c.text).join(' ');
const subtitleText = cues.map((c) => c.text).join(' ');
const endCard = (await readFile(dir + '/compose.html', 'utf8'))
  .match(/<div id="end">([\s\S]*?)<\/div><\/div>/)![1]
  .replace(/<[^>]+>/g, ' ');
const metadata = await readFile(dir + '/chapters.txt', 'utf8');

for (const [label, text] of [
  ['narration', spokenText],
  ['subtitles', subtitleText],
  ['end card', endCard],
  ['metadata', metadata],
  ['sharing notes', notes],
]) {
  if (/strata/i.test(text)) {
    fail(`Old product name in ${label}`);
  }

  if (
    /\b(install|download|try it|try out|test it|beta|load unpacked|chrome:\/\/|unzip|\.zip|preview v|early preview)\b/i.test(
      text,
    )
  ) {
    fail(`Call to try/install in ${label}`);
  }
}

for (const [label, text] of [
  ['subtitles', subtitleText],
  ['end card', endCard],
  ['metadata', metadata],
  ['sharing notes', notes],
]) {
  if (!/React Anatomy|Anatomy/.test(text)) {
    fail('Product name missing in ' + label);
  }
}

if (
  !/Anatomy/.test(spokenText) ||
  !/React Anatomy/.test(endCard) ||
  !/work in progress/i.test(spokenText) ||
  !/Work in progress/i.test(endCard)
) {
  fail('Naming or work-in-progress status missing');
}

// Public copy carries no narration/production credit: no voice, provider or AI-generation label.
const credit =
  /AI[- ]generated|text-to-speech|\bTTS\b|ElevenLabs|Eleven Labs|OpenAI|\bcedar\b|gpt-4o|eleven_v|synthesi[sz]ed|voice clone|cloned voice|my (own )?voice|Nicolas['’]s voice|AI voice/i;
const publicCopy = [
  ['end card', endCard],
  ['metadata', metadata],
  ['sharing notes', notes],
  ['subtitles (srt)', await readFile(`${out}/${name}.en.srt`, 'utf8')],
  ['subtitles (vtt)', await readFile(`${out}/${name}.en.vtt`, 'utf8')],
];

for (const file of results.videos.map((v) => v.file)) {
  const tags = run(['-i', file])
    .stderr.split('\n')
    .filter((l) => /^\s+(title|comment|artist|description|album|composer|copyright)\s*:/.test(l))
    .join('\n');

  publicCopy.push(['metadata of ' + file.split('/').at(-1), tags]);
}

for (const [label, text] of publicCopy) {
  if (credit.test(text)) {
    fail(`Narration credit found in ${label}: ${text.match(credit)![0]}`);
  }
}

if (/\n\s*\n\s*\n/.test(notes.replace(/\n+$/, '')) || /\(\s*\)/.test(notes + endCard)) {
  fail('Empty section or parentheses left in public copy');
}

// The narration audio must be identical to the approved mix.
const baseline = (await readFile(dir + '/audio-baseline.txt', 'utf8').catch(() => ''))
  .trim()
  .split('\n');

if (baseline.length === 4) {
  const wavHash = spawnSync('sha256sum', [dir + '/narration.wav'], {
    encoding: 'utf8',
  }).stdout.slice(0, 64);

  if (wavHash !== baseline[0]) {
    fail('Narration mix changed');
  }

  for (const v of results.videos) {
    const md5 = run(['-v', 'error', '-i', v.file, '-map', '0:a', '-f', 'md5', '-']).stdout.trim();

    if (md5 !== baseline[1]) {
      fail('Audio stream changed in ' + v.file);
    }
  }

  results.audioUnchanged = {
    mixSha256Matches: true,
    decodedAudioMd5Matches: results.videos.length,
  };
}

results.archives = {
  shareKit: kit.files,
  developerArchive: {
    file: `${out}/developer-only/react-anatomy-extension-${version}.zip`,
    files: dev.files.length,
    manifest: `${manifest.name} ${manifest.version}`,
  },
  integrity: 'ok',
};
results.copy = {
  oldName: 'absent',
  tryOrInstallCalls: 'absent',
  narrationCredit: 'absent',
  workInProgress: true,
};
await writeFile(dir + '/validation.json', JSON.stringify(results, null, 2));
console.log(
  JSON.stringify({
    sync: results.narrationSync,
    subtitles: results.subtitles,
    ending: results.ending,
    archives: results.archives,
    copy: results.copy,
    audio: results.audioUnchanged,
  }),
);
