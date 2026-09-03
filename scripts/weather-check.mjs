import { getWeatherForSlots } from '../packages/weather/src/index.mjs';
import { USYD_TENNIS_LOCATION } from '../packages/core/src/index.mjs';

const now = new Date();
const nextHour = new Date(now);
nextHour.setUTCMinutes(15, 0, 0);
nextHour.setUTCHours(nextHour.getUTCHours() + 1);

const slots = [
  {
    id: 'weather-smoke-1',
    startTime: nextHour.toISOString(),
    durationMinutes: 60,
  },
];

const weather = await getWeatherForSlots({
  location: USYD_TENNIS_LOCATION,
  slots,
});

console.log(JSON.stringify({
  provider: 'open-meteo',
  location: USYD_TENNIS_LOCATION,
  slots: slots.length,
  forecast: weather,
}, null, 2));
