import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CalendarAuthError,
  getCalendarBusy,
  isCalendarFree,
  normalizeBusyIntervals,
  readCalendarToken,
} from '../packages/calendar/src/index.mjs';

function candidate(startTime, durationMinutes = 60) {
  return { startTime, durationMinutes };
}

test('calendar exact boundary before candidate does not overlap', () => {
  assert.equal(isCalendarFree(candidate('2026-09-03T09:00:00.000Z'), [
    { start: '2026-09-03T08:00:00.000Z', end: '2026-09-03T09:00:00.000Z' },
  ]), true);
});

test('calendar exact boundary after candidate does not overlap', () => {
  assert.equal(isCalendarFree(candidate('2026-09-03T09:00:00.000Z'), [
    { start: '2026-09-03T10:00:00.000Z', end: '2026-09-03T11:00:00.000Z' },
  ]), true);
});

test('calendar partial overlap is busy', () => {
  assert.equal(isCalendarFree(candidate('2026-09-03T09:00:00.000Z'), [
    { start: '2026-09-03T08:59:00.000Z', end: '2026-09-03T09:01:00.000Z' },
  ]), false);
});

test('calendar contained event is busy', () => {
  assert.equal(isCalendarFree(candidate('2026-09-03T09:00:00.000Z'), [
    { start: '2026-09-03T09:15:00.000Z', end: '2026-09-03T09:30:00.000Z' },
  ]), false);
});

test('calendar containing event is busy', () => {
  assert.equal(isCalendarFree(candidate('2026-09-03T09:00:00.000Z'), [
    { start: '2026-09-03T08:00:00.000Z', end: '2026-09-03T11:00:00.000Z' },
  ]), false);
});

test('calendar overlap works across timezone offsets', () => {
  assert.equal(isCalendarFree(candidate('2026-09-03T19:00:00+10:00'), [
    { start: '2026-09-03T08:30:00.000Z', end: '2026-09-03T09:30:00.000Z' },
  ]), false);
});

test('missing calendar auth is explicit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tennis-calendar-'));
  try {
    await assert.rejects(
      () => readCalendarToken({ path: join(dir, 'missing.json') }),
      (error) => error instanceof CalendarAuthError && error.code === 'CALENDAR_AUTH_REQUIRED',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('FreeBusy adapter exposes busy intervals only', async () => {
  let requestBody;
  const result = await getCalendarBusy({
    start: '2026-09-03T00:00:00.000Z',
    end: '2026-09-04T00:00:00.000Z',
    timezone: 'Australia/Sydney',
    accessToken: 'test-token',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            calendars: {
              primary: {
                busy: [
                  {
                    start: '2026-09-03T09:00:00.000Z',
                    end: '2026-09-03T10:00:00.000Z',
                    summary: 'must not leak',
                  },
                ],
              },
            },
          };
        },
      };
    },
  });

  assert.deepEqual(requestBody.items, [{ id: 'primary' }]);
  assert.deepEqual(result.busy, [
    { start: '2026-09-03T09:00:00.000Z', end: '2026-09-03T10:00:00.000Z' },
  ]);
});

test('busy interval normalization sorts intervals and drops details', () => {
  assert.deepEqual(normalizeBusyIntervals({
    calendars: {
      primary: {
        busy: [
          { start: '2026-09-03T10:00:00.000Z', end: '2026-09-03T11:00:00.000Z', description: 'hidden' },
          { start: '2026-09-03T08:00:00.000Z', end: '2026-09-03T09:00:00.000Z', location: 'hidden' },
        ],
      },
    },
  }), [
    { start: '2026-09-03T08:00:00.000Z', end: '2026-09-03T09:00:00.000Z' },
    { start: '2026-09-03T10:00:00.000Z', end: '2026-09-03T11:00:00.000Z' },
  ]);
});
