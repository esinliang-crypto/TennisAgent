import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PreferenceInterpreterError,
  assertOpenAiStrictObjectSchema,
  collectObjectSchemas,
  interpretPreferences,
  loadPreferenceProfile,
  openAiPreferenceProfileJsonSchema,
  validatePreferenceProfile,
} from '../packages/preferences/src/index.mjs';

function mockProvider(profile) {
  return {
    async interpret() {
      return profile;
    },
  };
}

function baseProfile(preferences) {
  return {
    version: 1,
    searchWindowDays: 7,
    preferences,
    hardConstraints: [],
    unresolvedPreferences: [],
    sourceText: '',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

test('想便宜一点 maps to price lower', async () => {
  const profile = await interpretPreferences('想便宜一点', {
    provider: mockProvider(baseProfile([
      { feature: 'price', type: 'soft', direction: 'lower', importance: 'high' },
    ])),
    now: new Date('2026-09-01T00:00:00.000Z'),
  });

  assert.equal(profile.preferences[0].feature, 'price');
  assert.equal(profile.preferences[0].direction, 'lower');
  assert.equal(profile.preferences[0].priority, 'high');
  assert.equal(profile.preferences[0].relaxable, true);
});

test('后一小时最好没人 maps to next_hour_free true', async () => {
  const profile = await interpretPreferences('后一小时最好没人', {
    provider: mockProvider(baseProfile([
      { feature: 'next_hour_free', type: 'soft', target: true, importance: 'high' },
    ])),
  });

  assert.equal(profile.preferences[0].feature, 'next_hour_free');
  assert.equal(profile.preferences[0].target, true);
});

test('13点前或17点后 maps to time rule', async () => {
  const profile = await interpretPreferences('13点前或17点后', {
    provider: mockProvider(baseProfile([
      {
        feature: 'start_time',
        type: 'soft',
        rule: { before: '13:00', after: '17:00' },
        importance: 'medium',
      },
    ])),
  });

  assert.deepEqual(profile.preferences[0].rule, { before: '13:00', after: '17:00' });
});

test('模糊 importance can be uncertain', async () => {
  const profile = await interpretPreferences('时间差不多就行', {
    provider: mockProvider(baseProfile([
      { feature: 'start_time', type: 'soft', importance: 'uncertain' },
    ])),
  });

  assert.equal(profile.preferences[0].importance, 'uncertain');
});

test('does not generate unexpressed weather preference', async () => {
  const profile = await interpretPreferences('想便宜一点', {
    provider: mockProvider(baseProfile([
      { feature: 'price', type: 'soft', direction: 'lower', importance: 'high' },
    ])),
  });

  assert.equal(profile.preferences.some((preference) => preference.feature === 'weather'), false);
});

test('malformed LLM output is rejected by schema', async () => {
  await assert.rejects(
    () => interpretPreferences('想便宜一点', {
      provider: mockProvider(baseProfile([
        { feature: 'unknown_feature', type: 'soft', importance: 'high' },
      ])),
    }),
    (error) => error instanceof PreferenceInterpreterError
      && error.code === 'PREFERENCE_SCHEMA_REJECTED',
  );
});

test('schema rejects malformed profile directly', () => {
  assert.throws(
    () => validatePreferenceProfile(baseProfile([{ feature: 'weather', type: 'soft', importance: 'urgent' }])),
    /Invalid Preference Profile/,
  );
});

test('OpenAI schema supports before and after together', async () => {
  const profile = await interpretPreferences('13点前或者17点后', {
    provider: mockProvider(baseProfile([
      {
        feature: 'start_time',
        type: 'soft',
        direction: null,
        target: null,
        rule: { before: '13:00', after: '17:00', equals: null },
        importance: 'medium',
      },
    ])),
  });

  assert.deepEqual(profile.preferences[0].rule, { before: '13:00', after: '17:00' });
});

test('OpenAI nullable schema supports only before', async () => {
  const profile = await interpretPreferences('13点前', {
    provider: mockProvider(baseProfile([
      {
        feature: 'start_time',
        type: 'soft',
        direction: null,
        target: null,
        rule: { before: '13:00', after: null, equals: null },
        importance: 'medium',
      },
    ])),
  });

  assert.deepEqual(profile.preferences[0].rule, { before: '13:00' });
});

test('OpenAI nullable schema supports only after', async () => {
  const profile = await interpretPreferences('17点后', {
    provider: mockProvider(baseProfile([
      {
        feature: 'start_time',
        type: 'soft',
        direction: null,
        target: null,
        rule: { before: null, after: '17:00', equals: null },
        importance: 'medium',
      },
    ])),
  });

  assert.deepEqual(profile.preferences[0].rule, { after: '17:00' });
});

test('normalizes split before and after start_time preferences into one window', async () => {
  const profile = await interpretPreferences('13点前或者17点后', {
    provider: mockProvider(baseProfile([
      {
        feature: 'start_time',
        type: 'soft',
        direction: 'earlier',
        target: null,
        rule: { before: '13:00', after: null, equals: null },
        importance: 'medium',
      },
      {
        feature: 'start_time',
        type: 'soft',
        direction: 'later',
        target: null,
        rule: { before: null, after: '17:00', equals: null },
        importance: 'medium',
      },
    ])),
  });

  assert.equal(profile.preferences.length, 1);
  assert.equal(profile.preferences[0].feature, 'start_time');
  assert.equal(profile.preferences[0].type, 'soft');
  assert.equal(profile.preferences[0].importance, 'medium');
  assert.equal(profile.preferences[0].priority, 'medium');
  assert.equal(profile.preferences[0].relaxable, true);
  assert.equal(profile.preferences[0].relaxationDirection, 'wider_time_window');
  assert.deepEqual(profile.preferences[0].rule, { before: '13:00', after: '17:00' });
});

test('OpenAI nullable schema supports null rule for non-time preference', async () => {
  const profile = await interpretPreferences('想便宜一点', {
    provider: mockProvider(baseProfile([
      {
        feature: 'price',
        type: 'soft',
        direction: 'lower',
        target: null,
        rule: null,
        importance: 'high',
      },
    ])),
  });

  assert.equal(profile.preferences[0].feature, 'price');
  assert.equal(profile.preferences[0].type, 'soft');
  assert.equal(profile.preferences[0].direction, 'lower');
  assert.equal(profile.preferences[0].importance, 'high');
  assert.equal(profile.preferences[0].priority, 'high');
  assert.equal(profile.preferences[0].relaxable, true);
  assert.equal(profile.preferences[0].relaxationDirection, 'higher_price');
});

test('OpenAI schema object nodes satisfy strict required coverage', () => {
  assert.equal(assertOpenAiStrictObjectSchema(openAiPreferenceProfileJsonSchema), true);
});

test('OpenAI schema object nodes all set additionalProperties false', () => {
  for (const { path, schema } of collectObjectSchemas(openAiPreferenceProfileJsonSchema)) {
    assert.equal(schema.additionalProperties, false, `${path} must set additionalProperties=false`);
  }
});

test('preference store loads older profiles by normalizing relaxation metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tennis-preferences-'));
  const path = join(dir, 'preferences.json');
  try {
    await writeFile(path, JSON.stringify(baseProfile([
      { feature: 'price', type: 'soft', direction: 'lower', importance: 'high' },
    ])));

    const profile = await loadPreferenceProfile({ path });
    assert.equal(profile.preferences[0].priority, 'high');
    assert.equal(profile.preferences[0].relaxable, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
