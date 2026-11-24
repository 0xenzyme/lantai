import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';

const origin = process.env.N9_TEST_ORIGIN ?? 'http://127.0.0.1:5199';
const LIMIT_BYTES = 200 * 1024;
const FIRST_PACKAGE_FILES = [
  '/data/index.json',
  '/data/timeline-people.json',
  '/data/timeline-events.json',
  '/data/han.json',
];

interface DataResource {
  path: string;
  startTime: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
}

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

function previewServer(): ChildProcess | undefined {
  if (process.env.N9_TEST_ORIGIN) return undefined;
  return spawn(
    process.execPath,
    [
      join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '5199',
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
  throw new Error(`production preview 不可用：${origin}`);
}

async function dataResources(page: Page): Promise<DataResource[]> {
  return page.evaluate(() =>
    (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .map((entry) => ({ entry, path: new URL(entry.name).pathname }))
      .filter(({ path }) => path.startsWith('/data/') && path.endsWith('.json'))
      .map(({ entry, path }) => ({
        path,
        startTime: entry.startTime,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
      })),
  );
}

function gzipBytes(file: string): number {
  return execFileSync('gzip', ['-c', join(process.cwd(), 'dist', file)], { maxBuffer: 16 * 1024 * 1024 }).length;
}

test('N9 年表首包只加载瘦索引且 gzip 合计小于 200KB', { timeout: 120_000 }, async (context) => {
  assert.ok(
    existsSync(join(process.cwd(), 'dist', 'data', 'timeline-people.json')),
    '需要先运行 npm run build，本测试只对生产构建做体积断言',
  );
  const server = previewServer();
  let browser: Browser | undefined;
  context.after(async () => {
    await browser?.close();
    server?.kill('SIGTERM');
  });
  await waitForServer();
  browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${origin}/timeline`);
  await page.waitForSelector('body[data-timeline-ready="true"]', { state: 'attached' });
  const readyAt = Number(await page.locator('body').getAttribute('data-timeline-ready-at'));
  assert.ok(Number.isFinite(readyAt) && readyAt > 0, '年表必须标记首屏可交互时刻');

  const firstPackage = (await dataResources(page)).filter((resource) => resource.startTime <= readyAt);
  const paths = [...new Set(firstPackage.map((resource) => resource.path))].sort();
  assert.deepEqual(paths, [...FIRST_PACKAGE_FILES].sort(), '首屏只能请求目录、瘦索引和默认专题');
  assert.equal(
    firstPackage.some((resource) => /^(?:\/data\/)(?:people|military|history)\.json$/.test(resource.path)),
    false,
    '首屏不得请求完整事件线或 people.json',
  );

  // 默认人物线必须自己画出战事与历史事件，不能靠点击事件触发加载。
  await page.waitForTimeout(3000);
  const groupCount = (text: string): number => {
    const match = /[（(](\d+)[）)]/.exec(text);
    return match ? Number(match[1]) : Number.NaN;
  };
  const warCount = groupCount(await page.locator('[data-group-count="war"]').innerText());
  const historyCount = groupCount(await page.locator('[data-group-count="history"]').innerText());
  assert.ok(warCount > 0, `默认人物线的战事计数应大于 0，实际为 ${warCount}`);
  assert.ok(historyCount > 0, `默认人物线的历史事件计数应大于 0，实际为 ${historyCount}`);
  const afterReadyPaths = (await dataResources(page)).map((resource) => resource.path);
  assert.equal(
    afterReadyPaths.some((path) => /^\/data\/(?:military|history)\.json$/.test(path)),
    false,
    `人物线首屏画事件条不得请求完整事件线：${afterReadyPaths.join(', ')}`,
  );

  const gzipTotal = FIRST_PACKAGE_FILES.reduce((sum, path) => sum + gzipBytes(path), 0);
  const serverCompressed = await page.evaluate(async () => {
    const response = await fetch('/data/timeline-events.json', { cache: 'no-store' });
    return (response.headers.get('content-encoding') ?? '').toLowerCase();
  });
  const transferTotal = firstPackage.reduce(
    (sum, resource) => sum + (serverCompressed ? resource.encodedBodySize : resource.transferSize),
    0,
  );
  console.log(
    JSON.stringify(
      {
        layer: 'first-package-gzip',
        files: FIRST_PACKAGE_FILES.map((path) => ({ path, gzipBytes: gzipBytes(path) })),
        gzipTotal,
        serverCompressed: serverCompressed || 'none',
        transferTotal,
        limit: LIMIT_BYTES,
      },
      null,
      2,
    ),
  );
  assert.ok(
    serverCompressed === '' || transferTotal < LIMIT_BYTES,
    `浏览器传输体积 ${transferTotal} 字节应小于 ${LIMIT_BYTES} 字节（编码：${serverCompressed || 'none'}）`,
  );
  assert.ok(gzipTotal < LIMIT_BYTES, `首包 gzip 合计 ${gzipTotal} 字节应小于 ${LIMIT_BYTES} 字节`);

  await page.setViewportSize({ width: 1446, height: 993 });
  const tang = new URLSearchParams({
    topic: 'tang',
    view: 'overview',
    from: '572',
    to: '736',
    hide: 'lane:emperor,lane:kin,lane:consort,lane:chancellor,lane:general,lane:end',
    strip: '1',
  });
  await page.goto(`${origin}/timeline?${tang}`);
  await page.waitForSelector('body[data-timeline-ready="true"]', { state: 'attached' });
  // 在此视窗中，隋灭陈位于战事区第一行的 588—589 年处。行高会随布局微调，纵向试几个相邻位置。
  const tooltip = page.locator('#tooltip');
  let tip = '';
  for (const y of [346, 344, 348, 342, 350]) {
    await page.locator('#chart').hover({ position: { x: 120, y } });
    await page.waitForTimeout(300);
    if (!(await tooltip.isVisible())) continue;
    tip = (await tooltip.innerText()).trim();
    if (tip.startsWith('隋灭陈')) break;
  }
  assert.equal(tip, '隋灭陈　588 — 589');
  assert.ok(
    (await dataResources(page)).every(({ path }) => !/^\/data\/(?:military|history)\.json$/.test(path)),
    '悬浮提示不得请求完整事件线',
  );
  await page.close();
});

test('N9 年表深链、检索与事件线按需加载无 pageerror', { timeout: 120_000 }, async (context) => {
  const server = previewServer();
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

  await page.goto(`${origin}/timeline?topic=tang&person=li-bai`);
  await page.waitForSelector('.timeline-app #card.show');
  assert.match(await page.locator('#card-body').innerText(), /李白/);

  const search = page.locator('#search');
  await search.fill('李白');
  await page.waitForSelector('#search-results .search-hit');
  assert.match(await page.locator('#search-results').innerText(), /李白/);
  await page.locator('#search-results .search-hit').first().click();
  await page.waitForSelector('.timeline-app #card.show');

  await page.route('**/data/military.json', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.route('**/data/history.json', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });

  async function switchLine(line: 'military' | 'history'): Promise<void> {
    await page.evaluate((next) => {
      const url = new URL(location.href);
      url.searchParams.set('line', next);
      url.searchParams.delete('person');
      url.searchParams.delete('event');
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, line);
  }

  const militaryResponse = page.waitForResponse(
    (response) => response.url().endsWith('/data/military.json') && response.ok(),
  );
  await switchLine('military');
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('正在载入军事事件'));
  await militaryResponse;
  await page.waitForFunction(
    () => document.querySelectorAll('#timeline-entity-list button[data-kind="event"]').length > 0,
  );

  const historyResponse = page.waitForResponse(
    (response) => response.url().endsWith('/data/history.json') && response.ok(),
  );
  await switchLine('history');
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('正在载入历史事件'));
  await historyResponse;
  await page.waitForFunction(
    () => document.querySelectorAll('#timeline-entity-list button[data-kind="event"]').length > 0,
  );

  await page.waitForTimeout(200);
  assert.deepEqual(pageErrors, []);
  await page.close();
});

test('N9 首页不再请求 military.json 与 history.json', { timeout: 90_000 }, async (context) => {
  const server = previewServer();
  let browser: Browser | undefined;
  context.after(async () => {
    await browser?.close();
    server?.kill('SIGTERM');
  });
  await waitForServer();
  browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const requested: string[] = [];
  page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  await page.goto(`${origin}/`);
  await page.waitForSelector('#site-page[aria-busy="false"] main h1');
  assert.equal(
    requested.some((path) => path === '/data/military.json' || path === '/data/history.json'),
    false,
    `首页不应请求完整事件线：${requested.filter((path) => path.startsWith('/data/')).join(', ')}`,
  );
  await page.close();
});
