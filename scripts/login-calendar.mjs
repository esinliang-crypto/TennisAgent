import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  buildGoogleAuthUrl,
  exchangeCodeForToken,
  googleOAuthConfigFromEnv,
  loadEnvFile,
  saveCalendarToken,
} from '../packages/calendar/src/index.mjs';

await loadEnvFile();
const config = googleOAuthConfigFromEnv();
const redirectUrl = new URL(config.redirectUri);
const expectedState = randomBytes(16).toString('hex');
const authUrl = buildGoogleAuthUrl({
  clientId: config.clientId,
  redirectUri: config.redirectUri,
  state: expectedState,
});

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, config.redirectUri);
  if (requestUrl.pathname !== redirectUrl.pathname) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  if (!code || state !== expectedState) {
    response.writeHead(400);
    response.end('Invalid OAuth callback.');
    return;
  }

  try {
    const token = await exchangeCodeForToken({ code, config });
    const path = await saveCalendarToken(token);
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('Calendar authorization complete. You can close this browser tab.');
    console.log(`Google Calendar OAuth token saved to ${path}.`);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain' });
    response.end('Calendar authorization failed.');
    console.error(error.code ?? error.message);
  } finally {
    server.close();
  }
});

await new Promise((resolve) => server.listen(Number(redirectUrl.port), redirectUrl.hostname, resolve));

console.log('Opening Google OAuth consent screen for fallback Calendar FreeBusy access.');
spawn('open', [authUrl], {
  detached: true,
  stdio: 'ignore',
}).unref();
