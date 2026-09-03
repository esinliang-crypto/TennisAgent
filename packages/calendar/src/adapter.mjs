import { CalendarAuthError } from './auth.mjs';
import { createAppleEventKitProvider } from './providers/apple-eventkit.mjs';
import {
  GOOGLE_CALENDAR_FREEBUSY_URL,
  GoogleCalendarProviderError,
  createGoogleFreeBusyProvider,
  normalizeBusyIntervals,
} from './providers/google-freebusy.mjs';

class CalendarAdapterError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = 'CalendarAdapterError';
    this.code = code;
  }
}

function unavailableResult({ failures, source = null } = {}) {
  return {
    source,
    status: 'unavailable',
    busy: [],
    failures,
  };
}

function normalizeProviderMode(mode = process.env.CALENDAR_PROVIDER ?? 'auto') {
  if (!['auto', 'apple', 'google'].includes(mode)) {
    throw new CalendarAdapterError('CALENDAR_PROVIDER_INVALID', 'CALENDAR_PROVIDER must be auto, apple, or google');
  }
  return mode;
}

async function tryProvider(provider, request) {
  try {
    return await provider.getBusy(request);
  } catch (error) {
    return {
      error,
      failure: {
        source: provider.source,
        code: error.code ?? 'CALENDAR_PROVIDER_ERROR',
        message: error.message,
      },
    };
  }
}

function createCalendarProviderSet({
  appleProvider = createAppleEventKitProvider(),
  googleProvider = createGoogleFreeBusyProvider(),
} = {}) {
  return {
    appleProvider,
    googleProvider,
  };
}

async function getCalendarBusy({
  start,
  end,
  timezone,
  providerMode = process.env.CALENDAR_PROVIDER ?? 'auto',
  appleProvider,
  googleProvider,
  fallbackOnApplePermissionDenied = true,
  ...googleOptions
} = {}) {
  if (!start || !end) throw new Error('start and end are required');
  if (!timezone) throw new Error('timezone is required');

  const mode = normalizeProviderMode(providerMode);
  const providers = createCalendarProviderSet({
    appleProvider,
    googleProvider: googleProvider ?? createGoogleFreeBusyProvider(googleOptions),
  });
  const request = { start, end, timezone };

  if (mode === 'apple') {
    const result = await tryProvider(providers.appleProvider, request);
    if (!result.error) return result;
    throw result.error;
  }

  if (mode === 'google') {
    const result = await tryProvider(providers.googleProvider, request);
    if (!result.error) return result;
    throw result.error;
  }

  const appleResult = await tryProvider(providers.appleProvider, request);
  if (!appleResult.error) return appleResult;

  const appleCode = appleResult.failure.code;
  const mayFallback = appleCode !== 'APPLE_PERMISSION_DENIED' || fallbackOnApplePermissionDenied;
  if (!mayFallback) {
    return unavailableResult({
      source: 'apple_eventkit',
      failures: [appleResult.failure],
    });
  }

  const googleResult = await tryProvider(providers.googleProvider, request);
  if (!googleResult.error) {
    return {
      ...googleResult,
      fallbackFrom: 'apple_eventkit',
      fallbackReason: appleCode,
    };
  }

  return unavailableResult({
    failures: [appleResult.failure, googleResult.failure],
  });
}

export {
  CalendarAdapterError,
  CalendarAuthError,
  GOOGLE_CALENDAR_FREEBUSY_URL,
  GoogleCalendarProviderError,
  createCalendarProviderSet,
  getCalendarBusy,
  normalizeBusyIntervals,
  normalizeProviderMode,
};
