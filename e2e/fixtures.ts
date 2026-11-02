import { test as base } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const LIVE_DIR = path.resolve(__dirname, 'ui-results', 'live');

/**
 * With LIVE_VIEW=1 (set by scripts/e2e-runner.mjs), streams each test's browser into
 * ui-results/live/frame.jpg and names the running test in test.json, for the checklist UI's live view.
 */
export const test = base.extend<{ liveView: void }>({
  liveView: [
    async ({ page }, use, testInfo) => {
      if (process.env['LIVE_VIEW'] !== '1') return use();
      fs.mkdirSync(LIVE_DIR, { recursive: true });
      fs.writeFileSync(path.join(LIVE_DIR, 'test.json'), JSON.stringify({ title: testInfo.title }));

      const cdp = await page.context().newCDPSession(page);
      cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
        // Write then rename, so the UI never reads a half-written image.
        const tmp = path.join(LIVE_DIR, 'frame.tmp');
        fs.writeFileSync(tmp, Buffer.from(data, 'base64'));
        fs.renameSync(tmp, path.join(LIVE_DIR, 'frame.jpg'));
        cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: 1280,
        maxHeight: 800,
      });
      await use();
      await cdp.send('Page.stopScreencast').catch(() => {});
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
