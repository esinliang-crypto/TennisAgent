import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverTennisCourtsFromFacilities,
  extractRateTableFromHtml,
} from '../packages/susf/src/index.mjs';

test('dynamically discovers multiple Tennis Courts', () => {
  const courts = discoverTennisCourtsFromFacilities([
    { facilityId: 'hard-1', label: 'Choose Tennis Hard Court 1 Read more Location: Sports and Aquatic Centre' },
    { facilityId: 'hard-2', label: 'Choose Tennis Hard Court 2 Read more Location: Sports and Aquatic Centre' },
    { facilityId: 'synthetic-4', label: 'Choose Tennis Synthetic Court 4 Read more Location: Sports and Aquatic Centre' },
    { facilityId: 'synthetic-5', label: 'Choose Tennis Synthetic Court 5 Read more Location: Sports and Aquatic Centre' },
    { facilityId: 'synthetic-6', label: 'Choose Tennis Synthetic Court 6 Read more Location: Sports and Aquatic Centre' },
  ]);

  assert.deepEqual(courts.map((court) => court.court), ['Court 1', 'Court 2', 'Court 4', 'Court 5', 'Court 6']);
});

test('dynamic discovery does not assume fixed Court count', () => {
  const courts = discoverTennisCourtsFromFacilities([
    { facilityId: 'only-2', label: 'Choose Tennis Hard Court 2' },
    { facilityId: 'only-8', label: 'Choose Tennis Synthetic Court 8' },
  ]);

  assert.deepEqual(courts.map((court) => court.court), ['Court 2', 'Court 8']);
});

test('dynamic discovery dedupes repeated nodes by facilityId', () => {
  const courts = discoverTennisCourtsFromFacilities([
    { facilityId: 'court-4', label: 'Choose Tennis Synthetic Court 4' },
    { facilityId: 'court-4', label: 'Choose Choose' },
    { facilityId: 'court-5', label: 'Choose Tennis Synthetic Court 5' },
  ]);

  assert.deepEqual(courts.map((court) => court.court), ['Court 4', 'Court 5']);
});

test('60min peak/offpeak rate table parses from serialized Prices', () => {
  const html = `
    <script>
      window.model = {"Prices":[
        {"Name":"Tennis Peak Fee","Amount":39.00},
        {"Name":"Tennis Off-Peak Fee","Amount":29.00}
      ]};
    </script>
  `;
  const rates = extractRateTableFromHtml(html);

  assert.deepEqual(rates, [
    { name: 'Tennis Peak Fee', amount: 39, currency: 'AUD', durationMinutes: 60 },
    { name: 'Tennis Off-Peak Fee', amount: 29, currency: 'AUD', durationMinutes: 60 },
  ]);
});

test('rate amount is number and currency is AUD', () => {
  const [rate] = extractRateTableFromHtml('{"Prices":[{"Name":"Tennis Off-Peak Fee","Amount":29.00}]}');

  assert.equal(typeof rate.amount, 'number');
  assert.equal(rate.currency, 'AUD');
});

test('missing rate table returns empty options clearly', () => {
  assert.deepEqual(extractRateTableFromHtml('<html>No prices here</html>'), []);
});
