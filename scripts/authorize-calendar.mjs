import {
  createAppleEventKitProvider,
  getCalendarBusy,
} from '../packages/calendar/src/index.mjs';
import { SYDNEY_TIME_ZONE } from '../packages/core/src/index.mjs';

const now = new Date();
const end = new Date(now.getTime() + 60 * 60 * 1000);

try {
  const result = await getCalendarBusy({
    start: now.toISOString(),
    end: end.toISOString(),
    timezone: SYDNEY_TIME_ZONE,
    providerMode: 'apple',
    appleProvider: createAppleEventKitProvider({ requestPermission: true }),
  });

  console.log(`Calendar provider: ${result.source}`);
  console.log('Permission: granted');
  console.log(`Busy intervals: ${result.busy.length}`);
  console.log(`Window: ${now.toISOString()} -> ${end.toISOString()}`);
} catch (error) {
  console.error(error.code ?? error.message);
  process.exitCode = 1;
}
