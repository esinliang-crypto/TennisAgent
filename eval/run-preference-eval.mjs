import { readFile } from 'node:fs/promises';
import { interpretPreferences } from '../packages/preferences/src/index.mjs';

const cases = JSON.parse(await readFile(new URL('./preference-cases.json', import.meta.url), 'utf8'));

let passed = 0;

for (const testCase of cases) {
  const profile = await interpretPreferences(testCase.input);
  const byFeature = Object.fromEntries(profile.preferences.map((preference) => [preference.feature, preference]));

  for (const [feature, expected] of Object.entries(testCase.expected)) {
    const actual = byFeature[feature];
    if (!actual) throw new Error(`${testCase.name}: missing ${feature}`);
    for (const [key, value] of Object.entries(expected)) {
      if (JSON.stringify(actual[key]) !== JSON.stringify(value)) {
        throw new Error(`${testCase.name}: ${feature}.${key} expected ${JSON.stringify(value)}, got ${JSON.stringify(actual[key])}`);
      }
    }
  }

  passed += 1;
}

console.log(`Preference eval passed: ${passed}/${cases.length}`);
