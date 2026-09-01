import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizePreferenceProfile, validatePreferenceProfile } from './schema.mjs';

const DEFAULT_PREFERENCE_PATH = resolve('data/preferences.json');

class PreferenceStoreError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = 'PreferenceStoreError';
    this.code = code;
  }
}

async function loadPreferenceProfile({ path = DEFAULT_PREFERENCE_PATH } = {}) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new PreferenceStoreError('PREFERENCE_PROFILE_NOT_FOUND', 'No saved preference profile. Run npm run preference:set -- "your preference" first.');
    }
    throw error;
  }

  const profile = JSON.parse(text);
  return validatePreferenceProfile(profile);
}

async function savePreferenceProfile(profile, {
  path = DEFAULT_PREFERENCE_PATH,
  now = new Date(),
} = {}) {
  const normalized = normalizePreferenceProfile(profile, {
    sourceText: profile.sourceText,
    updatedAt: now.toISOString(),
  });
  validatePreferenceProfile(normalized);

  await mkdir(dirname(path), { recursive: true });

  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`);
  await rename(tempPath, path);

  return normalized;
}

export {
  DEFAULT_PREFERENCE_PATH,
  PreferenceStoreError,
  loadPreferenceProfile,
  savePreferenceProfile,
};
