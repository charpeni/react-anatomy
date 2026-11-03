import type { NarrationScript } from './types.ts';
// Generates the narration with ElevenLabs text-to-speech in the user's own saved voice.
//   node scripts/intro/tts-elevenlabs.ts --find   find and verify the voice only
//   node scripts/intro/tts-elevenlabs.ts          find/verify, then generate every clip
// Only the user's own (personal) voices are considered; library voices are never used.
// Clips are cached under artifacts/intro/audio-elevenlabs by a hash of provider, voice ID,
// model, voice settings, output format, seed, context and text, so they can never be confused
// with the OpenAI clips. The API key is read from a dotenv file inside this process only and
// is never logged; errors are sanitised.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { exists, sanitize, finishClip, writeManifest } from './narration-audio.ts';

interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
}
interface Voice {
  voice_id: string;
  name: string;
  category: string;
  is_owner?: boolean;
  created_at_unix?: number;
  description?: string;
  labels?: Record<string, string>;
  fine_tuning?: { state?: Record<string, string> };
  settings?: VoiceSettings;
  high_quality_base_model_ids?: string[];
}
interface VoiceConfig {
  voiceName: string;
  voiceId?: string;
  models: string[];
  settings?: VoiceSettings;
  outputFormats: string[];
  seed: number;
  useContext: boolean;
}
interface ApiOptions {
  method?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  binary?: boolean;
}

const secrets = process.env.ELEVENLABS_TTS_ENV;

if (!secrets) {
  throw new Error('Set ELEVENLABS_TTS_ENV to your local credentials file.');
}

const config: VoiceConfig = JSON.parse(
  await readFile(
    process.env.ELEVENLABS_VOICE_CONFIG || 'scripts/intro/voice-elevenlabs.local.json',
    'utf8',
  ),
);
const script: NarrationScript = JSON.parse(await readFile('scripts/intro/narration.json', 'utf8'));
const folder = 'artifacts/intro/audio-elevenlabs';
const voiceFile = 'artifacts/intro/elevenlabs-voice.json';

await mkdir(folder, { recursive: true });

let key: string | undefined;

async function apiKey() {
  if (key) {
    return key;
  }

  const text = await readFile(secrets!, 'utf8').catch(() => {
    throw new Error('ElevenLabs credentials are not available yet (credential file missing).');
  });

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?(?:ELEVENLABS_API_KEY|XI_API_KEY)\s*=\s*(.*)\s*$/);

    if (match) {
      key = match[1].replace(/^(['"])(.*)\1$/, '$2').trim();
    }
  }

  if (!key) {
    throw new Error('ELEVENLABS_API_KEY is missing from the credentials file.');
  }

  return key;
}

class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, message: string) {
    super(`ElevenLabs request failed (${status}): ${message}`);
    this.status = status;
    this.detail = message;
  }
}

function api(path: string, options: ApiOptions & { binary: true }): Promise<Buffer>;
function api<T>(path: string, options?: ApiOptions & { binary?: false }): Promise<T>;
async function api(
  path: string,
  { method = 'GET', query, body, binary = false }: ApiOptions = {},
): Promise<unknown> {
  const url = new URL('https://api.elevenlabs.io' + path);

  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }

  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      method,
      headers: {
        'xi-api-key': await apiKey(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body && method !== 'GET' && method !== 'HEAD' ? { body: JSON.stringify(body) } : {}),
    });

    if (response.ok) {
      return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
    }

    const text = await response.text().catch(() => '');
    let message = text;

    try {
      const d = JSON.parse(text).detail;

      message =
        typeof d === 'string'
          ? d
          : d?.message
            ? `${d.status ? d.status + ': ' : ''}${d.message}`
            : Array.isArray(d)
              ? d.map((x) => x.msg || JSON.stringify(x)).join('; ')
              : text;
    } catch {}

    if (attempt < 4 && (response.status === 429 || response.status >= 500)) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }

    throw new ApiError(response.status, sanitize(message));
  }
}

// ---- Find the user's own voice ----------------------------------------------------------
const describe = (v: Voice) => ({
  voice_id: v.voice_id,
  name: v.name,
  category: v.category,
  is_owner: v.is_owner,
  created: v.created_at_unix ? new Date(v.created_at_unix * 1000).toISOString().slice(0, 10) : null,
  description: (v.description || '').slice(0, 80) || null,
  labels: v.labels || {},
  fine_tuning_state: v.fine_tuning?.state || null,
});

async function personalVoices() {
  const voices: Voice[] = [];
  let token: string | null | undefined;

  do {
    const page = await api<{ voices: Voice[]; has_more: boolean; next_page_token?: string }>(
      '/v2/voices',
      {
        query: {
          voice_type: 'personal',
          page_size: 100,
          next_page_token: token,
          include_total_count: true,
        },
      },
    );

    voices.push(...page.voices);
    token = page.has_more ? page.next_page_token : null;
  } while (token);

  return voices;
}

async function findVoice() {
  const wanted = config.voiceName.trim().toLowerCase();
  const mine = await personalVoices();
  const exact = mine.filter(
    (v) => v.name.trim().toLowerCase() === wanted && v.category !== 'premade',
  );

  if (config.voiceId) {
    const pinned = mine.find((v) => v.voice_id === config.voiceId);

    if (!pinned) {
      throw new Error(`Pinned voice ${config.voiceId} is not one of your own voices.`);
    }

    return pinned;
  }

  if (exact.length === 1) {
    return exact[0];
  }

  if (exact.length > 1) {
    throw new Error(
      `Several of your voices are named “${config.voiceName}”: ${JSON.stringify(exact.map(describe))}. Set "voiceId" in your ELEVENLABS_VOICE_CONFIG file.`,
    );
  }

  const similar = mine.filter((v) => v.name.toLowerCase().includes(wanted)).map(describe);

  throw new Error(
    `No voice of your own is named “${config.voiceName}” (${mine.length} personal voices checked)${similar.length ? `; similar names: ${JSON.stringify(similar)}` : ''}.`,
  );
}

async function verify() {
  const match = await findVoice();
  const voice = await api<Voice>(`/v1/voices/${match.voice_id}`, {
    query: { with_settings: true },
  });
  const stored = await api<VoiceSettings>(`/v1/voices/${match.voice_id}/settings`).catch(
    () => voice.settings || {},
  );
  // Listing models needs the models_read permission; without it, generation itself verifies the model.
  const models = await api<{ model_id: string; can_do_text_to_speech: boolean }[]>(
    '/v1/models',
  ).catch((error) => {
    if (error.status === 401 || error.status === 403) {
      console.log(
        'Model list not readable with this key; the first generation will verify the model.',
      );

      return null;
    }

    throw error;
  });
  const candidates = models
    ? config.models.filter((id) => models.some((m) => m.model_id === id && m.can_do_text_to_speech))
    : [...config.models];

  if (!candidates.length) {
    throw new Error('None of the preferred models is available: ' + config.models.join(', '));
  }

  const info = {
    ...describe(voice),
    is_owner: voice.is_owner ?? match.is_owner,
    high_quality_base_model_ids: voice.high_quality_base_model_ids || [],
    storedSettings: stored,
    candidateModels: candidates,
    verifiedAt: new Date().toISOString(),
  };

  if (info.category === 'premade') {
    throw new Error('Matched voice is a premade voice, not your own.');
  }

  await writeFile(voiceFile, JSON.stringify(info, null, 2));
  console.log(
    'Matched your voice:',
    JSON.stringify({
      voice_id: info.voice_id,
      name: info.name,
      category: info.category,
      is_owner: info.is_owner,
      created: info.created,
      fine_tuning_state: info.fine_tuning_state,
      high_quality_base_model_ids: info.high_quality_base_model_ids,
    }),
  );
  console.log(
    'Stored voice settings:',
    JSON.stringify(stored),
    '· candidate models:',
    candidates.join(', '),
  );

  return info;
}

// ---- Generate ----------------------------------------------------------------------------
function settingsFor(info: Pick<Awaited<ReturnType<typeof verify>>, 'storedSettings'>) {
  const s = info.storedSettings || {};

  // Start from the voice's own saved settings; keep delivery natural and words accurate (no style exaggeration).
  return {
    stability: s.stability ?? 0.5,
    similarity_boost: s.similarity_boost ?? 0.8,
    style: 0,
    use_speaker_boost: s.use_speaker_boost ?? true,
    speed: s.speed ?? 1,
    ...config.settings,
  };
}

async function generate(info: Awaited<ReturnType<typeof verify>>) {
  const settings = settingsFor(info);
  const texts = script.clips.map((c) => c.say || c.cues.join(' '));
  let models = [...info.candidateModels];
  let formats = [...config.outputFormats];
  const manifest = [];

  for (let i = 0; i < script.clips.length; i++) {
    const clip = script.clips[i];
    const text = texts[i];

    for (;;) {
      const model = models[0];
      const format = formats[0];
      const context = config.useContext
        ? { previous_text: texts[i - 1] || null, next_text: texts[i + 1] || null }
        : {};
      const hash = createHash('sha256')
        .update(
          JSON.stringify([
            'elevenlabs',
            info.voice_id,
            model,
            settings,
            format,
            config.seed,
            context,
            text,
          ]),
        )
        .digest('hex')
        .slice(0, 16);
      const ext = format.startsWith('pcm') ? 'pcm' : format.split('_')[0];
      const raw = `${folder}/${clip.id}-${hash}.${ext}`;
      const clean = `${folder}/${clip.id}-${hash}.wav`;

      try {
        if (!(await exists(raw))) {
          console.log(`Generating ${clip.id} (${model}, ${format}): ${text}`);

          const audio = await api(`/v1/text-to-speech/${info.voice_id}`, {
            method: 'POST',
            binary: true,
            query: { output_format: format },
            body: {
              text,
              model_id: model,
              voice_settings: settings,
              seed: config.seed,
              apply_text_normalization: 'auto',
              ...context,
            },
          });

          await writeFile(raw + '.part', audio);
          await rename(raw + '.part', raw);
        }

        const input =
          ext === 'pcm'
            ? ['-f', 's16le', '-ar', format.split('_')[1], '-ac', '1', '-i', raw]
            : ['-i', raw];

        manifest.push({ ...(await finishClip(clip, input, clean)), model, format });
        break;
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error;
        }

        if (/previous_text|next_text/i.test(error.detail) && config.useContext) {
          console.log('Context stitching unsupported here; generating clips without it.');
          config.useContext = false;
          i = -1;
          manifest.length = 0;
          break;
        }

        if (/output_format|format|tier|subscription/i.test(error.detail) && formats.length > 1) {
          console.log(
            `Output format ${format} unavailable (${error.status}); trying ${formats[1]}.`,
          );
          formats.shift();
          i = -1;
          manifest.length = 0;
          break;
        }

        if (/model/i.test(error.detail) && models.length > 1) {
          console.log(
            `Model ${model} unavailable for this voice (${error.status}); trying ${models[1]}.`,
          );
          models.shift();
          i = -1;
          manifest.length = 0;
          break;
        }

        throw error;
      }
    }
  }

  const model = manifest[0].model;
  const format = manifest[0].format;

  if (manifest.some((c) => c.model !== model || c.format !== format)) {
    throw new Error('Clips were generated with mixed models or formats.');
  }

  await writeManifest(
    {
      provider: 'elevenlabs',
      model,
      voice: info.name,
      voiceId: info.voice_id,
      voiceCategory: info.category,
      settings,
      outputFormat: format,
      disclosure: {
        card: `AI-generated narration using ${info.name}'s voice (ElevenLabs).`,
        notes: `The narration is AI-generated speech: ElevenLabs text-to-speech (${model}) using ${info.name}'s own saved voice, “${info.name}”. The script was synthesized, not read aloud and recorded. The end card of the video says so as well.`,
        message: `the narration is AI-generated with ElevenLabs from my own voice`,
      },
    },
    manifest.map(({ model, format, ...c }) => c),
  );
}

try {
  const info = await verify();

  if (!process.argv.includes('--find')) {
    await generate(info);
  }
} catch (error) {
  console.error(sanitize(error instanceof Error ? error.message : String(error)));
  process.exit(1);
}
