import { loadPreferenceProfile } from '../packages/preferences/src/store.mjs';

try {
  const profile = await loadPreferenceProfile();
  console.log(JSON.stringify(profile, null, 2));
} catch (error) {
  console.error(error.code ?? 'PREFERENCE_SHOW_ERROR');
  console.error(error.message);
  process.exit(1);
}
