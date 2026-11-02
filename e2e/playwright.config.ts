import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// Settings live in e2e/.env (not committed); see e2e/.env.example.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // No .env: fall back to the defaults below.
}

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  // Registry App tests share one backend; run them one at a time.
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: './report', open: 'never' }],
    ['json', { outputFile: './results.json' }],
    ['./checklist-reporter.ts'],
  ],
  use: {
    baseURL: process.env['REGISTRY_URL'] ?? 'http://localhost:4300',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { slowMo: Number(process.env['SLOW_MO'] ?? 0) },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
