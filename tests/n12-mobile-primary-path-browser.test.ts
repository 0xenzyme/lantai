import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type Browser, type Locator, type Page } from 'playwright';

const origin = process.env.N12_TEST_ORIGIN ?? 'http://127.0.0.1:5200';
const viewport = { width: 375, height: 667 };
const minTouch = 44;

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
  if (process.env.N12_TEST_ORIGIN) return undefined;
  return spawn(
    process.execPath,
    [
      join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5200',
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

async function touchBox(
  locator: Locator,
  label: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  assert.ok(box, `${label} 应有布局框`);
  assert.ok(box.width >= minTouch, `${label} 宽度应 ≥ ${minTouch}px，实际 ${box.width}`);
  assert.ok(box.height >= minTouch, `${label} 高度应 ≥ ${minTouch}px，实际 ${box.height}`);
  return box;
}

async function assertNoHorizontalOverflow(page: Page, stage: string): Promise<void> {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(widths.document <= widths.viewport, `${stage}：documentElement 不应横向溢出`);
  assert.ok(widths.body <= widths.viewport, `${stage}：body 不应横向溢出`);
}

test('N12 375×667 移动端主路径可用', { timeout: 120_000 }, async (context) => {
  const server = devServer();
  let browser: Browser | undefined;
  context.after(async () => {
    await browser?.close();
    server?.kill('SIGTERM');
  });
  await waitForServer();
  browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${origin}/timeline?topic=tang`);
  await waitForTopic(page, '唐', 'tang');
  await assertNoHorizontalOverflow(page, '初始视图');

  // 1. 打开筛选：按钮本身是触控目标，抽屉打开后搜索框获得焦点。
  await touchBox(page.locator('#btn-filter-toggle'), '筛选按钮');
  await page.locator('#btn-filter-toggle').click();
  await page.waitForFunction(() => document.querySelector('#lane-panel')?.classList.contains('open'));
  await page.waitForFunction(() => document.activeElement?.id === 'search');
  await touchBox(page.locator('#search'), '搜索框');
  await assertNoHorizontalOverflow(page, '筛选抽屉打开');

  // 2. 搜索人物并选中：结果项必须是可点的 44px 触控目标。
  await page.locator('#search').fill('李白');
  await page.waitForFunction(() => document.querySelectorAll('.search-hit').length > 0);
  const hit = page.locator('.search-hit').first();
  assert.match(await hit.innerText(), /李白/);
  await touchBox(hit, '搜索结果项');
  await hit.click();

  // 3. 详情卡出现，读到姓名，关闭按钮在视口内且可点。
  await page.waitForFunction(() => document.querySelector('#card')?.classList.contains('show'));
  assert.match(await page.locator('#card').innerText(), /李白/);
  const closeBox = await touchBox(page.locator('#card-close'), '详情卡关闭按钮');
  assert.ok(closeBox.x >= 0 && closeBox.y >= 0, '关闭按钮不应超出视口左上');
  assert.ok(
    closeBox.x + closeBox.width <= viewport.width && closeBox.y + closeBox.height <= viewport.height,
    '关闭按钮不应被视口或安全区裁掉',
  );
  await assertNoHorizontalOverflow(page, '详情卡打开');

  await page.locator('#card-close').click();
  await page.waitForFunction(() => !document.querySelector('#card')?.classList.contains('show'));
  assert.equal(await page.locator('#card').isVisible(), false, '关闭后详情卡不可见');

  // 底部朝代带仍是唯一专题入口，且在 375 宽上可点。
  assert.equal(await page.locator('#topic-select, #topic-prev, #topic-next').count(), 0);
  const visibleDynasty = await page.evaluate(() => {
    return [...document.querySelectorAll<HTMLElement>('#dynasty-track .lt-dynasty-item')]
      .map((item) => ({
        id: item.dataset.dynasty,
        rect: item.getBoundingClientRect(),
        visible: item.offsetParent !== null,
      }))
      .filter(
        ({ rect, visible }) =>
          visible && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight,
      )
      .map(({ id, rect }) => ({ id, width: rect.width, height: rect.height }))[0];
  });
  assert.ok(visibleDynasty, '应有一个位于视口内的朝代按钮');
  assert.ok(
    visibleDynasty.width >= minTouch && visibleDynasty.height >= minTouch,
    `朝代按钮 ${visibleDynasty.id ?? ''} 应为 ≥ ${minTouch}px 的触控目标，实际 ${visibleDynasty.width}×${visibleDynasty.height}`,
  );

  await page.locator('.lt-dynasty-item[data-dynasty="song"]').click();
  await waitForTopic(page, '宋', 'song');

  assert.deepEqual(pageErrors, []);
});
