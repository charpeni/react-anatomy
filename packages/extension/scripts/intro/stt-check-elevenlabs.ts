import type { NarrationScript, Narration } from './types.ts';
// Word-accuracy check for ElevenLabs narration: transcribes each generated clip with
// ElevenLabs speech-to-text (same provider; audio is not sent anywhere else) and compares
// the words with the script. Writes artifacts/intro/narration-words.json. Never logs the key.
import { readFile, writeFile } from 'node:fs/promises';
import { sanitize } from './narration-audio.ts';

const secrets = process.env.ELEVENLABS_TTS_ENV;

if (!secrets) {
  throw new Error('Set ELEVENLABS_TTS_ENV to your local credentials file.');
}

const manifest: Narration = JSON.parse(await readFile('artifacts/intro/narration.json', 'utf8'));
const script: NarrationScript = JSON.parse(await readFile('scripts/intro/narration.json', 'utf8'));

if (manifest.provider !== 'elevenlabs') {
  throw new Error('Narration manifest is not ElevenLabs.');
}

const key = (await readFile(secrets, 'utf8'))
  .split(/\r?\n/)
  .map((l) => l.match(/^\s*(?:export\s+)?(?:ELEVENLABS_API_KEY|XI_API_KEY)\s*=\s*(.*)\s*$/))
  .find(Boolean)?.[1]
  .replace(/^(['"])(.*)\1$/, '$2')
  .trim();

if (!key) {
  throw new Error('ELEVENLABS_API_KEY is missing.');
}

const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

function distance(a: string[], b: string[]) {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);

  for (let j = 1; j <= b.length; j++) {
    d[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }

  return d[a.length][b.length];
}

const results = [];

for (const clip of manifest.clips) {
  const expected = script.clips.find((c) => c.id === clip.id);
  if (!expected) {
    throw new Error(`Missing script for ${clip.id}`);
  }
  const say = expected.say || expected.cues.join(' ');
  let text = null;
  let error = null;

  for (const model of ['scribe_v2', 'scribe_v1']) {
    const form = new FormData();

    form.append('model_id', model);
    form.append('language_code', 'en');
    form.append(
      'file',
      new Blob([await readFile(clip.file)], { type: 'audio/wav' }),
      clip.id + '.wav',
    );

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
    });
    const body = await response.text();

    if (response.ok) {
      text = JSON.parse(body).text;
      error = null;
      break;
    }

    try {
      const d = JSON.parse(body).detail;

      error = `${response.status}: ${sanitize(typeof d === 'string' ? d : d?.message || body)}`;
    } catch {
      error = `${response.status}`;
    }

    if (response.status === 401 || response.status === 403) {
      break;
    }
  }

  if (error) {
    console.log('Speech-to-text unavailable:', error);
    process.exit(2);
  }

  const a = words(say);
  const b = words(text);
  const errors = distance(a, b);

  results.push({ id: clip.id, expected: say, heard: text, wordErrors: errors, words: a.length });
  console.log(`${clip.id} ${errors ? '≠' : '='} ${errors} errors · heard: ${text}`);
}

await writeFile('artifacts/intro/narration-words.json', JSON.stringify(results, null, 2));
console.log(
  'Total word errors:',
  results.reduce((s, r) => s + r.wordErrors, 0),
  'of',
  results.reduce((s, r) => s + r.words, 0),
  'words',
);
