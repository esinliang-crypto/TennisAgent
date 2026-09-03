import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPLANNING_ACTIONS,
  ReplanningActionSchemaError,
  chooseReplanningAction,
  createInitialAgentState,
  evaluateCandidateSet,
  validateReplanningAction,
} from '../packages/agent/src/index.mjs';
import {
  normalizePreferenceProfile,
  validatePreferenceProfile,
} from '../packages/preferences/src/index.mjs';

function profile(preferences = [], hardConstraints = []) {
  return normalizePreferenceProfile({
    version: 1,
    searchWindowDays: 7,
    preferences,
    hardConstraints,
    unresolvedPreferences: [],
    sourceText: 'synthetic preference text',
    updatedAt: '2026-09-03T00:00:00.000Z',
  }, {
    updatedAt: '2026-09-03T00:00:00.000Z',
  });
}

function candidate({
  id = 'candidate-1',
  court = 'Court 4',
  localTime = '18:00',
  nextHourFree = true,
  price = 29,
} = {}) {
  return {
    id,
    venue: 'SUSF',
    court,
    startTime: '2026-09-03T08:00:00.000Z',
    durationMinutes: 60,
    features: {
      localDate: '2026-09-03',
      localTime,
      nextHourFree,
      price,
    },
  };
}

function state(overrides = {}) {
  const preferences = overrides.preferences ?? profile([
    {
      feature: 'next_hour_free',
      type: 'soft',
      target: true,
      priority: 'high',
      importance: 'high',
      relaxable: true,
      sourceText: 'best if following hour is free',
    },
  ]);

  return createInitialAgentState({
    goal: 'find next tennis session',
    preferences,
    searchScope: { days: 7, radiusKm: 3 },
    candidates: [candidate()],
    rejectedCandidates: [],
    failedConstraints: [],
    actionsTaken: [],
    iteration: 0,
    status: 'READY',
    ...overrides,
  });
}

test('hard constraint is normalized as non-relaxable and cannot validate as relaxable', () => {
  const normalized = profile([], [
    {
      feature: 'calendar',
      type: 'hard',
      priority: 'high',
      importance: 'high',
      relaxable: true,
      sourceText: 'must not conflict with calendar',
    },
  ]);

  assert.equal(normalized.hardConstraints[0].relaxable, false);

  assert.throws(
    () => validatePreferenceProfile({
      ...normalized,
      hardConstraints: [{ ...normalized.hardConstraints[0], relaxable: true }],
    }),
    /Invalid Preference Profile/,
  );
});

test('no candidates requires replanning', async () => {
  const currentState = state({ candidates: [] });
  const evaluation = evaluateCandidateSet({
    candidates: currentState.candidates,
    preferences: currentState.preferences,
  });
  const action = await chooseReplanningAction(currentState, { evaluation });

  assert.equal(evaluation.satisfactory, false);
  assert.equal(evaluation.reasons.includes('candidate_count_below_minimum'), true);
  assert.equal(action.selectedAction, REPLANNING_ACTIONS.EXPAND_DATE_WINDOW);
});

test('only low quality candidates require replanning', async () => {
  const currentState = state({
    candidates: [candidate({ id: 'weak', nextHourFree: false })],
  });
  const evaluation = evaluateCandidateSet({
    candidates: currentState.candidates,
    preferences: currentState.preferences,
  });
  const action = await chooseReplanningAction(currentState, { evaluation });

  assert.equal(evaluation.satisfactory, false);
  assert.deepEqual(evaluation.reasons, ['high_priority_preferences_weak']);
  assert.equal(evaluation.weakPreferences[0].feature, 'next_hour_free');
  assert.equal(action.selectedAction, REPLANNING_ACTIONS.ASK_USER);
});

test('high quality candidates are satisfactory and stop replanning', async () => {
  const currentState = state();
  const evaluation = evaluateCandidateSet({
    candidates: currentState.candidates,
    preferences: currentState.preferences,
  });
  const action = await chooseReplanningAction(currentState, { evaluation });

  assert.equal(evaluation.satisfactory, true);
  assert.deepEqual(evaluation.reasons, []);
  assert.equal(action.selectedAction, REPLANNING_ACTIONS.STOP);
});

test('action enum validation accepts only known actions', () => {
  const action = validateReplanningAction({
    selectedAction: REPLANNING_ACTIONS.EXPAND_RADIUS,
    targetPreference: null,
    rationale: 'Try a wider geographic scope.',
    expectedEffect: 'More candidate venues may be discovered.',
  });

  assert.equal(action.selectedAction, 'EXPAND_RADIUS');
});

test('max iteration stops replanning to avoid infinite loops', async () => {
  const action = await chooseReplanningAction(state({
    candidates: [],
    iteration: 3,
  }), {
    maxIterations: 3,
  });

  assert.equal(action.selectedAction, REPLANNING_ACTIONS.STOP);
  assert.match(action.rationale, /Maximum replanning iterations/);
});

test('unknown provider action is rejected', async () => {
  await assert.rejects(
    () => chooseReplanningAction(state({ candidates: [] }), {
      provider: {
        async choose() {
          return {
            selectedAction: 'MAKE_UP_A_NEW_ACTION',
            targetPreference: null,
            rationale: 'Invalid free-form action.',
            expectedEffect: 'Should be rejected.',
          };
        },
      },
    }),
    (error) => error instanceof ReplanningActionSchemaError,
  );
});
