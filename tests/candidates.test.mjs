import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateCandidateWithPreferences,
  buildCandidates,
  matchesStartTimeRule,
  stableCandidateId,
} from '../packages/core/src/index.mjs';

test('nextHourAlsoAvailable maps to nextHourFree', () => {
  const [candidate] = buildCandidates([
    {
      venue: 'SUSF',
      court: 'Court 5',
      startTime: '2026-09-03T19:00:00+10:00',
      durationMinutes: 60,
      nextHourAlsoAvailable: true,
    },
  ]);

  assert.equal(candidate.features.nextHourFree, true);
});

test('Sydney local time is computed explicitly', () => {
  const [candidate] = buildCandidates([
    {
      venue: 'SUSF',
      court: 'Court 4',
      startTime: '2026-09-03T09:00:00.000Z',
      durationMinutes: 60,
      nextHourAlsoAvailable: false,
    },
  ]);

  assert.equal(candidate.features.localDate, '2026-09-03');
  assert.equal(candidate.features.localTime, '19:00');
});

test('Sydney DST case is handled', () => {
  const [candidate] = buildCandidates([
    {
      venue: 'SUSF',
      court: 'Court 4',
      startTime: '2026-12-01T08:00:00.000Z',
      durationMinutes: 60,
      nextHourAlsoAvailable: false,
    },
  ]);

  assert.equal(candidate.features.localDate, '2026-12-01');
  assert.equal(candidate.features.localTime, '19:00');
});

test('stable id is deterministic for the same input', () => {
  const input = {
    provider: 'SUSF',
    venue: 'SUSF',
    court: 'Court 6',
    startTime: '2026-09-03T19:00:00+10:00',
    durationMinutes: 60,
  };

  assert.equal(stableCandidateId(input), stableCandidateId(input));
});

test('price remains null when unknown', () => {
  const [candidate] = buildCandidates([
    {
      venue: 'SUSF',
      court: 'Court 6',
      startTime: '2026-09-03T19:00:00+10:00',
      durationMinutes: 60,
      nextHourAlsoAvailable: false,
    },
  ]);

  assert.equal(candidate.features.price, null);
});

test('Court 1/2/3 can enter Candidate Core', () => {
  const candidates = buildCandidates([
    {
      venue: 'SUSF',
      court: 'Court 1',
      facilityId: 'court-1',
      startTime: '2026-09-03T19:00:00+10:00',
      durationMinutes: 60,
      nextHourAlsoAvailable: false,
      priceOptions: [],
    },
    {
      venue: 'SUSF',
      court: 'Court 2',
      facilityId: 'court-2',
      startTime: '2026-09-03T19:00:00+10:00',
      durationMinutes: 60,
      nextHourAlsoAvailable: false,
      priceOptions: [],
    },
    {
      venue: 'SUSF',
      court: 'Court 3',
      facilityId: 'court-3',
      startTime: '2026-09-03T19:00:00+10:00',
      durationMinutes: 60,
      nextHourAlsoAvailable: false,
      priceOptions: [],
    },
  ]);

  assert.deepEqual(candidates.map((candidate) => candidate.court), ['Court 1', 'Court 2', 'Court 3']);
});

test('priceOptions are retained while candidate price stays null', () => {
  const [candidate] = buildCandidates([
    {
      venue: 'SUSF',
      court: 'Court 6',
      startTime: '2026-09-03T19:00:00+10:00',
      durationMinutes: 60,
      nextHourAlsoAvailable: false,
      priceOptions: [
        { name: 'Tennis Off-Peak Fee', amount: 29, currency: 'AUD', durationMinutes: 60 },
        { name: 'Tennis Peak Fee', amount: 39, currency: 'AUD', durationMinutes: 60 },
      ],
    },
  ]);

  assert.equal(candidate.features.price, null);
  assert.deepEqual(candidate.features.priceOptions, [
    { name: 'Tennis Off-Peak Fee', amount: 29, currency: 'AUD', durationMinutes: 60 },
    { name: 'Tennis Peak Fee', amount: 39, currency: 'AUD', durationMinutes: 60 },
  ]);
});

test('12:30 matches before 13', () => {
  assert.equal(matchesStartTimeRule('12:30', { before: '13:00', after: '17:00' }), true);
});

test('13:00 does not match before 13', () => {
  assert.equal(matchesStartTimeRule('13:00', { before: '13:00', after: '17:00' }), false);
});

test('16:59 does not match preferred window', () => {
  assert.equal(matchesStartTimeRule('16:59', { before: '13:00', after: '17:00' }), false);
});

test('17:00 matches after 17', () => {
  assert.equal(matchesStartTimeRule('17:00', { before: '13:00', after: '17:00' }), true);
});

test('preference annotation reports unknown price', () => {
  const [candidate] = buildCandidates([
    {
      venue: 'SUSF',
      court: 'Court 5',
      startTime: '2026-09-03T19:00:00+10:00',
      durationMinutes: 60,
      nextHourAlsoAvailable: true,
    },
  ]);
  const annotated = annotateCandidateWithPreferences(candidate, {
    preferences: [
      { feature: 'price', type: 'soft', direction: 'lower', importance: 'high' },
      { feature: 'next_hour_free', type: 'soft', target: true, importance: 'high' },
      { feature: 'start_time', type: 'soft', rule: { before: '13:00', after: '17:00' }, importance: 'medium' },
    ],
  });

  assert.deepEqual(annotated.matches, {
    price: 'unknown',
    next_hour_free: true,
    start_time: true,
  });
});

test('preference annotation reports price options without pretending candidate-level price is known', () => {
  const [candidate] = buildCandidates([
    {
      venue: 'SUSF',
      court: 'Court 5',
      startTime: '2026-09-03T19:00:00+10:00',
      durationMinutes: 60,
      nextHourAlsoAvailable: true,
      priceOptions: [
        { name: 'Tennis Off-Peak Fee', amount: 29, currency: 'AUD', durationMinutes: 60 },
      ],
    },
  ]);
  const annotated = annotateCandidateWithPreferences(candidate, {
    preferences: [
      { feature: 'price', type: 'soft', direction: 'lower', importance: 'high' },
    ],
  });

  assert.equal(annotated.matches.price, 'options_available');
  assert.equal(annotated.features.price, null);
});
