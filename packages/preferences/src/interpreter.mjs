import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  PreferenceSchemaError,
  normalizePreferenceProfile,
  validatePreferenceProfile,
} from './schema.mjs';
import { openAiPreferenceProfileJsonSchema } from './openai-schema.mjs';

class PreferenceInterpreterError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = 'PreferenceInterpreterError';
    this.code = code;
  }
}

async function loadEnvFile(path = resolve('.env')) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}

function buildInterpreterMessages(text) {
  return [
    {
      role: 'system',
      content: [
        'You convert natural-language tennis court preferences into a strict JSON Preference Profile.',
        'Do not create numerical weights.',
        'Use only allowed features: price, next_hour_free, start_time, court, venue, weather, calendar.',
        'Use importance only as high, medium, low, or uncertain.',
        'Do not add preferences the user did not state or clearly imply.',
        'Do not upgrade soft preferences to hard constraints unless the user uses absolute language.',
        'Put unmappable preferences into unresolvedPreferences.',
        'Return JSON only.',
      ].join(' '),
    },
    {
      role: 'user',
      content: text,
    },
  ];
}

function parseProviderContent(content) {
  if (typeof content !== 'string') {
    throw new PreferenceInterpreterError('PREFERENCE_INTERPRETER_MALFORMED_OUTPUT', 'LLM output content was not a JSON string');
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new PreferenceInterpreterError('PREFERENCE_INTERPRETER_MALFORMED_OUTPUT', 'LLM output was not valid JSON', { cause: error });
  }
}

function createOpenAiPreferenceProvider({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
} = {}) {
  return {
    name: 'openai-chat-completions',
    async interpret(text) {
      if (!apiKey) {
        throw new PreferenceInterpreterError(
          'LLM_PROVIDER_NOT_CONFIGURED',
          'Missing OPENAI_API_KEY. Add it to .env or the environment before running preference:set.',
        );
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: buildInterpreterMessages(text),
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'preference_profile',
              strict: true,
              schema: openAiPreferenceProfileJsonSchema,
            },
          },
        }),
      });

      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new PreferenceInterpreterError(
          'LLM_PROVIDER_ERROR',
          `OpenAI preference interpreter failed with HTTP ${response.status}${message ? `: ${message}` : ''}`,
        );
      }

      const json = await response.json();
      const content = json?.choices?.[0]?.message?.content;
      return parseProviderContent(content);
    },
  };
}

async function interpretPreferences(text, { provider, now = new Date() } = {}) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new PreferenceInterpreterError('PREFERENCE_INPUT_EMPTY', 'Preference text must be a non-empty string');
  }

  await loadEnvFile();
  const selectedProvider = provider ?? createOpenAiPreferenceProvider();

  let rawProfile;
  try {
    rawProfile = await selectedProvider.interpret(text);
  } catch (error) {
    if (error instanceof PreferenceInterpreterError) throw error;
    throw new PreferenceInterpreterError('LLM_PROVIDER_ERROR', error.message, { cause: error });
  }

  const profile = normalizePreferenceProfile(rawProfile, {
    sourceText: text,
    updatedAt: now.toISOString(),
  });

  try {
    return validatePreferenceProfile(profile);
  } catch (error) {
    if (error instanceof PreferenceSchemaError) {
      throw new PreferenceInterpreterError('PREFERENCE_SCHEMA_REJECTED', error.message, { cause: error });
    }
    throw error;
  }
}

export {
  PreferenceInterpreterError,
  buildInterpreterMessages,
  createOpenAiPreferenceProvider,
  interpretPreferences,
  loadEnvFile,
  parseProviderContent,
};
