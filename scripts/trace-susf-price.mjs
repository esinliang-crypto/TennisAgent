import { chromium, devices } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getSusfAvailability } from '../packages/susf/src/index.mjs';

const storageStatePath = resolve('.auth/storageState.json');
const outputPath = resolve('output/susf-price-trace.json');
const bookingUrl = process.env.SUSF_BOOKING_URL ?? 'https://susf.perfectmind.com/';
const days = Number(process.env.SUSF_DAYS_COUNT ?? 7);
const durationMinutes = Number(process.env.SUSF_DURATION ?? 60);
const traceSlots = Number(process.env.SUSF_PRICE_TRACE_SLOTS ?? 2);
const safeClickTime = process.env.SUSF_PRICE_CLICK_TIME === '1';

const priceTerms = [
  'price',
  'rate',
  'fee',
  'cost',
  'amount',
  'charge',
  'total',
  'subtotal',
  'memberPrice',
  'facilityRate',
  'bookingFee',
];

const sensitiveKeyPattern = /cookie|token|auth|password|verification|csrf|session|jwt/i;
const currencyPattern = /(?:\$|AUD\s*)\s?\d+(?:\.\d{2})?|\d+(?:\.\d{2})?\s?(?:AUD|dollars?)/i;

function normalizeConfiguredUrl(value) {
  const trimmed = value.trim();
  const markdownMatch = trimmed.match(/^\[(https?:\/\/[^\]]+)]\((https?:\/\/[^)]+)\)$/);
  if (markdownMatch) return markdownMatch[2].replaceAll('\\&', '&');

  const firstUrlMatch = trimmed.match(/https?:\/\/[^\])\s]+/);
  if (firstUrlMatch) return firstUrlMatch[0].replaceAll('\\&', '&');

  return trimmed.replaceAll('\\&', '&');
}

function safeUrlSummary(rawUrl) {
  const url = new URL(rawUrl);
  const params = {};
  for (const [key, value] of url.searchParams.entries()) {
    params[key] = sensitiveKeyPattern.test(key) ? '[REDACTED]' : value;
  }
  return {
    origin: url.origin,
    pathname: url.pathname,
    searchParams: params,
  };
}

function findKeywordSnippets(text) {
  const snippets = [];
  const lower = text.toLowerCase();
  for (const term of priceTerms) {
    let index = lower.indexOf(term.toLowerCase());
    while (index !== -1 && snippets.length < 20) {
      snippets.push(text.slice(Math.max(0, index - 80), Math.min(text.length, index + 160)).replace(/\s+/g, ' ').trim());
      index = lower.indexOf(term.toLowerCase(), index + term.length);
    }
  }

  const currencyMatch = text.match(currencyPattern);
  if (currencyMatch) {
    const index = currencyMatch.index ?? 0;
    snippets.push(text.slice(Math.max(0, index - 80), Math.min(text.length, index + 160)).replace(/\s+/g, ' ').trim());
  }

  return [...new Set(snippets)].slice(0, 20);
}

function redactValue(key, value) {
  if (sensitiveKeyPattern.test(key)) return '[REDACTED]';
  return value;
}

function collectJsonPriceFields(value, path = '$', out = []) {
  if (Array.isArray(value)) {
    value.slice(0, 200).forEach((item, index) => collectJsonPriceFields(item, `${path}[${index}]`, out));
    return out;
  }

  if (!value || typeof value !== 'object') return out;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (priceTerms.some((term) => key.toLowerCase().includes(term.toLowerCase())) || (
      typeof child === 'string' && currencyPattern.test(child)
    )) {
      out.push({
        path: childPath,
        value: redactValue(key, child),
      });
    }
    collectJsonPriceFields(child, childPath, out);
  }

  return out;
}

function extractSerializedPriceArrays(text) {
  const arrays = [];
  let index = 0;

  while (true) {
    const key = text.indexOf('"Prices"', index);
    if (key === -1) break;

    const colon = text.indexOf(':', key);
    const start = text.indexOf('[', colon);
    if (start === -1) break;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let cursor = start; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }

      if (char === '"') inString = true;
      else if (char === '[') depth += 1;
      else if (char === ']') {
        depth -= 1;
        if (depth === 0) {
          end = cursor + 1;
          break;
        }
      }
    }

    if (end !== -1) {
      try {
        const parsed = JSON.parse(text.slice(start, end));
        arrays.push(parsed.map((price) => ({
          name: price.Name,
          amount: price.Amount,
          isSelected: price.IsSelected,
          canSelect: price.CanSelect,
          displayFee: price.DisplayFee ?? null,
        })));
      } catch {
        // Ignore malformed embedded data; this is only a trace helper.
      }
    }

    index = start + 1;
  }

  return arrays.filter((array) => array.length > 0);
}

function getLandingPageBackUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/\/BookMe4LandingPages\/Facility/i.test(url.pathname)) return null;
    return url.searchParams.get('landingPageBackUrl');
  } catch {
    return null;
  }
}

async function isLoginPage(page) {
  if (/\/login\b|\/account\/login\b|signin|sign-in/i.test(page.url())) return true;

  return page.evaluate(() => {
    const passwordInputs = [...document.querySelectorAll('input[type="password"]')];
    return passwordInputs.some((passwordInput) => {
      const form = passwordInput.closest('form');
      const action = form?.action ?? '';
      if (/\/login\b|\/account\/login\b|signin|sign-in/i.test(action)) return true;

      const scope = form ?? document.body;
      const scopeText = scope?.innerText ?? '';
      const hasUserField = Boolean(scope?.querySelector(
        'input[type="email"], input[name*="email" i], input[name*="user" i], input[id*="email" i], input[id*="user" i]',
      ));
      return Boolean(hasUserField && /login|sign in/i.test(scopeText));
    });
  }).catch(() => false);
}

async function findCourtFacilities(page) {
  const courtTargets = [
    { court: 'Court 4', domLabel: 'Tennis Synthetic Court 4' },
    { court: 'Court 5', domLabel: 'Tennis Synthetic Court 5' },
    { court: 'Court 6', domLabel: 'Tennis Synthetic Court 6' },
  ];

  const facilities = await page.$$eval('[data-facilityid]', (nodes) => {
    const clean = (value) => value.replace(/\s+/g, ' ').trim();

    return nodes.map((node) => {
      const element = node;
      const facilityId = element.getAttribute('data-facilityid');
      const candidates = [
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.textContent,
        element.closest('[data-name], [aria-label], [title]')?.getAttribute('data-name'),
        element.closest('[data-name], [aria-label], [title]')?.getAttribute('aria-label'),
        element.closest('[data-name], [aria-label], [title]')?.getAttribute('title'),
        element.closest('li, tr, article, section, div')?.textContent,
      ].filter(Boolean);

      return {
        facilityId,
        label: clean(candidates.join(' ')),
      };
    }).filter((item) => item.facilityId);
  });

  return courtTargets.map(({ court, domLabel }) => {
    const escapedLabel = domLabel.replace(/\s+/g, '\\s*');
    const escapedShortName = court.replace(/\s+/g, '\\s*');
    const pattern = new RegExp(`\\b(?:${escapedLabel}|${escapedShortName})\\b`, 'i');
    const match = facilities.find((facility) => pattern.test(facility.label));
    return match ? { court, domLabel, facilityId: match.facilityId, label: match.label } : null;
  }).filter(Boolean);
}

async function pageHasTargetCourtFacilities(page) {
  return (await findCourtFacilities(page)).length === 3;
}

async function navigateToTennisFacilityList(page, rawBookingUrl) {
  const normalized = normalizeConfiguredUrl(rawBookingUrl);
  await page.goto(normalized, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  if (await pageHasTargetCourtFacilities(page)) return page.url();

  const landingPageBackUrl = getLandingPageBackUrl(page.url()) ?? getLandingPageBackUrl(normalized);
  if (landingPageBackUrl) {
    await page.goto(landingPageBackUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    if (await pageHasTargetCourtFacilities(page)) return page.url();
  }

  const rentFacilityUrl = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href]')];
    const match = links.find((link) => /Rent a Facility/i.test(link.textContent ?? ''));
    return match?.href ?? null;
  }).catch(() => null);

  if (rentFacilityUrl) {
    await page.goto(rentFacilityUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  if (await pageHasTargetCourtFacilities(page)) return page.url();

  const clickedTennis = await page.evaluate(() => {
    const controls = [
      ...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]'),
    ];
    const tennisControl = controls.find((control) => {
      const text = [
        control.textContent,
        control.getAttribute('value'),
        control.getAttribute('aria-label'),
        control.getAttribute('title'),
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      return /^Tennis$/i.test(text);
    });
    if (!tennisControl) return false;
    tennisControl.scrollIntoView({ block: 'center', inline: 'center' });
    tennisControl.click();
    return true;
  }).catch(() => false);

  if (clickedTennis) {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('[data-facilityid]').length > 0, null, {
      timeout: 15_000,
    }).catch(() => {});
  }

  return page.url();
}

async function chooseCourt(page, court) {
  const clicked = await page.evaluate((facilityId) => {
    const facilityNode = document.querySelector(`[data-facilityid="${facilityId}"]`);
    if (!facilityNode) return false;

    const root = facilityNode.closest('li, tr, article, section, .card, .facility, .facility-item, div') ?? facilityNode;
    const candidates = [
      ...root.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]'),
    ];

    const choose = candidates.find((candidate) => {
      const text = [
        candidate.textContent,
        candidate.getAttribute('value'),
        candidate.getAttribute('aria-label'),
        candidate.getAttribute('title'),
      ].filter(Boolean).join(' ');
      return /choose|select|book|availability/i.test(text);
    });

    const target = choose ?? facilityNode;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.click();
    return true;
  }, court.facilityId);

  if (!clicked) throw new Error(`Could not choose ${court.domLabel}`);
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function scanDom(page) {
  return page.evaluate((terms) => {
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const bodyText = document.body?.innerText ?? '';
    const scripts = [...document.scripts].map((script) => script.textContent ?? '').join('\n');
    const lowerBody = bodyText.toLowerCase();
    const lowerScripts = scripts.toLowerCase();
    const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')]
      .map((element) => clean([
        element.textContent,
        element.getAttribute('value'),
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
      ].filter(Boolean).join(' ')))
      .filter(Boolean)
      .slice(0, 100);

    return {
      currentUrl: location.href,
      title: document.title,
      hasLoginForm: Boolean(document.querySelector('input[type="password"]') && /login|sign in/i.test(bodyText)),
      tennisSyntheticMentions: (bodyText.match(/Tennis Synthetic Court/g) || []).length,
      facilityCardCount: document.querySelectorAll('[data-facilityid]').length,
      feePanels: [...document.querySelectorAll('.fees-list, .fee-item, [data-bind*="selectedServicePrices"], [data-bind*="Price"]')]
        .map((element) => (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 20),
      bodyPriceKeywordHits: terms.filter((term) => lowerBody.includes(term.toLowerCase())),
      scriptPriceKeywordHits: terms.filter((term) => lowerScripts.includes(term.toLowerCase())),
      bodyCurrencySnippets: [...bodyText.matchAll(/(?:\$|AUD\s*)\s?\d+(?:\.\d{2})?|\d+(?:\.\d{2})?\s?(?:AUD|dollars?)/gi)]
        .slice(0, 20)
        .map((match) => clean(bodyText.slice(Math.max(0, match.index - 80), Math.min(bodyText.length, match.index + 120)))),
      visibleControlSample: controls,
    };
  }, priceTerms);
}

async function maybeClickTime(page, target) {
  if (!safeClickTime) {
    return { skipped: 'Set SUSF_PRICE_CLICK_TIME=1 to click a visible time control and stop before checkout/payment.' };
  }

  const clicked = await page.evaluate((startTime) => {
    const time = startTime.slice(11, 16);
    const unsafe = /checkout|payment|pay|submit|confirm|complete|place order/i;
    const controls = [
      ...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]'),
    ];
    const match = controls.find((control) => {
      const text = [
        control.textContent,
        control.getAttribute('value'),
        control.getAttribute('aria-label'),
        control.getAttribute('title'),
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      return text.includes(time) && !unsafe.test(text);
    });
    if (!match) return false;
    match.scrollIntoView({ block: 'center', inline: 'center' });
    match.click();
    return true;
  }, target.startTime);

  if (clicked) {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2_000);
  }

  return { clicked };
}

async function traceDevice({ deviceName, contextOptions, targets }) {
  const networkFindings = [];
  const browser = await chromium.launch({ headless: process.env.HEADLESS === '1' });
  const context = await browser.newContext({
    storageState: storageStatePath,
    ...contextOptions,
  });
  const page = await context.newPage();

  page.on('response', async (response) => {
    const request = response.request();
    const resourceType = request.resourceType();
    if (!['fetch', 'xhr', 'document'].includes(resourceType)) return;

    const contentType = response.headers()['content-type'] ?? '';
    if (!/json|text|html|javascript/i.test(contentType)) return;

    let text = '';
    try {
      text = await response.text();
    } catch {
      return;
    }

    const snippets = findKeywordSnippets(text);
    let jsonPriceFields = [];
    if (/json/i.test(contentType)) {
      try {
        jsonPriceFields = collectJsonPriceFields(JSON.parse(text)).slice(0, 50);
      } catch {
        jsonPriceFields = [];
      }
    }
    const serializedPriceArrays = extractSerializedPriceArrays(text).slice(0, 20);

    if (snippets.length === 0 && jsonPriceFields.length === 0 && serializedPriceArrays.length === 0) return;

    networkFindings.push({
      resourceType,
      method: request.method(),
      status: response.status(),
      url: safeUrlSummary(response.url()),
      keywordSnippets: snippets,
      jsonPriceFields,
      serializedPriceArrays,
    });
  });

  try {
    const facilityListUrl = await navigateToTennisFacilityList(page, bookingUrl);
    if (await isLoginPage(page)) throw new Error(`${deviceName}: session expired`);
    const courts = await findCourtFacilities(page);

    const targetResults = [];
    for (const target of targets) {
      const court = courts.find((item) => item.court === target.court);
      if (!court) {
        targetResults.push({ target, error: 'Court not found in facility list' });
        continue;
      }

      await page.goto(facilityListUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await chooseCourt(page, court);
      await page.waitForTimeout(3_000);

      const beforeClickDom = await scanDom(page);
      const clickResult = await maybeClickTime(page, target);
      const afterClickDom = await scanDom(page);

      targetResults.push({
        target,
        courtLabel: court.label,
        beforeClickDom,
        clickResult,
        afterClickDom,
      });
    }

    return {
      deviceName,
      facilityListUrl,
      currentUrl: page.url(),
      title: await page.title(),
      courtsFound: courts.map((court) => ({
        court: court.court,
        label: court.label,
      })),
      targetResults,
      networkFindings,
    };
  } finally {
    await browser.close();
  }
}

function chooseTargets(availability) {
  const byCourt = new Map();
  for (const row of availability) {
    if (!byCourt.has(row.court)) byCourt.set(row.court, row);
  }

  const targets = [...byCourt.values()].slice(0, traceSlots);
  if (targets.length >= traceSlots) return targets;
  return availability.slice(0, traceSlots);
}

await readFile(storageStatePath, 'utf8');

console.log('Collecting real SUSF availability to choose trace targets.');
const availability = await getSusfAvailability({ days, durationMinutes });
const targets = chooseTargets(availability);

console.log(`Trace targets: ${targets.map((target) => `${target.court} ${target.startTime}`).join('; ')}`);
console.log(`Safe click time controls: ${safeClickTime ? 'enabled' : 'disabled'}`);

const desktop = await traceDevice({
  deviceName: 'desktop',
  contextOptions: {
    viewport: { width: 1440, height: 1000 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  },
  targets,
});

const mobile = await traceDevice({
  deviceName: 'mobile',
  contextOptions: devices['iPhone 14'],
  targets,
});

const result = {
  generatedAt: new Date().toISOString(),
  note: 'Read-only price trace. Secret values are not recorded. Time-control clicking is disabled unless SUSF_PRICE_CLICK_TIME=1.',
  targets,
  desktop,
  mobile,
};

await mkdir('output', { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);

for (const device of [desktop, mobile]) {
  console.log('');
  console.log(`${device.deviceName}:`);
  console.log(`current URL: ${device.currentUrl}`);
  console.log(`page title: ${device.title}`);
  console.log(`courts found: ${device.courtsFound.map((court) => court.court).join(', ')}`);
  console.log(`network price findings: ${device.networkFindings.length}`);
  for (const target of device.targetResults) {
    console.log(`${target.target.court} ${target.target.startTime}:`);
    console.log(`  before click body terms: ${target.beforeClickDom.bodyPriceKeywordHits.join(', ') || 'none'}`);
    console.log(`  before click script terms: ${target.beforeClickDom.scriptPriceKeywordHits.join(', ') || 'none'}`);
    console.log(`  before click currency snippets: ${target.beforeClickDom.bodyCurrencySnippets.length}`);
    console.log(`  before click fee panels: ${target.beforeClickDom.feePanels.length}`);
    for (const feePanel of target.beforeClickDom.feePanels.slice(0, 3)) {
      console.log(`    ${feePanel}`);
    }
    console.log(`  click: ${JSON.stringify(target.clickResult)}`);
    console.log(`  after click body terms: ${target.afterClickDom.bodyPriceKeywordHits.join(', ') || 'none'}`);
    console.log(`  after click currency snippets: ${target.afterClickDom.bodyCurrencySnippets.length}`);
  }
}

console.log('');
console.log(`Wrote safe trace details to ${outputPath}`);
