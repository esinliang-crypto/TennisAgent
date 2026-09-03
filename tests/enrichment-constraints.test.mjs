import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHardConstraints,
  attachCalendar,
  enrichCandidates,
} from '../packages/core/src/index.mjs';
import {
  createInitialAgentState,
  evaluateCandidateSet,
} from '../packages/agent/src/index.mjs';
import { normalizePreferenceProfile } from '../packages/preferences/src/index.mjs';

function candidate(id, startTime = '2026-09-03T09:00:00.000Z') {
  return {
    id,
    venue: 'SUSF',
    court: 'Court 4',
    startTime,
    durationMinutes: 60,
    features: {
      nextHourFree: true,
      localDate: '2026-09-03',
      localTime: '19:00',
      price: null,
      priceOptions: [],
    },
  };
}

function profile({ weatherType = null } = {}) {
  const hardConstraints = [];
  const preferences = [];
  if (weatherType === 'hard') {
    hardConstraints.push({
      feature: 'weather',
      type: 'hard',
      importance: 'high',
      priority: 'high',
      value: 'no_precipitation',
    });
  }
  if (weatherType === 'soft') {
    preferences.push({
      feature: 'weather',
      type: 'soft',
      importance: 'medium',
      priority: 'medium',
      relaxable: true,
    });
  }

  return normalizePreferenceProfile({
    version: 1,
    searchWindowDays: 7,
    preferences,
    hardConstraints,
    unresolvedPreferences: [],
    sourceText: 'synthetic',
    updatedAt: '2026-09-03T00:00:00.000Z',
  }, {
    updatedAt: '2026-09-03T00:00:00.000Z',
  });
}

function withWeather(baseCandidate, weather) {
  return {
    ...baseCandidate,
    features: {
      ...baseCandidate.features,
      weather,
    },
  };
}

test('calendar busy candidate is rejected by default hard policy', () => {
  const [current] = attachCalendar([candidate('busy')], [
    { start: '2026-09-03T09:30:00.000Z', end: '2026-09-03T10:30:00.000Z' },
  ]);

  const result = applyHardConstraints({
    candidates: [current],
    preferenceProfile: profile(),
  });

  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reasons[0].reason, 'calendar_conflict');
});

test('calendar free candidate is accepted when no other hard constraint fails', () => {
  const [current] = attachCalendar([candidate('free')], [
    { start: '2026-09-03T08:00:00.000Z', end: '2026-09-03T09:00:00.000Z' },
  ]);

  const result = applyHardConstraints({
    candidates: [current],
    preferenceProfile: profile(),
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 0);
});

test('weather hard constraint rejects precipitation', () => {
  const current = attachCalendar([
    withWeather(candidate('rain'), {
      forecastAvailable: true,
      precipitationMm: 1.2,
      precipitationProbability: 90,
    }),
  ], [])[0];

  const result = applyHardConstraints({
    candidates: [current],
    preferenceProfile: profile({ weatherType: 'hard' }),
  });

  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reasons[0].reason, 'weather_precipitation');
});

test('weather soft preference does not reject candidates in hard filtering', () => {
  const current = attachCalendar([
    withWeather(candidate('rain'), {
      forecastAvailable: true,
      precipitationMm: 1.2,
      precipitationProbability: 90,
    }),
  ], [])[0];

  const result = applyHardConstraints({
    candidates: [current],
    preferenceProfile: profile({ weatherType: 'soft' }),
  });

  assert.equal(result.accepted.length, 1);
});

test('unknown calendar is not treated as free', () => {
  const result = applyHardConstraints({
    candidates: [candidate('unknown-calendar')],
    preferenceProfile: profile(),
  });

  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reasons[0].reason, 'calendar_unknown');
});

test('unknown weather is not treated as good for hard weather constraints', () => {
  const current = attachCalendar([
    withWeather(candidate('unknown-weather'), {
      forecastAvailable: false,
      precipitationMm: null,
    }),
  ], [])[0];

  const result = applyHardConstraints({
    candidates: [current],
    preferenceProfile: profile({ weatherType: 'hard' }),
  });

  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reasons[0].reason, 'weather_unknown');
});

test('enriched candidate schema includes weather and calendar facts', async () => {
  const [enriched] = await enrichCandidates({
    candidates: [candidate('schema')],
    weatherAdapter: async ({ slots }) => slots.map((slot) => ({
      candidateId: slot.id,
      startTime: slot.startTime,
      temperatureC: 21,
      feelsLikeC: 21,
      precipitationProbability: 0,
      precipitationMm: 0,
      windKph: 12,
      weatherCode: '0',
      source: 'test-weather',
      forecastAvailable: true,
    })),
    calendarAdapter: async () => ({ busy: [] }),
  });

  assert.equal(enriched.features.weather.temperatureC, 21);
  assert.equal(enriched.features.calendar.free, true);
});

test('hard filtering returns explainable rejection reasons', () => {
  const result = applyHardConstraints({
    candidates: [candidate('unknown-calendar')],
    preferenceProfile: profile(),
  });

  assert.deepEqual(result.rejected[0].reasons, [
    { feature: 'calendar', reason: 'calendar_unknown' },
  ]);
});

test('filtered output is compatible with Agent State and evaluator', () => {
  const result = applyHardConstraints({
    candidates: [candidate('unknown-calendar')],
    preferenceProfile: profile(),
  });
  const state = createInitialAgentState({
    goal: 'find next tennis session',
    preferences: profile(),
    searchScope: { days: 7 },
    candidates: result.accepted,
    rejectedCandidates: result.rejected,
    failedConstraints: [],
    actionsTaken: [],
    iteration: 0,
    status: 'READY',
  });
  const evaluation = evaluateCandidateSet({
    candidates: state.candidates,
    rejectedCandidates: state.rejectedCandidates,
    preferences: state.preferences,
  });

  assert.equal(state.rejectedCandidates.length, 1);
  assert.equal(evaluation.satisfactory, false);
  assert.equal(evaluation.failedConstraints[0].reason, 'calendar_unknown');
});
