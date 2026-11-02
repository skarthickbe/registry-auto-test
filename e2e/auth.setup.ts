import fs from 'node:fs';
import path from 'node:path';

import { AUTH_STATE, AUTH_STATUS, type AuthStatus } from './auth';
import { test as setup } from './fixtures';

// Signs in once with the test account from e2e/.env and saves the session for pages behind sign-in.
// It never fails: a failed setup would stop every test, including the sign-in page's own.
// The outcome goes to AUTH_STATUS, and tests behind sign-in skip themselves with the reason.

setup('Sign in with the test account', async ({ page }) => {
  fs.mkdirSync(path.dirname(AUTH_STATE), { recursive: true });
  const record = (status: AuthStatus) => {
    fs.writeFileSync(AUTH_STATUS, JSON.stringify(status));
    if (!status.ok) fs.writeFileSync(AUTH_STATE, JSON.stringify({ cookies: [], origins: [] }));
    setup.info().annotations.push({
      type: 'Test account',
      description: status.ok ? 'Signed in' : status.reason,
    });
  };

  const email = process.env['REGISTRY_EMAIL'];
  const password = process.env['REGISTRY_PASSWORD'];
  if (!email || !password) {
    record({ ok: false, reason: 'set REGISTRY_EMAIL and REGISTRY_PASSWORD in e2e/.env.' });
    return;
  }

  try {
    await page.goto('/sign-in');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('form').getByRole('button', { name: 'Sign In' }).click();

    // Either the app leaves the sign-in page, or it shows an error.
    const alert = page.locator('fuse-alert');
    // The losing wait times out later; catch it so it cannot surface as an unhandled rejection.
    const outcome = await Promise.race([
      page
        .waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30_000 })
        .then(
          () => 'in',
          () => 'timeout',
        ),
      alert.waitFor({ state: 'visible', timeout: 30_000 }).then(
        () => 'alert',
        () => 'timeout',
      ),
    ]);
    if (outcome === 'timeout') {
      record({ ok: false, reason: 'no answer from the app within 30 s.' });
      return;
    }
    if (outcome === 'alert') {
      record({ ok: false, reason: `the app said "${(await alert.innerText()).trim()}".` });
      return;
    }
    await page.context().storageState({ path: AUTH_STATE });
    record({ ok: true });
  } catch (e) {
    record({ ok: false, reason: (e as Error).message.split('\n')[0] });
  }
});
