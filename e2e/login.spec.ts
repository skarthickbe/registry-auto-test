import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

// Test titles start with the checklist ids generated for "Other Routes › /sign-in", so results can be matched back.

// A made-up account: failed attempts must never lock a real user.
const FAKE_EMAIL = process.env['REGISTRY_FAKE_EMAIL'] ?? 'playwright.wrong-password@example.com';

// The page header has its own "Sign In" button; the form's is the one under test.
const SIGN_IN_TIMEOUT = 30_000;

const signInButton = (page: Page) => page.locator('form').getByRole('button', { name: 'Sign In' });

test.describe('Sign in page (AuthSignInComponent)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.locator('#email')).toBeVisible();
  });

  test('TC-001 Open the Sign in page', async ({ page }) => {
    await expect(page.locator('#password')).toBeVisible();
    await expect(signInButton(page)).toBeVisible();
  });

  test('TC-002 Email Address is required', async ({ page }) => {
    await page.locator('#email').click();
    await page.locator('#password').click();
    await expect(page.getByText('Email address is required')).toBeVisible();
  });

  test('TC-003 Email Address rejects invalid values (email)', async ({ page }) => {
    await page.locator('#email').fill('not-an-email');
    await page.locator('#password').click();
    await expect(page.getByText('Please enter a valid email address')).toBeVisible();
  });

  test('TC-004 Password is required', async ({ page }) => {
    await page.locator('#password').click();
    await page.locator('#email').click();
    await expect(page.getByText('New Password is required')).toBeVisible();
  });

  test('TC-005 Remember me: switch it on, then off', async ({ page }) => {
    const rememberMe = page.getByRole('checkbox', { name: 'Remember me' });
    await rememberMe.check();
    await expect(rememberMe).toBeChecked();
    await rememberMe.uncheck();
    await expect(rememberMe).not.toBeChecked();
  });

  test('TC-006 Click "Show / Hide"', async ({ page }) => {
    const password = page.locator('#password');
    await password.fill('secret');
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide' }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  test('TC-007 Click "Sign In"', async ({ page }) => {
    test
      .info()
      .annotations.push({ type: 'Scenario', description: 'Wrong password for a made-up account' });
    await page.locator('#email').fill(FAKE_EMAIL);
    await page.locator('#password').fill('Wrong-Password-123!');
    const started = Date.now();
    await signInButton(page).click();

    // The first sign-in after the backend starts can take well over the default 5 s.
    const alert = page.locator('fuse-alert');
    await expect(alert).toBeVisible({ timeout: SIGN_IN_TIMEOUT });
    const message = (await alert.innerText()).trim();
    test.info().annotations.push(
      { type: 'Error shown', description: message },
      {
        type: 'Sign-in response time',
        description: `${((Date.now() - started) / 1000).toFixed(1)} s`,
      },
    );
    // A wrong-credentials message, not a network error such as "Unknown Error" (backend down).
    expect(message).toMatch(/invalid|wrong|incorrect/i);
    await expect(page).toHaveURL(/\/sign-in/);
    // Evidence for the checklist, kept even when the test passes.
    await test.info().attach('wrong-password-error', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test('TC-008 "Sign In" is disabled until allowed', async ({ page }) => {
    test.info().annotations.push({
      type: 'Scenario',
      description: 'Disabled while signing in, enabled again after a wrong password',
    });
    await page.locator('#email').fill(FAKE_EMAIL);
    await page.locator('#password').fill('Wrong-Password-123!');
    const signIn = signInButton(page);
    await signIn.click();

    await expect(signIn).toBeDisabled();
    await expect(page.locator('fuse-alert')).toBeVisible({ timeout: SIGN_IN_TIMEOUT });
    await expect(signIn).toBeEnabled();
    await expect(page.locator('#email')).toBeEditable();
  });
});
