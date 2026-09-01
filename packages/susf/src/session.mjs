import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_LOGIN_URL = 'https://susf.perfectmind.com/';
const DEFAULT_STORAGE_STATE_PATH = resolve('.auth/storageState.json');

async function saveSusfStorageState({
  loginUrl = process.env.SUSF_LOGIN_URL ?? DEFAULT_LOGIN_URL,
  storageStatePath = DEFAULT_STORAGE_STATE_PATH,
} = {}) {
  await mkdir(dirname(storageStatePath), { recursive: true });

  console.log('Opening Chromium in headed mode.');
  console.log('No username or password will be read, stored, or printed by this script.');
  console.log(`Login URL: ${loginUrl}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

  console.log('');
  console.log('Please complete the SUSF / PerfectMind login manually in the browser.');
  console.log('After the booking page is loaded and you can see your logged-in session, return here and press Enter.');

  const rl = createInterface({ input, output });
  await rl.question('Press Enter after login succeeds: ');
  rl.close();

  await context.storageState({ path: storageStatePath });

  console.log('');
  console.log(`Saved Playwright storageState to ${storageStatePath}`);
  console.log('You can close the browser now.');

  await browser.close();
}

export {
  DEFAULT_LOGIN_URL,
  DEFAULT_STORAGE_STATE_PATH,
  saveSusfStorageState,
};
