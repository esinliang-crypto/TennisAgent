import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppleCalendarProviderError,
  CalendarAdapterError,
  createAppleEventKitProvider,
  getCalendarBusy,
  normalizeAppleNativeResult,
  normalizeProviderMode,
  parseAppleHelperStdout,
} from '../packages/calendar/src/index.mjs';
import {
  attachCalendar,
  enrichCandidates,
} from '../packages/core/src/index.mjs';

const request = {
  start: '2026-09-03T00:00:00.000Z',
  end: '2026-09-04T00:00:00.000Z',
  timezone: 'Australia/Sydney',
};

function provider(source, behavior) {
  const calls = [];
  return {
    source,
    calls,
    async getBusy(input) {
      calls.push(input);
      if (behavior instanceof Error) throw behavior;
      return behavior;
    },
  };
}

function candidate(id = 'candidate-1') {
  return {
    id,
    venue: 'SUSF',
    court: 'Court 4',
    startTime: '2026-09-03T09:00:00.000Z',
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

test('Apple provider parses success JSON without leaking event content', () => {
  const result = parseAppleHelperStdout(JSON.stringify({
    source: 'apple_eventkit',
    status: 'available',
    permission: 'granted',
    busy: [
      {
        start: '2026-09-03T09:00:00.000Z',
        end: '2026-09-03T10:00:00.000Z',
        title: 'private',
        notes: 'private',
        location: 'private',
      },
    ],
  }));

  assert.deepEqual(result.busy, [
    { start: '2026-09-03T09:00:00.000Z', end: '2026-09-03T10:00:00.000Z' },
  ]);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('Apple provider parses JSON when SwiftPM build logs precede helper output', () => {
  const result = parseAppleHelperStdout([
    "Building for debugging...",
    "[0/3] Write swift-version.txt",
    '{"source":"apple_eventkit","status":"available","permission":"granted","busy":[]}',
  ].join('\n'));

  assert.equal(result.source, 'apple_eventkit');
  assert.equal(result.status, 'available');
  assert.deepEqual(result.busy, []);
});

test('Apple provider reports permission required', () => {
  assert.throws(
    () => normalizeAppleNativeResult({
      source: 'apple_eventkit',
      status: 'unavailable',
      permission: 'not_determined',
      busy: [],
      error: { code: 'APPLE_PERMISSION_REQUIRED', message: 'Need permission' },
    }),
    (error) => error instanceof AppleCalendarProviderError && error.code === 'APPLE_PERMISSION_REQUIRED',
  );
});

test('Apple provider reports permission denied', () => {
  assert.throws(
    () => normalizeAppleNativeResult({
      source: 'apple_eventkit',
      status: 'unavailable',
      permission: 'denied',
      busy: [],
      error: { code: 'APPLE_PERMISSION_DENIED', message: 'Denied' },
    }),
    (error) => error instanceof AppleCalendarProviderError && error.code === 'APPLE_PERMISSION_DENIED',
  );
});

test('Apple native helper process failure is reported', async () => {
  const apple = createAppleEventKitProvider({
    currentPlatform: 'darwin',
    execFileImpl: async () => {
      throw new Error('swift failed');
    },
  });

  await assert.rejects(
    () => apple.getBusy(request),
    (error) => error instanceof AppleCalendarProviderError && error.code === 'APPLE_PROVIDER_ERROR',
  );
});

test('Apple malformed native JSON is rejected', () => {
  assert.throws(
    () => parseAppleHelperStdout('{not-json'),
    (error) => error instanceof AppleCalendarProviderError && error.code === 'APPLE_MALFORMED_RESPONSE',
  );
});

test('Apple empty calendar normalizes to available with no busy intervals', () => {
  const result = normalizeAppleNativeResult({
    source: 'apple_eventkit',
    status: 'available',
    permission: 'granted',
    busy: [],
  });

  assert.deepEqual(result.busy, []);
  assert.equal(result.status, 'available');
});

test('Apple busy interval normalization sorts intervals', () => {
  const result = normalizeAppleNativeResult({
    source: 'apple_eventkit',
    status: 'available',
    permission: 'granted',
    busy: [
      { start: '2026-09-03T10:00:00.000Z', end: '2026-09-03T11:00:00.000Z' },
      { start: '2026-09-03T08:00:00.000Z', end: '2026-09-03T09:00:00.000Z' },
    ],
  });

  assert.equal(result.busy[0].start, '2026-09-03T08:00:00.000Z');
});

test('Apple provider receives timezone and DST windows unchanged from selector', async () => {
  const apple = provider('apple_eventkit', {
    source: 'apple_eventkit',
    status: 'available',
    busy: [],
  });

  await getCalendarBusy({
    ...request,
    start: '2026-12-01T08:00:00.000Z',
    end: '2026-12-01T10:00:00.000Z',
    appleProvider: apple,
    googleProvider: provider('google_freebusy', new Error('must not run')),
  });

  assert.equal(apple.calls[0].timezone, 'Australia/Sydney');
  assert.equal(apple.calls[0].start, '2026-12-01T08:00:00.000Z');
});

test('Apple timed event is represented as busy after native filtering', () => {
  const result = normalizeAppleNativeResult({
    source: 'apple_eventkit',
    status: 'available',
    permission: 'granted',
    busy: [{ start: '2026-09-03T09:00:00.000Z', end: '2026-09-03T10:00:00.000Z' }],
  });

  assert.equal(result.busy.length, 1);
});

test('Apple availability=free event is non-blocking after native filtering', () => {
  const result = normalizeAppleNativeResult({
    source: 'apple_eventkit',
    status: 'available',
    permission: 'granted',
    busy: [],
  });

  assert.equal(result.busy.length, 0);
});

test('Apple declined or canceled event is non-blocking when native helper can identify it', () => {
  const result = normalizeAppleNativeResult({
    source: 'apple_eventkit',
    status: 'available',
    permission: 'granted',
    busy: [],
  });

  assert.equal(result.busy.length, 0);
});

test('Apple all-day events are non-blocking after native filtering', () => {
  const result = normalizeAppleNativeResult({
    source: 'apple_eventkit',
    status: 'available',
    permission: 'granted',
    busy: [],
  });

  assert.equal(result.busy.length, 0);
});

test('auto provider uses Apple when available', async () => {
  const apple = provider('apple_eventkit', {
    source: 'apple_eventkit',
    status: 'available',
    busy: [],
  });
  const google = provider('google_freebusy', {
    source: 'google_freebusy',
    status: 'available',
    busy: [],
  });

  const result = await getCalendarBusy({ ...request, appleProvider: apple, googleProvider: google });

  assert.equal(result.source, 'apple_eventkit');
  assert.equal(apple.calls.length, 1);
  assert.equal(google.calls.length, 0);
});

test('auto provider falls back to Google when Apple is unavailable', async () => {
  const result = await getCalendarBusy({
    ...request,
    appleProvider: provider('apple_eventkit', new AppleCalendarProviderError('APPLE_UNAVAILABLE')),
    googleProvider: provider('google_freebusy', {
      source: 'google_freebusy',
      status: 'available',
      busy: [],
    }),
  });

  assert.equal(result.source, 'google_freebusy');
  assert.equal(result.fallbackFrom, 'apple_eventkit');
  assert.equal(result.fallbackReason, 'APPLE_UNAVAILABLE');
});

test('auto provider returns unavailable when both providers fail', async () => {
  const result = await getCalendarBusy({
    ...request,
    appleProvider: provider('apple_eventkit', new AppleCalendarProviderError('APPLE_UNAVAILABLE')),
    googleProvider: provider('google_freebusy', new Error('google missing')),
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.failures.length, 2);
});

test('apple mode does not fallback to Google', async () => {
  const google = provider('google_freebusy', {
    source: 'google_freebusy',
    status: 'available',
    busy: [],
  });

  await assert.rejects(
    () => getCalendarBusy({
      ...request,
      providerMode: 'apple',
      appleProvider: provider('apple_eventkit', new AppleCalendarProviderError('APPLE_UNAVAILABLE')),
      googleProvider: google,
    }),
    (error) => error instanceof AppleCalendarProviderError && error.code === 'APPLE_UNAVAILABLE',
  );
  assert.equal(google.calls.length, 0);
});

test('google mode does not try Apple', async () => {
  const apple = provider('apple_eventkit', new Error('must not run'));
  const result = await getCalendarBusy({
    ...request,
    providerMode: 'google',
    appleProvider: apple,
    googleProvider: provider('google_freebusy', {
      source: 'google_freebusy',
      status: 'available',
      busy: [],
    }),
  });

  assert.equal(result.source, 'google_freebusy');
  assert.equal(apple.calls.length, 0);
});

test('fallback metadata records permission denied by default', async () => {
  const result = await getCalendarBusy({
    ...request,
    appleProvider: provider('apple_eventkit', new AppleCalendarProviderError('APPLE_PERMISSION_DENIED')),
    googleProvider: provider('google_freebusy', {
      source: 'google_freebusy',
      status: 'available',
      busy: [],
    }),
  });

  assert.equal(result.fallbackReason, 'APPLE_PERMISSION_DENIED');
});

test('permission denied fallback can be disabled by policy', async () => {
  const result = await getCalendarBusy({
    ...request,
    appleProvider: provider('apple_eventkit', new AppleCalendarProviderError('APPLE_PERMISSION_DENIED')),
    googleProvider: provider('google_freebusy', {
      source: 'google_freebusy',
      status: 'available',
      busy: [],
    }),
    fallbackOnApplePermissionDenied: false,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.source, 'apple_eventkit');
  assert.equal(result.failures[0].code, 'APPLE_PERMISSION_DENIED');
});

test('invalid provider mode is rejected', () => {
  assert.throws(
    () => normalizeProviderMode('icloud-scrape'),
    (error) => error instanceof CalendarAdapterError && error.code === 'CALENDAR_PROVIDER_INVALID',
  );
});

test('Apple provider result enriches candidates through unified contract', async () => {
  const [enriched] = await enrichCandidates({
    candidates: [candidate()],
    weatherAdapter: async ({ slots }) => slots.map((slot) => ({ candidateId: slot.id, startTime: slot.startTime, forecastAvailable: false })),
    calendarAdapter: async () => ({
      source: 'apple_eventkit',
      status: 'available',
      busy: [],
    }),
  });

  assert.equal(enriched.features.calendar.free, true);
  assert.equal(enriched.features.calendar.source, 'apple_eventkit');
});

test('available Apple empty busy array enriches candidates as free, not unknown', async () => {
  const [enriched] = await enrichCandidates({
    candidates: [candidate()],
    weatherAdapter: async ({ slots }) => slots.map((slot) => ({ candidateId: slot.id, startTime: slot.startTime, forecastAvailable: false })),
    calendarAdapter: async () => ({
      source: 'apple_eventkit',
      status: 'available',
      busy: [],
    }),
  });

  assert.equal(enriched.features.calendar.free, true);
  assert.equal(enriched.features.calendar.status, 'available');
  assert.equal(enriched.features.calendar.source, 'apple_eventkit');
});

test('available non-overlapping busy interval enriches candidates as free', async () => {
  const [enriched] = await enrichCandidates({
    candidates: [candidate()],
    weatherAdapter: async ({ slots }) => slots.map((slot) => ({ candidateId: slot.id, startTime: slot.startTime, forecastAvailable: false })),
    calendarAdapter: async () => ({
      source: 'apple_eventkit',
      status: 'available',
      busy: [
        { start: '2026-09-03T08:00:00.000Z', end: '2026-09-03T09:00:00.000Z' },
      ],
    }),
  });

  assert.equal(enriched.features.calendar.free, true);
});

test('available overlapping busy interval enriches candidates as busy', async () => {
  const [enriched] = await enrichCandidates({
    candidates: [candidate()],
    weatherAdapter: async ({ slots }) => slots.map((slot) => ({ candidateId: slot.id, startTime: slot.startTime, forecastAvailable: false })),
    calendarAdapter: async () => ({
      source: 'apple_eventkit',
      status: 'available',
      busy: [
        { start: '2026-09-03T09:30:00.000Z', end: '2026-09-03T10:30:00.000Z' },
      ],
    }),
  });

  assert.equal(enriched.features.calendar.free, false);
});

test('Google provider fallback result enriches candidates through unified contract', async () => {
  const [enriched] = await enrichCandidates({
    candidates: [candidate()],
    weatherAdapter: async ({ slots }) => slots.map((slot) => ({ candidateId: slot.id, startTime: slot.startTime, forecastAvailable: false })),
    calendarAdapter: async () => ({
      source: 'google_freebusy',
      status: 'available',
      fallbackFrom: 'apple_eventkit',
      fallbackReason: 'APPLE_UNAVAILABLE',
      busy: [],
    }),
  });

  assert.equal(enriched.features.calendar.source, 'google_freebusy');
  assert.equal(enriched.features.calendar.fallbackReason, 'APPLE_UNAVAILABLE');
});

test('Apple and Google available empty busy contracts enrich identically except source', async () => {
  async function enrichedFor(source) {
    const [enriched] = await enrichCandidates({
      candidates: [candidate()],
      weatherAdapter: async ({ slots }) => slots.map((slot) => ({ candidateId: slot.id, startTime: slot.startTime, forecastAvailable: false })),
      calendarAdapter: async () => ({
        source,
        status: 'available',
        busy: [],
      }),
    });
    return enriched.features.calendar;
  }

  const apple = await enrichedFor('apple_eventkit');
  const google = await enrichedFor('google_freebusy');

  assert.equal(apple.free, true);
  assert.equal(google.free, true);
  assert.equal(apple.status, google.status);
});

test('calendar unavailable enriches as unknown, not free', () => {
  const [enriched] = attachCalendar([candidate()], [], {
    status: 'unavailable',
    source: null,
  });

  assert.equal(enriched.features.calendar.free, null);
  assert.equal(enriched.features.calendar.status, 'unavailable');
});
