import type { NarrationScript } from './types.ts';
// Generates the narration with OpenAI text-to-speech. Each clip is cached by a hash of
// its model, voice, instructions and text, so editing one line only regenerates that line.
// The API key is read from a dotenv file inside this process and is never logged.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { exists, sanitize, finishClip, writeManifest } from './narration-audio.ts';
import { createHash } from 'node:crypto';

const secrets = process.env.REACT_ANATOMY_TTS_ENV;

if (!secrets) {
  throw new Error('Set REACT_ANATOMY_TTS_ENV to your local credentials file.');
}

const folder = 'artifacts/intro/audio';

await mkdir(folder, { recursive: true });

const script: NarrationScript = JSON.parse(await readFile('scripts/intro/narration.json', 'utf8'));
let key: string | undefined;

async function apiKey() {
  if (key) {
    return key;
  }

  const text = await readFile(secrets!, 'utf8').catch(() => {
    throw new Error('Narration credentials are not available yet.');
  });

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)\s*$/);

    if (match) {
      key = match[1].replace(/^(['"])(.*)\1$/, '$2').trim();
    }
  }

  if (!key) {
    throw new Error('OPENAI_API_KEY is missing from the credentials file.');
  }

  return key;
}

async function speak(input: string) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: script.model,
        voice: script.voice,
        input,
        instructions: script.instructions,
        response_format: 'wav',
      }),
    });

    if (response.ok) {
      return Buffer.from(await response.arrayBuffer());
    }

    const body = await response.text().catch(() => '');
    let message = body;

    try {
      message = JSON.parse(body).error?.message || body;
    } catch {}

    if (attempt < 4 && (response.status === 429 || response.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }

    throw new Error(`Speech request failed (${response.status}): ${sanitize(message)}`);
  }
}

const manifest = [];

for (const clip of script.clips) {
  const input = clip.say || clip.cues.join(' ');
  const hash = createHash('sha256')
    .update(JSON.stringify([script.model, script.voice, script.instructions, input]))
    .digest('hex')
    .slice(0, 16);
  const raw = `${folder}/${clip.id}-${hash}.raw.wav`;
  const clean = `${folder}/${clip.id}-${hash}.wav`;

  if (!(await exists(raw))) {
    console.log(`Generating ${clip.id}: ${input}`);
    await writeFile(raw + '.part', await speak(input));
    await rename(raw + '.part', raw);
  }

  manifest.push(await finishClip(clip, ['-i', raw], clean));
}

await writeManifest(
  {
    provider: 'openai',
    model: script.model,
    voice: script.voice,
    disclosure: {
      card: 'Narration is an AI-generated voice (OpenAI text-to-speech).',
      notes: `The narration is an AI-generated voice created with OpenAI text-to-speech (${script.model}, voice “${script.voice}”). It is not a human recording. The end card of the video says so as well.`,
      message: 'the narration is an AI voice',
    },
  },
  manifest,
);
