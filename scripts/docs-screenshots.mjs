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

mkdirSync(OUT, { recursive: true });
const server = await startDevServer();
const browser = await chromium.launch();
try {
  // 1. 桌面全景：含站点 hero 的完整年表页。
  const desktop = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const page = await desktop.newPage();
  await page.goto(`${ORIGIN}/timeline?topic=tang&from=580&to=980`);
  await readyTimeline(page);
  await page.screenshot({ path: join(OUT, 'timeline-tang.png') });
  await page.close();
  await desktop.close();

  // 1b. 社交分享卡（og:image / twitter:image）：og 常用 1200x630，单倍缩放控制体积。
  const og = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const ogPage = await og.newPage();
  await ogPage.goto(`${ORIGIN}/timeline?topic=tang&from=580&to=980`);
  await readyTimeline(ogPage);
  await ogPage.screenshot({ path: join(ROOT, 'public', 'images', 'history-timeline.png') });
  await ogPage.close();
  await og.close();

  // 2. 人物与同轴事件：深链李白 + 天宝章节，详情卡打开、选中行可见。
  const detail = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const detailPage = await detail.newPage();
  await detailPage.goto(`${ORIGIN}/timeline?topic=tang&view=tianbao&person=li-bai&from=700&to=775`);
  await readyTimeline(detailPage);
  await detailPage.screenshot({ path: join(OUT, 'timeline-person-detail.png') });
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
  await mobilePage.screenshot({ path: join(OUT, 'timeline-mobile.png') });
  await mobilePage.close();
  await mobile.close();

  // 4. 交互演示视频：缩放 → 平移 → 选中人物，展示核心手势。
  const video = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: 1600, height: 1000 } },
  });
  const videoPage = await video.newPage();
  await videoPage.goto(`${ORIGIN}/timeline?topic=tang&from=580&to=980`);
  await readyTimeline(videoPage);
  await videoPage.mouse.move(800, 620);
  for (let step = 0; step < 8; step += 1) {
    await videoPage.mouse.wheel(0, -120);
    await videoPage.waitForTimeout(220);
  }
  await videoPage.waitForTimeout(500);
  await videoPage.mouse.down();
  await videoPage.mouse.move(500, 620, { steps: 14 });
  await videoPage.mouse.up();
  await videoPage.waitForTimeout(400);
  await videoPage.mouse.click(760, 640);
  await videoPage.waitForTimeout(1200);
  const videoFile = videoPage.video();
  await videoPage.close();
  await video.close();
  console.log(`video: ${await videoFile.path()}`);
  console.log('screenshots done');
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
