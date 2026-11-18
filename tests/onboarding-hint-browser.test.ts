import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';

const origin = process.env.HINT_TEST_ORIGIN ?? 'http://127.0.0.1:5191';

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
  if (process.env.HINT_TEST_ORIGIN) return undefined;
  return spawn(
    process.execPath,
    [
      join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5191',
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

async function waitForHanTopic(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector('#topic-head .lt-topic-name')?.textContent === '汉代');
}

async function measureHint(page: Page): Promise<{
  text: string;
  fontSize: number;
  color: string;
  backgroundColor: string;
  overlapsZoom: boolean;
  insideViewport: boolean;
  insideStatusbar: boolean;
  display: string;
}> {
  return page.evaluate(() => {
    const hint = document.querySelector<HTMLElement>('#hint');
    const statusbar = document.querySelector<HTMLElement>('.lt-timeline-statusbar');
    const zoom = document.querySelector<HTMLElement>('.lt-zoom');
    if (!hint || !statusbar || !zoom) throw new Error('缺少 #hint、状态栏或缩放控件');

    const style = getComputedStyle(hint);
    const hintRect = hint.getBoundingClientRect();
    const barRect = statusbar.getBoundingClientRect();
    const zoomRect = zoom.getBoundingClientRect();

    return {
      text: hint.innerText,
      fontSize: Number.parseFloat(style.fontSize),
      color: style.color,
      backgroundColor: getComputedStyle(statusbar).backgroundColor,
      overlapsZoom: !(
        hintRect.right <= zoomRect.left ||
        hintRect.left >= zoomRect.right ||
        hintRect.bottom <= zoomRect.top ||
        hintRect.top >= zoomRect.bottom
      ),
      insideViewport:
        hintRect.width > 0 &&
        hintRect.height > 0 &&
        hintRect.left >= 0 &&
        hintRect.top >= 0 &&
        hintRect.right <= window.innerWidth &&
        hintRect.bottom <= window.innerHeight,
      insideStatusbar:
        hintRect.left >= barRect.left - 1 &&
        hintRect.right <= barRect.right + 1 &&
        hintRect.top >= barRect.top - 1 &&
        hintRect.bottom <= barRect.bottom + 1,
      display: style.display,
    };
  });
}

function luminance(color: string): number {
  const match = color.match(/\d+(?:\.\d+)?/g);
  if (!match || match.length < 3) throw new Error(`无法解析颜色：${color}`);
  const [r, g, b] = match.slice(0, 3).map((value) => {
    const channel = Number(value) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('首屏状态栏手势提示在 1440 与 1280 视口内可见', { timeout: 120_000 }, async (context) => {
  const server = devServer();
  let browser: Browser | undefined;
  context.after(async () => {
    await browser?.close();
    server?.kill('SIGTERM');
  });
  await waitForServer();
  browser = await chromium.launch(launchOptions());

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
  ]) {
    // browser.newPage 为每个视口建立独立上下文，localStorage 从空白开始。
    const page = await browser.newPage({ viewport });
    const pageErrors: string[] = [];
    const thirdPartyScriptRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      if (request.resourceType() !== 'script') return;
      const url = new URL(request.url());
      if (url.origin !== new URL(origin).origin) thirdPartyScriptRequests.push(request.url());
    });
    await page.addInitScript(() => window.localStorage.clear());

    await page.goto(`${origin}/timeline`);
    await waitForHanTopic(page);

    const hint = page.locator('#hint');
    await hint.waitFor({ state: 'visible', timeout: 5_000 });
    const metrics = await measureHint(page);

    assert.notEqual(metrics.display, 'none', `${viewport.width}：提示不得隐藏`);
    assert.equal(metrics.insideViewport, true, `${viewport.width}：提示矩形必须完整位于视口内`);
    assert.equal(metrics.insideStatusbar, true, `${viewport.width}：提示不得被状态栏裁切`);
    assert.equal(metrics.overlapsZoom, false, `${viewport.width}：提示不得与缩放控件重叠`);
    assert.ok(metrics.fontSize >= 13, `${viewport.width}：提示字号 ${metrics.fontSize}px 过小`);
    const contrast = contrastRatio(metrics.color, metrics.backgroundColor);
    assert.ok(contrast >= 4.5, `${viewport.width}：提示对比度 ${contrast.toFixed(2)}:1 不足`);

    const text = metrics.text.replace(/\s+/g, '');
    assert.ok(text.includes('缩放'), `${viewport.width}：提示应说明缩放`);
    assert.ok(text.includes('平移'), `${viewport.width}：提示应说明平移`);
    assert.ok(text.includes('点击'), `${viewport.width}：提示应说明点击人物或事件`);

    assert.equal(
      await page.locator('#topic-head .lt-topic-name').innerText(),
      '汉代',
      `${viewport.width}：无历史记录时首屏应落在汉`,
    );

    const externalScripts = await page.evaluate(() =>
      Array.from(document.scripts)
        .map((script) => script.src)
        .filter((src) => src && new URL(src, location.href).origin !== location.origin),
    );
    assert.deepEqual(externalScripts, [], `${viewport.width}：不得新增第三方脚本`);
    assert.deepEqual(thirdPartyScriptRequests, [], `${viewport.width}：不得请求第三方脚本`);
    assert.deepEqual(pageErrors, [], `${viewport.width}：页面不应有未捕获错误`);

    await page.close();
  }
});
