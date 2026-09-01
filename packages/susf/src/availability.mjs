import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_BOOKING_URL = 'https://susf.perfectmind.com/';
const DEFAULT_STORAGE_STATE_PATH = resolve('.auth/storageState.json');
const DEFAULT_CAPTURE_TIMEOUT_MS = 120_000;

const sensitiveHeaderNames = new Set([
  'authorization',
  'cookie',
  'pm-auth',
  'pmauth',
  'x-csrf-token',
  'x-xsrf-token',
  'requestverificationtoken',
  '__requestverificationtoken',
]);

class SusfAvailabilityError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = 'SusfAvailabilityError';
    this.code = code;
  }
}

function normalizeConfiguredUrl(value) {
  const trimmed = value.trim();
  const markdownMatch = trimmed.match(/^\[(https?:\/\/[^\]]+)]\((https?:\/\/[^)]+)\)$/);
  if (markdownMatch) return markdownMatch[2].replaceAll('\\&', '&');

  const firstUrlMatch = trimmed.match(/https?:\/\/[^\])\s]+/);
  if (firstUrlMatch) return firstUrlMatch[0].replaceAll('\\&', '&');

  return trimmed.replaceAll('\\&', '&');
}

function todayIsoDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLikeCaptured(isoDate, capturedValue) {
  if (typeof capturedValue !== 'string') return isoDate;

  const [, year, month, day] = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
  if (!year) return isoDate;

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(capturedValue)) {
    return `${Number(month)}/${Number(day)}/${year}`;
  }

  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(capturedValue)) {
    return `${Number(month)}-${Number(day)}-${year}`;
  }

  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(capturedValue)) {
    return `${year}/${Number(month)}/${Number(day)}`;
  }

  return isoDate;
}

function isFacilityAvailabilityUrl(url) {
  return /FacilityAvailability/i.test(url);
}

function requestMentionsFacility(request, facilityId) {
  if (!facilityId) return true;

  const url = request.url();
  if (url.includes(facilityId)) return true;

  const postData = request.postData() ?? '';
  return postData.includes(facilityId);
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function stripUnsafeRequestHeaders(headers) {
  const safe = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (sensitiveHeaderNames.has(lower)) continue;
    if (['host', 'connection', 'content-length', 'origin', 'referer'].includes(lower)) continue;
    if (lower.startsWith('sec-')) continue;
    safe[name] = value;
  }
  return safe;
}

function looksLikeLoginUrl(url) {
  return /\/login\b|\/account\/login\b|signin|sign-in/i.test(url);
}

async function isLoginPage(page) {
  if (looksLikeLoginUrl(page.url())) return true;

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

function getLandingPageBackUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/\/BookMe4LandingPages\/Facility/i.test(url.pathname)) return null;
    return url.searchParams.get('landingPageBackUrl');
  } catch {
    return null;
  }
}

async function pageHasTargetCourtFacilities(page) {
  const courts = await findCourtFacilities(page);
  return courts.length > 0;
}

async function navigateToTennisFacilityList(page, bookingUrl) {
  await page.goto(bookingUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  if (await pageHasTargetCourtFacilities(page)) return page.url();

  const landingPageBackUrl = getLandingPageBackUrl(page.url()) ?? getLandingPageBackUrl(bookingUrl);
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

async function getVerificationToken(page) {
  return page.evaluate(() => {
    const input = document.querySelector('input[name="__RequestVerificationToken"]');
    if (input?.value) return input.value;

    const meta = document.querySelector(
      'meta[name="__RequestVerificationToken"], meta[name="csrf-token"], meta[name="request-verification-token"]',
    );
    if (meta?.content) return meta.content;

    return null;
  });
}

function parseTennisCourtName(label) {
  const match = label.match(/\bTennis\s+(?:Synthetic\s+|Hard\s+)?Court\s+(\d+)\b/i);
  if (!match) return null;
  return `Court ${Number(match[1])}`;
}

function discoverTennisCourtsFromFacilities(facilities) {
  const byFacilityId = new Map();

  for (const facility of facilities) {
    if (!facility.facilityId || byFacilityId.has(facility.facilityId)) continue;

    const court = parseTennisCourtName(facility.label);
    if (!court) continue;

    byFacilityId.set(facility.facilityId, {
      court,
      domLabel: facility.label.match(/\bTennis\s+(?:Synthetic\s+|Hard\s+)?Court\s+\d+\b/i)?.[0] ?? court,
      facilityId: facility.facilityId,
    });
  }

  return [...byFacilityId.values()]
    .sort((a, b) => {
      const aNumber = Number(a.court.match(/\d+/)?.[0] ?? 0);
      const bNumber = Number(b.court.match(/\d+/)?.[0] ?? 0);
      return aNumber - bNumber || a.court.localeCompare(b.court);
    });
}

async function findCourtFacilities(page) {
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

  return discoverTennisCourtsFromFacilities(facilities);
}

async function chooseCourtToTriggerAvailability(page, court) {
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

  if (!clicked) return false;

  console.log(`No FacilityAvailability request observed yet; choosing ${court.domLabel} once to load its read-only availability grid.`);
  await page.waitForLoadState('networkidle').catch(() => {});
  return true;
}

function parseBody(body, contentType) {
  if (!body) return { kind: 'empty', value: null };

  if (/json/i.test(contentType)) {
    return { kind: 'json', value: JSON.parse(body) };
  }

  if (/x-www-form-urlencoded/i.test(contentType) || body.includes('=')) {
    return { kind: 'form', value: new URLSearchParams(body) };
  }

  return { kind: 'raw', value: body };
}

function setCaseInsensitive(target, wantedName, value) {
  if (target instanceof URLSearchParams) {
    const existing = [...target.keys()].find((key) => key.toLowerCase() === wantedName.toLowerCase());
    target.set(existing ?? wantedName, String(value));
    return true;
  }

  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const existing = Object.keys(target).find((key) => key.toLowerCase() === wantedName.toLowerCase());
    target[existing ?? wantedName] = value;
    return true;
  }

  return false;
}

function setCaseInsensitiveDeep(target, wantedName, value) {
  if (!target || typeof target !== 'object') return false;

  if (Array.isArray(target)) {
    return target
      .map((item) => setCaseInsensitiveDeep(item, wantedName, value))
      .some(Boolean);
  }

  let changed = false;
  for (const key of Object.keys(target)) {
    if (key.toLowerCase() === wantedName.toLowerCase()) {
      target[key] = value;
      changed = true;
    } else if (target[key] && typeof target[key] === 'object') {
      changed = setCaseInsensitiveDeep(target[key], wantedName, value) || changed;
    }
  }

  return changed;
}

function getCaseInsensitive(target, wantedName) {
  if (target instanceof URLSearchParams) {
    const existing = [...target.keys()].find((key) => key.toLowerCase() === wantedName.toLowerCase());
    return existing ? target.get(existing) : undefined;
  }

  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const existing = Object.keys(target).find((key) => key.toLowerCase() === wantedName.toLowerCase());
    return existing ? target[existing] : undefined;
  }

  return undefined;
}

function getCaseInsensitiveDeep(target, wantedName) {
  if (!target || typeof target !== 'object') return undefined;

  if (Array.isArray(target)) {
    for (const item of target) {
      const found = getCaseInsensitiveDeep(item, wantedName);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const direct = getCaseInsensitive(target, wantedName);
  if (direct !== undefined) return direct;

  for (const child of Object.values(target)) {
    const found = getCaseInsensitiveDeep(child, wantedName);
    if (found !== undefined) return found;
  }

  return undefined;
}

function prepareUrl(capturedUrl, { facilityId, date, daysCount, durationMinutes }) {
  const url = new URL(capturedUrl);
  const capturedDate = getCaseInsensitive(url.searchParams, 'date');
  const formattedDate = formatDateLikeCaptured(date, capturedDate);

  setCaseInsensitive(url.searchParams, 'facilityId', facilityId);
  setCaseInsensitive(url.searchParams, 'date', formattedDate);
  setCaseInsensitive(url.searchParams, 'daysCount', daysCount);
  setCaseInsensitive(url.searchParams, 'duration', durationMinutes);

  return url.toString();
}

function prepareBody(captured, { facilityId, date, token, daysCount, durationMinutes }) {
  const contentType = captured.headers['content-type'] ?? captured.headers['Content-Type'] ?? '';
  const parsed = parseBody(captured.postData ?? '', contentType);

  if (parsed.kind === 'empty') return undefined;
  if (parsed.kind === 'raw') {
    throw new Error('Captured FacilityAvailability request body is neither JSON nor form-urlencoded; refusing to guess.');
  }

  const body = parsed.value;
  const capturedDate = getCaseInsensitiveDeep(body, 'date');
  const formattedDate = formatDateLikeCaptured(date, capturedDate);

  if (!setCaseInsensitiveDeep(body, 'facilityId', facilityId)) {
    setCaseInsensitive(body, 'facilityId', facilityId);
  }
  if (!setCaseInsensitiveDeep(body, 'date', formattedDate)) {
    setCaseInsensitive(body, 'date', formattedDate);
  }
  if (!setCaseInsensitiveDeep(body, 'daysCount', daysCount)) {
    setCaseInsensitive(body, 'daysCount', daysCount);
  }
  if (!setCaseInsensitiveDeep(body, 'duration', durationMinutes)) {
    setCaseInsensitive(body, 'duration', durationMinutes);
  }

  if (token) {
    if (!setCaseInsensitiveDeep(body, '__RequestVerificationToken', token)) {
      setCaseInsensitive(body, '__RequestVerificationToken', token);
    }
  }

  if (parsed.kind === 'json') return JSON.stringify(body);
  return body.toString();
}

function prepareHeaders(captured, token) {
  const headers = stripUnsafeRequestHeaders(captured.headers);
  if (token) {
    const existingTokenHeader = Object.keys(captured.headers)
      .find((name) => name.toLowerCase() === '__requestverificationtoken'
        || name.toLowerCase() === 'requestverificationtoken'
        || name.toLowerCase() === 'x-csrf-token'
        || name.toLowerCase() === 'x-xsrf-token');
    if (existingTokenHeader) {
      headers[existingTokenHeader] = token;
    }
  }
  return headers;
}

function collectArraysByKey(value, keyName, out = []) {
  if (!value || typeof value !== 'object') return out;

  if (Array.isArray(value)) {
    for (const item of value) collectArraysByKey(item, keyName, out);
    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key.toLowerCase() === keyName.toLowerCase() && Array.isArray(child)) {
      out.push(child);
    }
    collectArraysByKey(child, keyName, out);
  }

  return out;
}

function firstValue(object, names) {
  if (!object || typeof object !== 'object') return undefined;
  const lowerNames = names.map((name) => name.toLowerCase());
  const key = Object.keys(object).find((candidate) => lowerNames.includes(candidate.toLowerCase()));
  return key ? object[key] : undefined;
}

function parseSpotDateTime(spot, fallbackDate) {
  const dateValue = firstValue(spot, ['date', 'startDate', 'StartDate', 'bookingDate', 'BookingDate']);
  const timeValue = firstValue(spot, ['start_time', 'startTime', 'StartTime', 'time', 'Time']);
  const dateTimeValue = firstValue(spot, [
    'startDateTime',
    'StartDateTime',
    'start',
    'Start',
    'from',
    'From',
    'availableStartTime',
    'AvailableStartTime',
  ]);

  if (typeof dateTimeValue === 'string') {
    const dotNetMatch = dateTimeValue.match(/\/Date\((\d+)/);
    if (dotNetMatch) {
      const date = new Date(Number(dotNetMatch[1]));
      if (!Number.isNaN(date.valueOf())) {
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Australia/Sydney',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        });
        const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
        return {
          date: `${parts.year}-${parts.month}-${parts.day}`,
          time: `${parts.hour}:${parts.minute}`,
        };
      }
    }

    const isoMatch = dateTimeValue.match(/(\d{4}-\d{2}-\d{2}).*?(\d{1,2}:\d{2})/);
    if (isoMatch) return { date: isoMatch[1], time: isoMatch[2].padStart(5, '0') };

    const auMatch = dateTimeValue.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}).*?(\d{1,2}:\d{2})/);
    if (auMatch) {
      return {
        date: `${auMatch[3]}-${auMatch[2].padStart(2, '0')}-${auMatch[1].padStart(2, '0')}`,
        time: auMatch[4].padStart(5, '0'),
      };
    }
  }

  if (timeValue && typeof timeValue === 'object') {
    const hours = firstValue(timeValue, ['hours', 'Hours']);
    const minutes = firstValue(timeValue, ['minutes', 'Minutes']);

    if (Number.isInteger(hours) && Number.isInteger(minutes) && fallbackDate) {
      return {
        date: fallbackDate,
        time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      };
    }
  }

  if (typeof timeValue === 'string') {
    const timeMatch = timeValue.match(/(\d{1,2}:\d{2})/);
    if (timeMatch) {
      const rawDate = typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)
        ? dateValue.slice(0, 10)
        : fallbackDate;
      return { date: rawDate, time: timeMatch[1].padStart(5, '0') };
    }
  }

  return null;
}

function parseDateOnly(value) {
  if (typeof value !== 'string') return null;

  const dotNetMatch = value.match(/\/Date\((\d+)/);
  if (dotNetMatch) {
    const date = new Date(Number(dotNetMatch[1]));
    if (!Number.isNaN(date.valueOf())) {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Sydney',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    }
  }

  const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  const auMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (auMatch) {
    return `${auMatch[3]}-${auMatch[2].padStart(2, '0')}-${auMatch[1].padStart(2, '0')}`;
  }

  return null;
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
        arrays.push(JSON.parse(text.slice(start, end)));
      } catch {
        // Ignore malformed embedded data; another Prices array may still be usable.
      }
    }

    index = start + 1;
  }

  return arrays.filter((array) => Array.isArray(array) && array.length > 0);
}

function normalizeRateTableFromPriceArrays(priceArrays) {
  if (!Array.isArray(priceArrays)) return [];

  const rates = [];
  for (const [arrayIndex, priceArray] of priceArrays.entries()) {
    if (!Array.isArray(priceArray)) continue;
    const durationMinutes = 60 + arrayIndex * 15;

    for (const price of priceArray) {
      if (!price || typeof price !== 'object') continue;
      if (typeof price.Name !== 'string' || typeof price.Amount !== 'number') continue;

      rates.push({
        name: price.Name,
        amount: price.Amount,
        currency: 'AUD',
        durationMinutes,
      });
    }
  }

  const seen = new Set();
  return rates.filter((rate) => {
    const key = `${rate.name}|${rate.amount}|${rate.currency}|${rate.durationMinutes}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractRateTableFromHtml(html) {
  return normalizeRateTableFromPriceArrays(extractSerializedPriceArrays(html));
}

async function extractCurrentCourtRateTable(page) {
  return extractRateTableFromHtml(await page.content());
}

function normalizeAvailability(responseJson, court, { durationMinutes }) {
  const rows = [];

  const availabilities = firstValue(responseJson, ['availabilities', 'Availabilities']);
  if (Array.isArray(availabilities)) {
    for (const availability of availabilities) {
      const fallbackDate = parseDateOnly(firstValue(availability, ['date', 'Date']));
      const bookingGroups = firstValue(availability, ['bookingGroups', 'BookingGroups']) ?? [];
      if (!Array.isArray(bookingGroups)) continue;

      for (const group of bookingGroups) {
        const spots = firstValue(group, ['availableSpots', 'AvailableSpots']) ?? [];
        if (!Array.isArray(spots)) continue;

        for (const spot of spots) {
          const parsed = parseSpotDateTime(spot, fallbackDate);
          if (parsed) {
            rows.push({
              court,
              date: parsed.date,
              start_time: parsed.time,
              duration_minutes: durationMinutes,
            });
          }
        }
      }
    }
  }

  const availableSpotArrays = collectArraysByKey(responseJson, 'AvailableSpots');
  const bookingGroupArrays = collectArraysByKey(responseJson, 'BookingGroups');

  for (const spots of availableSpotArrays) {
    for (const spot of spots) {
      const parsed = parseSpotDateTime(spot);
      if (parsed) {
        rows.push({
          court,
          date: parsed.date,
          start_time: parsed.time,
          duration_minutes: durationMinutes,
        });
      }
    }
  }

  for (const groups of bookingGroupArrays) {
    for (const group of groups) {
      const fallbackDate = parseDateOnly(firstValue(group, ['date', 'Date', 'bookingDate', 'BookingDate']));
      const spots = firstValue(group, ['AvailableSpots']) ?? [];
      if (!Array.isArray(spots)) continue;

      for (const spot of spots) {
        const parsed = parseSpotDateTime(spot, fallbackDate);
        if (parsed) {
          rows.push({
            court,
            date: parsed.date,
            start_time: parsed.time,
            duration_minutes: durationMinutes,
          });
        }
      }
    }
  }

  const seen = new Set();
  return rows
    .filter((row) => {
      const key = `${row.court}|${row.date}|${row.start_time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => `${a.date} ${a.start_time} ${a.court}`.localeCompare(`${b.date} ${b.start_time} ${b.court}`));
}

function addMinutesToTime(time, minutesToAdd) {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;

  const total = Number(match[1]) * 60 + Number(match[2]) + minutesToAdd;
  if (total >= 24 * 60) return null;

  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function buildRankedCandidates(rows, { durationMinutes }) {
  const availableKeys = new Set(rows.map((row) => `${row.court}|${row.date}|${row.start_time}`));

  return rows
    .map((row) => {
      const nextHour = addMinutesToTime(row.start_time, durationMinutes);
      return {
        court: row.court,
        facilityId: row.facilityId,
        date: row.date,
        start_time: row.start_time,
        duration_minutes: row.duration_minutes,
        next_hour_start_time: nextHour,
        next_hour_also_available: Boolean(nextHour && availableKeys.has(`${row.court}|${row.date}|${nextHour}`)),
        price_options: row.price_options ?? [],
      };
    })
    .sort((a, b) => {
      if (a.next_hour_also_available !== b.next_hour_also_available) {
        return a.next_hour_also_available ? -1 : 1;
      }
      return `${a.date} ${a.start_time} ${a.court}`.localeCompare(`${b.date} ${b.start_time} ${b.court}`);
    });
}

function createAvailabilityCapture(page, facilityId = null, { captureTimeoutMs }) {
  let captured = null;
  let stopped = false;

  const onRequest = (request) => {
    if (!isFacilityAvailabilityUrl(request.url()) || captured) return;
    if (!requestMentionsFacility(request, facilityId)) return;

    captured = {
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      postData: request.postData(),
    };
    console.log('Captured a real FacilityAvailability request shape from the logged-in page.');
  };

  page.on('request', onRequest);

  return {
    async wait({ onNeedTrigger, initialDelayMs = 5_000 } = {}) {
      await sleep(initialDelayMs);
      if (captured || stopped) return captured;

      if (onNeedTrigger) {
        await onNeedTrigger();
        await sleep(5_000);
        if (captured || stopped) return captured;
      }

      console.log('');
      console.log('No FacilityAvailability request has been observed yet.');
      console.log('In the browser, click or change the booking UI once so the page loads availability. This script is only listening.');

      const startedAt = Date.now();
      while (!captured && !stopped && Date.now() - startedAt < captureTimeoutMs) {
        await sleep(500);
      }

      return captured;
    },

    stop() {
      stopped = true;
      page.off('request', onRequest);
    },
  };
}

function toPublicAvailability(row) {
  return {
    venue: 'SUSF',
    court: row.court,
    facilityId: row.facilityId,
    startTime: `${row.date}T${row.start_time}:00`,
    durationMinutes: row.duration_minutes,
    nextHourAlsoAvailable: row.next_hour_also_available,
    priceOptions: row.price_options,
  };
}

async function readSusfAvailability({
  bookingUrl = process.env.SUSF_BOOKING_URL ?? DEFAULT_BOOKING_URL,
  storageStatePath = DEFAULT_STORAGE_STATE_PATH,
  days = 7,
  durationMinutes = 60,
  captureTimeoutMs = Number(process.env.CAPTURE_TIMEOUT_MS ?? DEFAULT_CAPTURE_TIMEOUT_MS),
  headless = process.env.HEADLESS === '1',
} = {}) {
  const normalizedBookingUrl = normalizeConfiguredUrl(bookingUrl);

  try {
    await readFile(storageStatePath, 'utf8');
  } catch {
    throw new SusfAvailabilityError('SESSION_EXPIRED', `Missing ${storageStatePath}. Run npm run susf:login first.`);
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState: storageStatePath });
  const page = await context.newPage();

  try {
    const facilityListUrl = await navigateToTennisFacilityList(page, normalizedBookingUrl);

    if (await isLoginPage(page)) {
      throw new SusfAvailabilityError('SESSION_EXPIRED');
    }

    const courts = await findCourtFacilities(page);

    if (courts.length === 0) {
      throw new Error('Could not find any Tennis court data-facilityid values.');
    }

    const date = todayIsoDate();
    const rows = [];

    for (const court of courts) {
      await page.goto(facilityListUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});

      if (await isLoginPage(page)) {
        throw new SusfAvailabilityError('SESSION_EXPIRED');
      }

      const token = await getVerificationToken(page);
      const availabilityCapture = createAvailabilityCapture(page, court.facilityId, { captureTimeoutMs });
      const captured = await availabilityCapture.wait({
        initialDelayMs: 0,
        onNeedTrigger: () => chooseCourtToTriggerAvailability(page, court),
      });
      availabilityCapture.stop();
      const priceOptions = (await extractCurrentCourtRateTable(page))
        .filter((rate) => rate.durationMinutes === durationMinutes);

      if (!captured) {
        throw new Error(`Timed out after ${captureTimeoutMs}ms waiting for ${court.domLabel} FacilityAvailability request.`);
      }

      const requestOptions = {
        facilityId: court.facilityId,
        date,
        token,
        daysCount: days,
        durationMinutes,
      };
      const url = prepareUrl(captured.url, requestOptions);
      const headers = prepareHeaders(captured, token);
      const body = prepareBody(captured, requestOptions);

      const responseJson = await page.evaluate(async ({ url, method, headers, body }) => {
        const response = await fetch(url, {
          method,
          headers,
          body,
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`FacilityAvailability returned HTTP ${response.status}`);
        }

        return response.json();
      }, {
        url,
        method: captured.method,
        headers,
        body,
      });

      rows.push(...normalizeAvailability(responseJson, court.court, { durationMinutes })
        .map((row) => ({
          ...row,
          facilityId: court.facilityId,
          price_options: priceOptions,
        })));
    }

    rows.sort((a, b) => `${a.date} ${a.start_time} ${a.court}`.localeCompare(`${b.date} ${b.start_time} ${b.court}`));
    const rankedCandidates = buildRankedCandidates(rows, { durationMinutes });

    return rankedCandidates.map(toPublicAvailability);
  } finally {
    await browser.close();
  }
}

async function getSusfAvailability(options = {}) {
  try {
    const availability = await readSusfAvailability(options);
    if (availability.length === 0) {
      throw new SusfAvailabilityError('NO_AVAILABILITY');
    }
    return availability;
  } catch (error) {
    if (error instanceof SusfAvailabilityError) throw error;
    throw new SusfAvailabilityError('SUSF_ADAPTER_ERROR', error.message, { cause: error });
  }
}

export {
  DEFAULT_BOOKING_URL,
  DEFAULT_CAPTURE_TIMEOUT_MS,
  DEFAULT_STORAGE_STATE_PATH,
  SusfAvailabilityError,
  buildRankedCandidates,
  discoverTennisCourtsFromFacilities,
  extractRateTableFromHtml,
  extractSerializedPriceArrays,
  findCourtFacilities,
  getSusfAvailability,
  normalizeRateTableFromPriceArrays,
  normalizeAvailability,
  readSusfAvailability,
};
