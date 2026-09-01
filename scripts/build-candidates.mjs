import { getCurrentSusfCandidates, summarizeCandidates } from '../packages/core/src/index.mjs';

function displayCandidate(candidate) {
  const nextHour = candidate.features.nextHourFree ? 'yes' : 'no';
  return `${candidate.court} | ${candidate.features.localDate} ${candidate.features.localTime} | next hour free: ${nextHour}`;
}

try {
  const candidates = await getCurrentSusfCandidates({
    days: Number(process.env.SUSF_DAYS_COUNT ?? 7),
    durationMinutes: Number(process.env.SUSF_DURATION ?? 60),
  });
  const summary = summarizeCandidates(candidates);

  console.log(`Total candidates: ${summary.total}`);
  console.log(`By court: ${JSON.stringify(summary.byCourt)}`);
  console.log(`Next hour free count: ${summary.nextHourFree}`);
  console.log('');
  for (const candidate of candidates.slice(0, 10)) {
    console.log(displayCandidate(candidate));
  }
} catch (error) {
  console.error(error.code ?? 'CANDIDATE_BUILD_ERROR');
  console.error(error.message);
  process.exit(1);
}
