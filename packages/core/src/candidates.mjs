import { createHash } from 'node:crypto';
import { getSusfAvailability } from '../../susf/src/index.mjs';
import { getSydneyLocalDateTime } from './features.mjs';

function stableCandidateId({ provider, venue, court, startTime, durationMinutes }) {
  const input = [provider, venue, court, startTime, durationMinutes].join('|');
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function buildCandidate(availability) {
  const provider = availability.venue;
  const local = getSydneyLocalDateTime(availability.startTime);

  return {
    id: stableCandidateId({
      provider,
      venue: availability.venue,
      court: availability.court,
      startTime: availability.startTime,
      durationMinutes: availability.durationMinutes,
    }),
    venue: availability.venue,
    court: availability.court,
    startTime: availability.startTime,
    durationMinutes: availability.durationMinutes,
    features: {
      nextHourFree: availability.nextHourAlsoAvailable,
      localTime: local.localTime,
      localDate: local.localDate,
      preferredTime: null,
      price: null,
      priceOptions: availability.priceOptions ?? [],
    },
    source: {
      provider,
    },
  };
}

function buildCandidates(availability) {
  if (!Array.isArray(availability)) {
    throw new Error('buildCandidates expects an array of availability objects');
  }

  return availability
    .map(buildCandidate)
    .sort((a, b) => `${a.startTime} ${a.court}`.localeCompare(`${b.startTime} ${b.court}`));
}

async function getCurrentSusfCandidates({
  days = 7,
  durationMinutes = 60,
} = {}) {
  const availability = await getSusfAvailability({ days, durationMinutes });
  return buildCandidates(availability);
}

function summarizeCandidates(candidates) {
  const byCourt = {};
  let nextHourFree = 0;

  for (const candidate of candidates) {
    byCourt[candidate.court] = (byCourt[candidate.court] ?? 0) + 1;
    if (candidate.features.nextHourFree) nextHourFree += 1;
  }

  return {
    total: candidates.length,
    byCourt,
    nextHourFree,
  };
}

export {
  buildCandidate,
  buildCandidates,
  getCurrentSusfCandidates,
  stableCandidateId,
  summarizeCandidates,
};
