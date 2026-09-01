const PREFERENCE_VERSION = 1;

const allowedFeatures = new Set([
  'price',
  'next_hour_free',
  'start_time',
  'court',
  'venue',
  'weather',
  'calendar',
]);

const allowedImportance = new Set(['high', 'medium', 'low', 'uncertain']);
const allowedTypes = new Set(['hard', 'soft']);
const allowedDirections = new Set(['lower', 'higher', 'earlier', 'later', 'preferred', 'avoid']);

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

class PreferenceSchemaError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'PreferenceSchemaError';
    this.code = 'PREFERENCE_SCHEMA_ERROR';
    this.issues = issues;
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stripNullableOptionals(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripNullableOptionals(item));
  }

  if (!isPlainObject(value)) return value;

  const copy = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === null && ['direction', 'target', 'rule', 'value', 'before', 'after', 'equals'].includes(key)) {
      continue;
    }
    copy[key] = stripNullableOptionals(child);
  }

  if (isPlainObject(copy.rule) && Object.keys(copy.rule).length === 0) {
    delete copy.rule;
  }

  return copy;
}

function mergeStartTimeWindows(preferences) {
  const merged = [];
  const consumed = new Set();

  for (let index = 0; index < preferences.length; index += 1) {
    if (consumed.has(index)) continue;

    const preference = preferences[index];
    if (preference.feature !== 'start_time' || !isPlainObject(preference.rule)) {
      merged.push(preference);
      continue;
    }

    const before = preference.rule.before;
    const after = preference.rule.after;
    if (before && after) {
      merged.push(preference);
      continue;
    }

    const counterpartIndex = preferences.findIndex((candidate, candidateIndex) => {
      if (candidateIndex <= index || consumed.has(candidateIndex)) return false;
      return candidate.feature === 'start_time'
        && candidate.type === preference.type
        && candidate.importance === preference.importance
        && isPlainObject(candidate.rule)
        && Boolean(before ? candidate.rule.after : candidate.rule.before)
        && !candidate.rule.equals
        && !preference.rule.equals;
    });

    if (counterpartIndex === -1) {
      merged.push(preference);
      continue;
    }

    const counterpart = preferences[counterpartIndex];
    consumed.add(counterpartIndex);
    merged.push({
      feature: 'start_time',
      type: preference.type,
      importance: preference.importance,
      rule: {
        before: before ?? counterpart.rule.before,
        after: after ?? counterpart.rule.after,
      },
    });
  }

  return merged;
}

function validateTimeRule(rule, path, issues) {
  if (rule === undefined) return;
  if (!isPlainObject(rule)) {
    issues.push(`${path}.rule must be an object`);
    return;
  }

  const allowedKeys = new Set(['before', 'after', 'equals']);
  for (const key of Object.keys(rule)) {
    if (!allowedKeys.has(key)) issues.push(`${path}.rule.${key} is not allowed`);
  }

  for (const key of allowedKeys) {
    if (rule[key] !== undefined && (typeof rule[key] !== 'string' || !timePattern.test(rule[key]))) {
      issues.push(`${path}.rule.${key} must be HH:mm`);
    }
  }
}

function validatePreference(preference, path, { requireHardType = false } = {}) {
  const issues = [];
  if (!isPlainObject(preference)) {
    return [`${path} must be an object`];
  }

  for (const key of Object.keys(preference)) {
    if (!['feature', 'type', 'importance', 'direction', 'target', 'rule', 'value'].includes(key)) {
      issues.push(`${path}.${key} is not allowed`);
    }
  }

  if (!allowedFeatures.has(preference.feature)) {
    issues.push(`${path}.feature must be one of ${[...allowedFeatures].join(', ')}`);
  }

  if (!allowedTypes.has(preference.type)) {
    issues.push(`${path}.type must be hard or soft`);
  }

  if (requireHardType && preference.type !== 'hard') {
    issues.push(`${path}.type must be hard inside hardConstraints`);
  }

  if (!allowedImportance.has(preference.importance)) {
    issues.push(`${path}.importance must be high, medium, low, or uncertain`);
  }

  if (preference.direction !== undefined && !allowedDirections.has(preference.direction)) {
    issues.push(`${path}.direction is not allowed`);
  }

  if (preference.target !== undefined && typeof preference.target !== 'boolean') {
    issues.push(`${path}.target must be boolean`);
  }

  validateTimeRule(preference.rule, path, issues);

  return issues;
}

function normalizePreferenceProfile(profile, { sourceText, updatedAt = new Date().toISOString() } = {}) {
  const normalized = stripNullableOptionals(structuredClone(profile));
  normalized.version = PREFERENCE_VERSION;
  normalized.searchWindowDays = normalized.searchWindowDays ?? 7;
  normalized.preferences = normalized.preferences ?? [];
  normalized.hardConstraints = normalized.hardConstraints ?? [];
  normalized.unresolvedPreferences = normalized.unresolvedPreferences ?? [];
  normalized.sourceText = sourceText ?? normalized.sourceText ?? '';
  normalized.updatedAt = updatedAt;
  normalized.preferences = mergeStartTimeWindows(normalized.preferences);
  return normalized;
}

function validatePreferenceProfile(profile) {
  const issues = [];

  if (!isPlainObject(profile)) {
    throw new PreferenceSchemaError('Preference Profile must be an object', ['profile must be an object']);
  }

  for (const key of Object.keys(profile)) {
    if (![
      'version',
      'searchWindowDays',
      'preferences',
      'hardConstraints',
      'unresolvedPreferences',
      'sourceText',
      'updatedAt',
    ].includes(key)) {
      issues.push(`${key} is not allowed`);
    }
  }

  if (profile.version !== PREFERENCE_VERSION) issues.push('version must be 1');
  if (!Number.isInteger(profile.searchWindowDays) || profile.searchWindowDays < 1 || profile.searchWindowDays > 30) {
    issues.push('searchWindowDays must be an integer from 1 to 30');
  }

  if (!Array.isArray(profile.preferences)) {
    issues.push('preferences must be an array');
  } else {
    profile.preferences.forEach((preference, index) => {
      issues.push(...validatePreference(preference, `preferences[${index}]`));
    });
  }

  if (!Array.isArray(profile.hardConstraints)) {
    issues.push('hardConstraints must be an array');
  } else {
    profile.hardConstraints.forEach((preference, index) => {
      issues.push(...validatePreference(preference, `hardConstraints[${index}]`, { requireHardType: true }));
    });
  }

  if (!Array.isArray(profile.unresolvedPreferences)
    || profile.unresolvedPreferences.some((item) => typeof item !== 'string')) {
    issues.push('unresolvedPreferences must be an array of strings');
  }

  if (typeof profile.sourceText !== 'string') issues.push('sourceText must be a string');
  if (typeof profile.updatedAt !== 'string' || Number.isNaN(Date.parse(profile.updatedAt))) {
    issues.push('updatedAt must be an ISO timestamp string');
  }

  if (issues.length > 0) {
    throw new PreferenceSchemaError('Invalid Preference Profile', issues);
  }

  return profile;
}

export {
  PREFERENCE_VERSION,
  PreferenceSchemaError,
  allowedDirections,
  allowedFeatures,
  allowedImportance,
  allowedTypes,
  normalizePreferenceProfile,
  validatePreferenceProfile,
};
