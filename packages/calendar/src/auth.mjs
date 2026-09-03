import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const GOOGLE_CALENDAR_FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';
const DEFAULT_GOOGLE_CALENDAR_TOKEN_PATH = resolve('.auth/google-calendar.json');
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

class CalendarAuthError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = 'CalendarAuthError';
    this.code = code;
  }
}

async function loadEnvFile(path = resolve('.env')) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}

function googleOAuthConfigFromEnv() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? 'http://127.0.0.1:4107/oauth2callback';

  if (!clientId || !clientSecret) {
    throw new CalendarAuthError(
      'CALENDAR_OAUTH_NOT_CONFIGURED',
      'Missing GOOGLE_CALENDAR_CLIENT_ID or GOOGLE_CALENDAR_CLIENT_SECRET',
    );
  }

  return { clientId, clientSecret, redirectUri };
}

function buildGoogleAuthUrl({
  clientId,
  redirectUri,
  scope = GOOGLE_CALENDAR_FREEBUSY_SCOPE,
  state,
}) {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

async function readCalendarToken({ path = DEFAULT_GOOGLE_CALENDAR_TOKEN_PATH } = {}) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new CalendarAuthError('CALENDAR_AUTH_REQUIRED', `Missing ${path}. Run npm run calendar:login first.`);
    }
    throw error;
  }
}

async function saveCalendarToken(token, { path = DEFAULT_GOOGLE_CALENDAR_TOKEN_PATH } = {}) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
  return path;
}

async function exchangeCodeForToken({
  code,
  config,
  fetchImpl = globalThis.fetch,
}) {
  const response = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    throw new CalendarAuthError('CALENDAR_TOKEN_EXCHANGE_FAILED', `Google OAuth token exchange failed with HTTP ${response.status}`);
  }

  const token = await response.json();
  if (!token.refresh_token) {
    throw new CalendarAuthError('CALENDAR_REFRESH_TOKEN_MISSING', 'Google OAuth response did not include a refresh token');
  }

  return {
    refreshToken: token.refresh_token,
    scope: token.scope ?? GOOGLE_CALENDAR_FREEBUSY_SCOPE,
    tokenType: token.token_type ?? 'Bearer',
    obtainedAt: new Date().toISOString(),
  };
}

async function getCalendarAccessToken({
  tokenPath = DEFAULT_GOOGLE_CALENDAR_TOKEN_PATH,
  config,
  fetchImpl = globalThis.fetch,
} = {}) {
  await loadEnvFile();
  const selectedConfig = config ?? googleOAuthConfigFromEnv();
  const token = await readCalendarToken({ path: tokenPath });
  if (!token.refreshToken) {
    throw new CalendarAuthError('CALENDAR_AUTH_REQUIRED', `Missing refresh token in ${tokenPath}. Run npm run calendar:login first.`);
  }

  const response = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: selectedConfig.clientId,
      client_secret: selectedConfig.clientSecret,
      refresh_token: token.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new CalendarAuthError('CALENDAR_AUTH_REQUIRED', `Google OAuth refresh failed with HTTP ${response.status}`);
  }

  const json = await response.json();
  if (!json.access_token) {
    throw new CalendarAuthError('CALENDAR_AUTH_REQUIRED', 'Google OAuth refresh did not return an access token');
  }

  return json.access_token;
}

export {
  CalendarAuthError,
  DEFAULT_GOOGLE_CALENDAR_TOKEN_PATH,
  GOOGLE_CALENDAR_FREEBUSY_SCOPE,
  buildGoogleAuthUrl,
  exchangeCodeForToken,
  getCalendarAccessToken,
  googleOAuthConfigFromEnv,
  loadEnvFile,
  readCalendarToken,
  saveCalendarToken,
};
