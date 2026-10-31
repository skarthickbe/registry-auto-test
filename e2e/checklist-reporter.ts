import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import fs from 'node:fs';
import path from 'node:path';

// Writes results where the checklist UI (served from public/) can read them.
const PUBLIC = path.resolve(__dirname, '..', 'public');
const OUT = path.join(PUBLIC, 'e2e-results.json');
const SHOTS = path.join(PUBLIC, 'e2e-shots');

interface E2eResult {
  /** From the describe title, e.g. "Sign in page (AuthSignInComponent)". */
  component?: string;
  /** Test title without its "TC-007 " prefix: matches the checklist case title. */
  title: string;
  status: TestResult['status'];
  duration: number;
  error?: string;
  notes: string[];
  /** Paths relative to public/. */
  screenshots: string[];
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

export default class ChecklistReporter implements Reporter {
  // Keyed by test id, so a retry replaces the earlier attempt.
  private readonly results = new Map<string, E2eResult>();

  onBegin(): void {
    fs.rmSync(SHOTS, { recursive: true, force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const component = /\((\w+)\)\s*$/.exec(test.parent.title)?.[1];
    const title = test.title.replace(/^TC-\d+\s+/, '');
    const screenshots: string[] = [];
    result.attachments.forEach((a, i) => {
      if (a.contentType !== 'image/png') return;
      const name = `${slug(`${component ?? 'page'}-${title}`)}-${i}.png`;
      if (a.path) fs.copyFileSync(a.path, path.join(SHOTS, name));
      else if (a.body) fs.writeFileSync(path.join(SHOTS, name), a.body);
      else return;
      screenshots.push(`e2e-shots/${name}`);
    });
    const annotations = [...test.annotations, ...(result.annotations ?? [])];
    this.results.set(test.id, {
      component,
      title,
      status: result.status,
      duration: result.duration,
      error: result.error?.message
        ? stripAnsi(result.error.message).split('\n').slice(0, 4).join('\n')
        : undefined,
      notes: [...new Set(annotations.map((a) => `${a.type}: ${a.description ?? ''}`))],
      screenshots,
    });
  }

  onEnd(result: FullResult): void {
    fs.writeFileSync(
      OUT,
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          status: result.status,
          results: [...this.results.values()],
        },
        null,
        2,
      ),
    );
  }
}
