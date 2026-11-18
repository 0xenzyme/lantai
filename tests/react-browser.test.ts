import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

test('React SPA 年表到内容页的皮肤与连续搜索导航', { timeout: 120_000 }, async (context) => {
  const origin = 'http://127.0.0.1:5198';
  const server = spawn(
    process.execPath,
    [
      join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5198',
      '--strictPort',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let browser: import('playwright').Browser | undefined;
  const errors: string[] = [];
  context.after(async () => {
    await browser?.close();
    server.kill('SIGTERM');
  });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      // Vite 启动期间继续等待。
    }
    if (Date.now() > deadline || server.exitCode !== null) throw new Error('Vite 启动失败');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ??
      (process.platform === 'darwin' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined),
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${origin}/timeline`);
  await page.waitForSelector('.timeline-app #chart');
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.id = 'react-test-timeline-link';
    link.href = '/timeline?topic=tang&from=700&to=760';
    link.dataset.timelineLink = '';
    link.textContent = '同年表导航测试';
    document.body.append(link);
  });
  await page.locator('#react-test-timeline-link').click();
  await page.waitForFunction(
    () =>
      new URLSearchParams(location.search).get('topic') === 'tang' &&
      document.querySelector('#topic-head .lt-topic-name')?.textContent === '唐',
  );
  assert.match(page.url(), /topic=tang/);
  await page.locator('#react-test-timeline-link').evaluate((link) => link.remove());
  await page.locator('.lt-main-nav a[href="/people"]').click();
  await page.waitForSelector('.lt-person-directory');
  const body = await page.evaluate(() => ({
    className: document.body.className,
    backgroundToken: getComputedStyle(document.body).getPropertyValue('--bg').trim(),
  }));
  assert.match(body.className, /skin-voyage/);
  assert.doesNotMatch(body.className, /timeline-app/);
  assert.ok(body.backgroundToken.length > 0);

  const globalQuery = page.locator('.lt-global-search input[name="q"]');
  await globalQuery.fill('孔子');
  await globalQuery.press('Enter');
  await page.waitForSelector('.lt-search-group');
  assert.equal(await page.locator('.lt-global-search input[name="q"]').inputValue(), '孔子');
  await page.locator('.lt-global-search input[name="q"]').fill('李白');
  await page.locator('.lt-global-search input[name="q"]').press('Enter');
  await page.waitForFunction(
    () => new URLSearchParams(location.search).get('q') === '李白' && document.querySelector('.lt-search-group'),
  );
  assert.equal(await page.locator('.lt-global-search input[name="q"]').inputValue(), '李白');
  assert.deepEqual(errors, []);
});
