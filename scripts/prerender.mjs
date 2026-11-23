import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SiteHeader } from '../src/react/SiteHeader';
import { loadCollection, loadEra, loadEvent, loadPerson } from '../src/site/data';
import { escapeHtml } from '../src/site/escape';
import { loadSitePage, sitePageTitle } from '../src/site/page-loader';

const origin = 'https://lantai.0xenzyme.dev';
const dist = new URL('../dist/', import.meta.url);
const template = await readFile(new URL('index.html', dist), 'utf8');
const metadataSlot = /<!-- page metadata -->[\s\S]*?<!-- \/page metadata -->/;
const contentSlot = '<!-- page content -->';
if (!metadataSlot.test(template) || !template.includes(contentSlot)) {
  throw new Error('构建产物缺少页面预渲染标记。');
}

// 这个独立构建进程读取 Vite 已复制的 JSON，沿用浏览器加载器和数据校验。
globalThis.fetch = async (path) => {
  if (typeof path !== 'string' || !/^\/data\/[a-z0-9-]+(?:\/[a-z0-9-]+)?\.json$/.test(path)) {
    throw new Error(`无法预渲染数据请求：${path}`);
  }
  const json = await readFile(new URL(path.slice(1), dist), 'utf8');
  return new Response(json, { headers: { 'Content-Type': 'application/json' } });
};

const directories = [
  ['/', '在兰台浏览中国历史人物、事件、朝代和群像，沿时间轴了解它们的联系。'],
  ['/people', '浏览中国历史人物列传，查看人物生卒、生平、相关事件与出处。'],
  ['/events', '浏览中国历史纪事，按年代查阅事件经过、相关人物与出处。'],
  ['/eras', '按朝代浏览中国历史，查看各时期的年代范围、代表人物和事件。'],
  ['/collections', '按历史人物群像阅读专题，了解同一时代、学派或事件中的人物。'],
];

// 编辑可在这里调整首批收录名单，正文和详情摘要随内容数据更新。
const details = ['/people/li-bai', '/events/anshi-zhiluan', '/eras/tang', '/collections/rujia-chuancheng'];

const detailMetadata = new Map([
  [
    'people',
    async (id) => {
      const person = await loadPerson(id);
      return { heading: person.display, description: person.bio };
    },
  ],
  [
    'events',
    async (id) => {
      const event = await loadEvent(id);
      return { heading: event.display, description: event.desc };
    },
  ],
  [
    'eras',
    async (id) => {
      const era = await loadEra(id);
      return { heading: era.name, description: era.summary };
    },
  ],
  [
    'collections',
    async (id) => {
      const collection = await loadCollection(id);
      return { heading: collection.name, description: collection.summary };
    },
  ],
]);

function metadata(path, heading, description, indexable) {
  const title = escapeHtml(sitePageTitle(path, heading));
  const excerpt = description?.trim().split(/\r?\n/, 1)[0];
  if (!excerpt) throw new Error(`缺少页面摘要：${path}`);
  const summary = escapeHtml(excerpt.length > 150 ? `${excerpt.slice(0, 149)}…` : excerpt);
  const url = escapeHtml(new URL(path, origin).href);
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${summary}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${summary}" />`,
    `<meta property="og:url" content="${url}" />`,
    ...(indexable ? [] : ['<meta name="robots" content="noindex" />']),
  ].join('\n    ');
}

function documentFor(path, { heading, description, section, content, indexable }) {
  const body = renderToStaticMarkup(createElement(SiteHeader, { section }));
  return template
    .replace(metadataSlot, () => metadata(path, heading, description, indexable))
    .replace(contentSlot, () => `${body}<div id="site-page">${content}</div>`);
}

async function writePage(path, page) {
  const output = new URL(path === '/' ? 'index.html' : `${path.slice(1)}.html`, dist);
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, documentFor(path, page));
}

async function renderPage(path) {
  const page = await loadSitePage(path, '');
  if (page.library.failures.length || page.content.includes('lt-state-page')) {
    throw new Error(`无法生成完整页面：${path} ${page.library.failures.join(', ')}`);
  }
  return page;
}

for (const [path, description] of directories) {
  await writePage(path, { ...(await renderPage(path)), description, indexable: true });
}
for (const path of details) {
  const page = await renderPage(path);
  const id = path.split('/').at(-1);
  const loadMetadata = detailMetadata.get(page.section);
  if (!id || !loadMetadata) throw new Error(`无法解析详情路径：${path}`);
  await writePage(path, { ...page, ...(await loadMetadata(id)), indexable: true });
}

await writePage('/timeline', {
  heading: '年表',
  description: '在交互年表中查看中国历史人物、战事和事件的年代坐标。',
  section: 'timeline',
  content:
    '<main class="lt-page lt-state-page" id="main-content"><h1>年表</h1><p>请启用 JavaScript，使用交互年表浏览人物、战事和事件。</p></main>',
  indexable: false,
});
await writePage('/search', {
  ...(await renderPage('/search')),
  heading: '搜索',
  description: '搜索兰台的人物、事件、群像和朝代。',
  indexable: false,
});

const locations = [...directories.map(([path]) => path), ...details].map(
  (path) => `  <url><loc>${escapeHtml(new URL(path, origin).href)}</loc></url>`,
);
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...locations,
  '</urlset>',
  '',
].join('\n');
await writeFile(new URL('sitemap.xml', dist), sitemap);
console.log(`预渲染 ${locations.length} 个索引页面及年表、搜索，已生成 sitemap.xml。`);
