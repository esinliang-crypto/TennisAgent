import { CalendarAuthError, getCalendarAccessToken } from './auth.mjs';

const GOOGLE_CALENDAR_FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy';

class CalendarAdapterError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = 'CalendarAdapterError';
    this.code = code;
  }
}

function normalizeBusyIntervals(json) {
  const calendars = json?.calendars ?? {};
  const busy = [];

  for (const calendar of Object.values(calendars)) {
    for (const interval of calendar.busy ?? []) {
      if (typeof interval.start === 'string' && typeof interval.end === 'string') {
        busy.push({ start: interval.start, end: interval.end });
      }
    }
  }

  return busy.sort((a, b) => a.start.localeCompare(b.start));
}

async function getCalendarBusy({
  start,
  end,
  timezone,
  calendarId = 'primary',
  fetchImpl = globalThis.fetch,
  accessToken,
  tokenProvider = getCalendarAccessToken,
} = {}) {
  if (!start || !end) throw new Error('start and end are required');
  if (!timezone) throw new Error('timezone is required');

  const selectedAccessToken = accessToken ?? await tokenProvider();
  if (!selectedAccessToken) {
    throw new CalendarAuthError('CALENDAR_AUTH_REQUIRED', 'Calendar access token is required');
  }

  const response = await fetchImpl(GOOGLE_CALENDAR_FREEBUSY_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${selectedAccessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: start,
      timeMax: end,
      timeZone: timezone,
      items: [{ id: calendarId }],
    }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new CalendarAuthError('CALENDAR_AUTH_REQUIRED', `Google Calendar auth failed with HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new CalendarAdapterError('CALENDAR_FREEBUSY_FAILED', `Google Calendar FreeBusy failed with HTTP ${response.status}`);
  }

  return {
    busy: normalizeBusyIntervals(await response.json()),
  };
}

export {
  CalendarAdapterError,
  GOOGLE_CALENDAR_FREEBUSY_URL,
  getCalendarBusy,
  normalizeBusyIntervals,
};
