import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const APPLE_EVENTKIT_SOURCE = 'apple_eventkit';
const DEFAULT_APPLE_CALENDAR_HELPER_DIR = resolve('native/apple-calendar');

class AppleCalendarProviderError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = 'AppleCalendarProviderError';
    this.code = code;
  }
}

function normalizeAppleNativeResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppleCalendarProviderError('APPLE_MALFORMED_RESPONSE', 'Apple Calendar helper returned a non-object response');
  }

  if (raw.error?.code) {
    throw new AppleCalendarProviderError(raw.error.code, raw.error.message ?? raw.error.code);
  }

  if (raw.source !== APPLE_EVENTKIT_SOURCE || raw.status !== 'available' || !Array.isArray(raw.busy)) {
    throw new AppleCalendarProviderError('APPLE_MALFORMED_RESPONSE', 'Apple Calendar helper returned malformed JSON');
  }

  return {
    source: APPLE_EVENTKIT_SOURCE,
    status: 'available',
    permission: raw.permission ?? 'granted',
    busy: raw.busy
      .filter((interval) => typeof interval.start === 'string' && typeof interval.end === 'string')
      .map((interval) => ({ start: interval.start, end: interval.end }))
      .sort((a, b) => a.start.localeCompare(b.start)),
  };
}

function parseAppleHelperStdout(stdout) {
  const text = stdout.trim();
  if (!text) {
    throw new AppleCalendarProviderError('APPLE_MALFORMED_RESPONSE', 'Apple Calendar helper did not return JSON');
  }

  try {
    return normalizeAppleNativeResult(JSON.parse(text));
  } catch (error) {
    if (error instanceof AppleCalendarProviderError) throw error;
    throw new AppleCalendarProviderError('APPLE_MALFORMED_RESPONSE', 'Apple Calendar helper returned invalid JSON', { cause: error });
  }
}

function createAppleEventKitProvider({
  helperDir = DEFAULT_APPLE_CALENDAR_HELPER_DIR,
  execFileImpl = execFileAsync,
  currentPlatform = platform(),
  requestPermission = false,
} = {}) {
  return {
    source: APPLE_EVENTKIT_SOURCE,
    async getBusy({ start, end, timezone }) {
      if (currentPlatform !== 'darwin') {
        throw new AppleCalendarProviderError('APPLE_UNAVAILABLE', 'Apple EventKit is only available on macOS');
      }

      const args = [
        'run',
        '--package-path',
        helperDir,
        'AppleCalendarBridge',
        '--start',
        start,
        '--end',
        end,
        '--timezone',
        timezone,
      ];
      if (requestPermission) args.push('--request-permission');

      try {
        const { stdout } = await execFileImpl('swift', args, {
          cwd: helperDir,
          maxBuffer: 1024 * 1024,
        });
        return parseAppleHelperStdout(stdout);
      } catch (error) {
        if (error instanceof AppleCalendarProviderError) throw error;
        const stdout = typeof error.stdout === 'string' ? error.stdout : '';
        if (stdout.trim()) return parseAppleHelperStdout(stdout);
        throw new AppleCalendarProviderError('APPLE_PROVIDER_ERROR', error.message, { cause: error });
      }
    },
  };
}

export {
  APPLE_EVENTKIT_SOURCE,
  AppleCalendarProviderError,
  DEFAULT_APPLE_CALENDAR_HELPER_DIR,
  createAppleEventKitProvider,
  normalizeAppleNativeResult,
  parseAppleHelperStdout,
};
