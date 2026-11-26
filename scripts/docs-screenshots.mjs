/**
 * 重拍 README 展示素材：截图与演示视频输出到 .github/assets/。
 *
 * 前端 UI 变化后运行 `npm run docs:screenshots` 重新生成全套素材，
 * 避免 README 截图随迭代过期。
 *
 * 用法：npm run docs:screenshots
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, '.github', 'assets');
const PORT = 5197;
const ORIGIN = `http://127.0.0.1:${PORT}`;

function startDevServer() {
  const server = spawn(
    process.execPath,
    [
      join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--strictPort',
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite 启动超时')), 30_000);
    const onData = (chunk) => {
      if (chunk.toString().includes('Local:')) {
        clearTimeout(timer);
        resolve(server);
      }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.once('exit', () => reject(new Error('vite 提前退出')));
  });
}

async function readyTimeline(page) {
  await page.waitForFunction(() => document.body.dataset.timelineReady === 'true');
  await page.waitForTimeout(900);
}

/**
 * 首次冷启动下偶发画布只画了底色就被清空（无坐标轴、无条目）。
 * 截图前读回位图验证内容，空白则整页重载，最多三次。
 */
async function ensureCanvasContent(page, label) {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const colors = await page.evaluate(() => {
      const canvas = document.getElementById('chart');
      if (!canvas || canvas.width === 0 || canvas.height === 0) return 0;
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4 * 89) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return seen.size;
    });
    if (colors >= 4) return;
    console.warn(`[${label}] 画布空白（${colors} 色），第 ${attempt}/${attempts} 次重载`);
    await page.reload();
    await readyTimeline(page);
  }
  throw new Error(`[${label}] 重载后画布仍为空白`);
}

mkdirSync(OUT, { recursive: true });
const server = await startDevServer();
const browser = await chromium.launch();
try {
  // 1. 代表性场景（README 首图）：「诗书与释道」章节 + 李白选中，
  //    人物、战事、历史事件三条泳道齐全，详情卡打开。
  const desktop = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const page = await desktop.newPage();
  await page.goto(`${ORIGIN}/timeline?topic=tang&view=wen&person=li-bai&from=650&to=830`);
  await readyTimeline(page);
  await ensureCanvasContent(page, 'timeline-tang');
  await page.screenshot({ path: join(OUT, 'timeline-tang.jpg'), type: 'jpeg', quality: 82 });
  await page.close();
  await desktop.close();

  // 1b. 社交分享卡（og:image / twitter:image）：og 常用 1200x630，单倍缩放控制体积。
  const og = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const ogPage = await og.newPage();
  await ogPage.goto(`${ORIGIN}/timeline?topic=tang&view=wen&person=li-bai&from=650&to=830`);
  await readyTimeline(ogPage);
  await ensureCanvasContent(ogPage, 'og-image');
  await ogPage.screenshot({ path: join(ROOT, 'public', 'images', 'history-timeline.jpg'), type: 'jpeg', quality: 85 });
  await ogPage.close();
  await og.close();

  // 2. 全景规模感：唐全览，数百人生平同轴。
  const detail = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const detailPage = await detail.newPage();
  await detailPage.goto(`${ORIGIN}/timeline?topic=tang&from=580&to=980`);
  await readyTimeline(detailPage);
  await ensureCanvasContent(detailPage, 'timeline-overview');
  await detailPage.screenshot({ path: join(OUT, 'timeline-overview.jpg'), type: 'jpeg', quality: 82 });
  await detailPage.close();
  await detail.close();

  // 3. 移动端：375 宽主路径。
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${ORIGIN}/timeline?topic=tang&from=600&to=950`);
  await readyTimeline(mobilePage);
  await ensureCanvasContent(mobilePage, 'timeline-mobile');
  await mobilePage.screenshot({ path: join(OUT, 'timeline-mobile.jpg'), type: 'jpeg', quality: 82 });
  await mobilePage.close();
  await mobile.close();

  // 4. 交互演示视频：缩放 → 平移 → 选中人物，展示核心手势。
  // 录制中途重载会留白帧，空白时丢弃整个上下文重录。
  let videoFile = null;
  for (let attempt = 1; attempt <= 3 && !videoFile; attempt += 1) {
    const video = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
    });
    const videoPage = await video.newPage();
    await videoPage.goto(`${ORIGIN}/timeline?topic=tang&from=580&to=980`);
    await readyTimeline(videoPage);
    const colors = await videoPage.evaluate(() => {
      const canvas = document.getElementById('chart');
      if (!canvas || canvas.width === 0 || canvas.height === 0) return 0;
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4 * 89) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return seen.size;
    });
    if (colors < 4) {
      console.warn(`[demo-video] 画布空白（${colors} 色），丢弃第 ${attempt}/3 次录制`);
      const discarded = videoPage.video();
      await video.close();
      await rm(await discarded.path(), { force: true });
      continue;
    }
    await videoPage.mouse.move(980, 700);
    for (let step = 0; step < 8; step += 1) {
      await videoPage.mouse.wheel(0, -120);
      await videoPage.waitForTimeout(220);
    }
    await videoPage.waitForTimeout(500);
    await videoPage.mouse.down();
    await videoPage.mouse.move(600, 700, { steps: 14 });
    await videoPage.mouse.up();
    await videoPage.waitForTimeout(400);
    await videoPage.mouse.click(940, 720);
    await videoPage.waitForTimeout(1200);
    videoFile = videoPage.video();
    await videoPage.close();
    await video.close();
  }
  if (!videoFile) throw new Error('[demo-video] 三次录制均为空白画布');
  console.log(`video: ${await videoFile.path()}`);
  console.log('screenshots done');
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
