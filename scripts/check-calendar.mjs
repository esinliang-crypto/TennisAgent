import { getCalendarBusy } from '../packages/calendar/src/index.mjs';
import { SYDNEY_TIME_ZONE } from '../packages/core/src/index.mjs';

const now = new Date();
const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

try {
  const { busy } = await getCalendarBusy({
    start: now.toISOString(),
    end: end.toISOString(),
    timezone: SYDNEY_TIME_ZONE,
  });

  console.log(JSON.stringify({
    start: now.toISOString(),
    end: end.toISOString(),
    timezone: SYDNEY_TIME_ZONE,
    busyIntervalCount: busy.length,
  }, null, 2));
} catch (error) {
  console.error(error.code ?? error.message);
  process.exitCode = error.code === 'CALENDAR_AUTH_REQUIRED' ? 2 : 1;
}
