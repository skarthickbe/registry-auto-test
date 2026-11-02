import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import type { FieldRef, TestCase } from '../src/app/registry/checklist-generator';
import { AUTH_STATE, readAuthStatus } from './auth';
import { expect, test } from './fixtures';

// Runs the checklist the UI generated (written to ui-results/plan.json by scripts/e2e-runner.mjs).
// Each case with `automation` becomes one test; the rest are checked by hand.

const PLAN = path.resolve(__dirname, 'ui-results', 'plan.json');
const SIGN_IN = '/sign-in';

const cases: TestCase[] = fs.existsSync(PLAN)
  ? (JSON.parse(fs.readFileSync(PLAN, 'utf8')).cases ?? [])
  : [];
const automated = cases.filter((c) => c.automation);

/** /staff/patient/details/:id/101 → /staff/patient/details/<REGISTRY_PATIENT_ID>/101 */
function resolvePath(route: string): string {
  const id = process.env['REGISTRY_PATIENT_ID'];
  return id ? route.replace(/:\w+/g, encodeURIComponent(id)) : route;
}

/** The control by formControlName, falling back to its label; skips the test when it is not on the page. */
async function findField(page: Page, field: FieldRef): Promise<Locator> {
  const control = page
    .locator(`[formcontrolname=${JSON.stringify(field.name)}]`)
    .or(page.getByLabel(field.label))
    .first();
  return visibleOrSkip(control, field.label);
}

async function visibleOrSkip(locator: Locator, label: string): Promise<Locator> {
  const visible = await locator.waitFor({ state: 'visible', timeout: 8000 }).then(
    () => true,
    () => false,
  );
  test.skip(
    !visible,
    `"${label}" is not visible on the page (it may need data or another state first).`,
  );
  return locator;
}

async function expectInvalid(page: Page, field: Locator, error?: string): Promise<void> {
  if (error) await expect(page.getByText(error).first()).toBeVisible();
  else await expect(field).toHaveClass(/ng-invalid/);
}

// Group by section, then component: the reporter reads the component from "(…)" in the describe title.
const groups = new Map<string, TestCase[]>();
for (const c of automated) {
  const key = `${c.section ?? 'Checklist'} (${c.component})`;
  groups.set(key, [...(groups.get(key) ?? []), c]);
}

for (const [title, group] of groups) {
  const behindSignIn = group.some((c) => c.automation!.page !== SIGN_IN);

  test.describe(title, () => {
    if (behindSignIn) test.use({ storageState: AUTH_STATE });

    for (const c of group) {
      const a = c.automation!;
      test(`${c.id} ${c.title}`, async ({ page }) => {
        if (a.page !== SIGN_IN) {
          // Read at test time: auth.setup.ts runs first and records whether sign-in worked.
          const auth = readAuthStatus();
          test.skip(!auth.ok, `Could not sign in with the test account: ${auth.ok || auth.reason}`);
        }
        const url = resolvePath(a.page);
        test.skip(url.includes(':'), 'Set REGISTRY_PATIENT_ID in e2e/.env for routes with :id.');

        await page.goto(url);
        if (a.page !== SIGN_IN) {
          await expect(page, 'The test account was sent back to sign-in').not.toHaveURL(
            /\/sign-in/,
          );
        }

        switch (a.kind) {
          case 'open':
            if (a.selector) {
              await expect(page.locator(a.selector).first()).toBeAttached({ timeout: 15_000 });
            }
            break;
          case 'required': {
            const field = await findField(page, a.field);
            await field.click();
            await field.fill('');
            await field.press('Tab');
            await expectInvalid(page, field, a.error);
            break;
          }
          case 'maxLength': {
            const field = await findField(page, a.field);
            await field.fill('');
            await field.focus();
            // Typed like a paste, so the browser applies maxlength as it would for a user.
            await page.keyboard.insertText('x'.repeat(a.max + 1));
            expect((await field.inputValue()).length).toBeLessThanOrEqual(a.max);
            break;
          }
          case 'invalidEmail': {
            const field = await findField(page, a.field);
            await field.fill('not-an-email');
            await field.press('Tab');
            await expectInvalid(page, field, a.error);
            break;
          }
          case 'toggle': {
            const box = await visibleOrSkip(
              page.getByRole('checkbox', { name: a.field.label }).first(),
              a.field.label,
            );
            await box.check();
            await expect(box).toBeChecked();
            await box.uncheck();
            await expect(box).not.toBeChecked();
            break;
          }
        }
      });
    }
  });
}
