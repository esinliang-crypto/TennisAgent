import { annotateCandidateWithPreferences, getCurrentSusfCandidates, summarizeCandidates } from '../packages/core/src/index.mjs';
import { loadPreferenceProfile } from '../packages/preferences/src/store.mjs';

try {
  const profile = await loadPreferenceProfile();
  const candidates = await getCurrentSusfCandidates({
    days: profile.searchWindowDays,
    durationMinutes: Number(process.env.SUSF_DURATION ?? 60),
  });
  const summary = summarizeCandidates(candidates);
  const annotated = candidates.slice(0, 10).map((candidate) => annotateCandidateWithPreferences(candidate, profile));

  console.log(`Total candidates: ${summary.total}`);
  console.log(`By court: ${JSON.stringify(summary.byCourt)}`);
  console.log(`Next hour free count: ${summary.nextHourFree}`);
  console.log('');
  for (const candidate of annotated) {
    console.log(JSON.stringify({
      id: candidate.id,
      court: candidate.court,
      startTime: candidate.startTime,
      localDate: candidate.features.localDate,
      localTime: candidate.features.localTime,
      matches: candidate.matches,
    }, null, 2));
  }
} catch (error) {
  console.error(error.code ?? 'PREFERENCE_PREVIEW_ERROR');
  console.error(error.message);
  process.exit(1);
}
