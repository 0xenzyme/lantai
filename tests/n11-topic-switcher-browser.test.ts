import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';

const origin = process.env.N11_TEST_ORIGIN ?? 'http://127.0.0.1:5195';

function launchOptions(): { executablePath?: string; headless: boolean; args: string[] } {
  return {
    executablePath:
      process.env.CHROME_PATH ??
      (process.platform === 'darwin' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined),
    headless: true,
    args: ['--no-sandbox'],
  };
}

function devServer(): ChildProcess | undefined {
  if (process.env.N11_TEST_ORIGIN) return undefined;
  return spawn(
    process.execPath,
    [
      join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5195',
      '--strictPort',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Vite 开发服务器不可用：${origin}`);
}

async function waitForTopic(page: Page, title: string, topicId: string): Promise<void> {
  await page.waitForFunction(
    ({ expectedTitle, expectedTopic }) =>
      document.querySelector('#topic-head .lt-topic-name')?.textContent === expectedTitle &&
      new URL(location.href).searchParams.get('topic') === expectedTopic,
    { expectedTitle: title, expectedTopic: topicId },
  );
}

test('N11 朝代/专题只有一个可见切换入口', { timeout: 120_000 }, async (context) => {
  const server = devServer();
  let browser: Browser | undefined;
  context.after(async () => {
    await browser?.close();
    server?.kill('SIGTERM');
  });
  await waitForServer();
  browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${origin}/timeline?topic=han`);
  await waitForTopic(page, '汉代', 'han');

  // 旧的筛选栏下拉和标题两侧箭头必须从 DOM 中移除。
  assert.equal(await page.locator('#topic-select, #topic-prev, #topic-next').count(), 0);
  assert.equal(await page.locator('select:visible').count(), 0);
  assert.equal(await page.locator('#topic-head button, #topic-head a, #topic-head select').count(), 0);

  // 底部朝代带是唯一可见的专题切换入口，nav 有可访问名称。
  const band = page.getByRole('navigation', { name: '朝代导航' });
  assert.equal(await band.count(), 1);
  const dynastyItems = page.locator('#dynasty-track .lt-dynasty-item');
  assert.ok((await dynastyItems.count()) > 0, '朝代带应有按钮');
  assert.equal(
    await dynastyItems.evaluateAll((items) =>
      items.every((item) => {
        const rect = item.getBoundingClientRect();
        return (item as HTMLElement).offsetParent !== null && rect.width > 0 && rect.height > 0;
      }),
    ),
    true,
    '朝代带按钮应全部可见',
  );
  assert.equal(await page.locator('#ribbon-canvas').isVisible(), false, '隐藏的 canvas ribbon 不应作为入口显示');

  // 键盘可以从页面起点 Tab 到朝代按钮。
  await page.goto(`${origin}/timeline?topic=han`);
  await waitForTopic(page, '汉代', 'han');
  let reachedDynasty = false;
  for (let step = 0; step < 400; step += 1) {
    await page.keyboard.press('Tab');
    reachedDynasty = await page.evaluate(() => document.activeElement?.classList.contains('lt-dynasty-item') ?? false);
    if (reachedDynasty) break;
  }
  assert.equal(reachedDynasty, true, 'Tab 应能把焦点移到 .lt-dynasty-item');
  assert.ok(
    await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return Boolean(active?.dataset.dynasty);
    }),
    '聚焦的朝代按钮应带有 data-dynasty',
  );

  // 点击朝代按钮切换专题，标题和地址同步改变。
  await page.locator('.lt-dynasty-item[data-dynasty="tang"]').click();
  await waitForTopic(page, '唐', 'tang');
  assert.equal(await page.locator('#topic-head .lt-topic-name').innerText(), '唐');

  // 深链在切换过专题后仍按地址打开目标专题。
  await page.goto(`${origin}/timeline?topic=han`);
  await waitForTopic(page, '汉代', 'han');

  // 章节只改当前专题内的 view 和时间窗，不切朝代。
  await page.goto(`${origin}/timeline?topic=tang&view=overview`);
  await waitForTopic(page, '唐', 'tang');
  const chapter = page.locator('#lane-chapters [data-view="tianbao"]');
  await chapter.waitFor({ state: 'visible' });
  const before = new URL(page.url());
  await chapter.click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('view') === 'tianbao');
  const after = new URL(page.url());
  assert.equal(after.searchParams.get('topic'), 'tang', '点击章节不得切换专题');
  assert.equal(after.searchParams.get('view'), 'tianbao');
  assert.notEqual(after.searchParams.get('from'), before.searchParams.get('from'), '章节应改变时间窗起点');
  assert.notEqual(after.searchParams.get('to'), before.searchParams.get('to'), '章节应改变时间窗终点');
  assert.equal(await page.locator('#topic-head .lt-topic-name').innerText(), '唐');

  assert.deepEqual(pageErrors, []);
});
