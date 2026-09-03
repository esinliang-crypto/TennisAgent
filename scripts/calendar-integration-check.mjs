import {
  applyHardConstraints,
  enrichCandidates,
} from '../packages/core/src/index.mjs';
import { normalizePreferenceProfile } from '../packages/preferences/src/index.mjs';

const now = new Date();
const slotStart = new Date(now);
slotStart.setUTCMinutes(0, 0, 0);
slotStart.setUTCHours(slotStart.getUTCHours() + 1);

const candidates = [
  {
    id: 'calendar-integration-smoke-1',
    venue: 'SUSF',
    court: 'Court 4',
    startTime: slotStart.toISOString(),
    durationMinutes: 60,
    features: {
      nextHourFree: true,
      localDate: '',
      localTime: '',
      price: null,
      priceOptions: [],
    },
  },
];

const preferenceProfile = normalizePreferenceProfile({
  version: 1,
  searchWindowDays: 7,
  preferences: [],
  hardConstraints: [],
  unresolvedPreferences: [],
  sourceText: 'calendar integration smoke',
  updatedAt: now.toISOString(),
});

const enriched = await enrichCandidates({
  candidates,
  weatherAdapter: async ({ slots }) => slots.map((slot) => ({
    candidateId: slot.id,
    startTime: slot.startTime,
    temperatureC: null,
    feelsLikeC: null,
    precipitationProbability: null,
    precipitationMm: null,
    windKph: null,
    weatherCode: null,
    source: 'synthetic',
    forecastAvailable: true,
  })),
});
const { accepted, rejected } = applyHardConstraints({
  candidates: enriched,
  preferenceProfile,
});

const calendarUnknown = rejected.filter((item) => (
  item.reasons.some((reason) => reason.feature === 'calendar' && reason.reason === 'calendar_unknown')
)).length;

console.log(JSON.stringify({
  candidates: candidates.length,
  calendarSource: enriched[0]?.features.calendar?.source ?? null,
  calendarStatus: enriched[0]?.features.calendar?.status ?? null,
  calendarFree: enriched[0]?.features.calendar?.free ?? null,
  calendarUnknown,
  feasible: accepted.length,
}, null, 2));
