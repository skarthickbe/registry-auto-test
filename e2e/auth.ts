import fs from 'node:fs';
import path from 'node:path';

/** Session saved by auth.setup.ts for pages behind sign-in. */
export const AUTH_STATE = path.resolve(__dirname, '.auth', 'staff.json');
/** Whether that sign-in worked, and why not. */
export const AUTH_STATUS = path.resolve(__dirname, '.auth', 'status.json');

export type AuthStatus = { ok: true } | { ok: false; reason: string };

export function readAuthStatus(): AuthStatus {
  try {
    return JSON.parse(fs.readFileSync(AUTH_STATUS, 'utf8')) as AuthStatus;
  } catch {
    return { ok: false, reason: 'the sign-in setup did not run.' };
  }
}
