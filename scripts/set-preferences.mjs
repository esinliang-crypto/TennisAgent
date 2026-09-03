import { interpretPreferences } from '../packages/preferences/src/interpreter.mjs';
import { savePreferenceProfile } from '../packages/preferences/src/store.mjs';

function preferenceSummaryLine(preference) {
  if (preference.feature === 'price') {
    return `price: ${preference.direction ?? 'unspecified'} / ${preference.importance}`;
  }
  if (preference.feature === 'next_hour_free') {
    return `next_hour_free: ${preference.target} / ${preference.importance}`;
  }
  if (preference.feature === 'consecutive_availability') {
    const minutes = preference.rule?.minMinutes ?? preference.rule?.preferredMinutes ?? 'unspecified';
    return `consecutive_availability: ${minutes} minutes / ${preference.importance}`;
  }
  if (preference.feature === 'duration') {
    const minutes = preference.rule?.exactMinutes ?? preference.rule?.minMinutes ?? preference.rule?.maxMinutes ?? 'unspecified';
    return `duration: ${minutes} minutes / ${preference.importance}`;
  }
  if (preference.feature === 'start_time') {
    const before = preference.rule?.before ? `before ${preference.rule.before}` : null;
    const after = preference.rule?.after ? `after ${preference.rule.after}` : null;
    const period = preference.rule?.period ? `period ${preference.rule.period}` : null;
    const rule = [before, after, period].filter(Boolean).join(' or ') || 'unspecified';
    return `start_time: ${rule} / ${preference.importance}`;
  }
  return `${preference.feature}: ${preference.importance}`;
}

function objectiveSummaryLine(objective) {
  return `objective: ${objective.feature} ${objective.direction} / ${objective.priority}`;
}

function unresolvedSummaryLine(unresolved) {
  return typeof unresolved === 'string' ? unresolved : unresolved.text;
}

const text = process.argv.slice(2).join(' ').trim();

if (!text) {
  console.error('Usage: npm run preference:set -- "your natural-language preference"');
  process.exit(1);
}

try {
  const profile = await interpretPreferences(text);
  const saved = await savePreferenceProfile(profile);

  console.log('Preference profile updated.');
  for (const preference of saved.preferences) {
    console.log(preferenceSummaryLine(preference));
  }
  for (const objective of saved.objectives ?? []) {
    console.log(objectiveSummaryLine(objective));
  }
  if (saved.unresolvedPreferences.length > 0) {
    console.log(`unresolved: ${saved.unresolvedPreferences.map(unresolvedSummaryLine).join('; ')}`);
  }
} catch (error) {
  console.error(error.code ?? 'PREFERENCE_SET_ERROR');
  console.error(error.message);
  process.exit(1);
}
