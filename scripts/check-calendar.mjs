import {
  createAppleEventKitProvider,
  getCalendarBusy,
} from '../packages/calendar/src/index.mjs';
import { SYDNEY_TIME_ZONE } from '../packages/core/src/index.mjs';

const now = new Date();
const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

try {
  const result = await getCalendarBusy({
    start: now.toISOString(),
    end: end.toISOString(),
    timezone: SYDNEY_TIME_ZONE,
    appleProvider: createAppleEventKitProvider({ requestPermission: true }),
  });

  console.log(`Calendar provider: ${result.source ?? 'none'}`);
  if (result.source === 'apple_eventkit') console.log('Permission: granted');
  if (result.fallbackFrom) console.log(`Fallback from: ${result.fallbackFrom}`);
  if (result.fallbackReason) console.log(`Fallback reason: ${result.fallbackReason}`);
  console.log(`Status: ${result.status}`);
  console.log(`Busy intervals: ${result.busy.length}`);
  console.log(`Window: ${now.toISOString()} -> ${end.toISOString()}`);
  for (const failure of result.failures ?? []) {
    console.log(`Failure: ${failure.source} ${failure.code}`);
  }
  if (result.status !== 'available') process.exitCode = 2;
} catch (error) {
  console.error(error.code ?? error.message);
  process.exitCode = error.code === 'CALENDAR_AUTH_REQUIRED' ? 2 : 1;
}
