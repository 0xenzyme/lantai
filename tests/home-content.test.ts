import assert from 'node:assert/strict';
import test from 'node:test';

import { catalog, event, eventLine, person } from './fixtures';
import { validateCatalog } from '../src/contract';
import { eventSummary, collectionFeature, eraSummary, sectionHeading } from '../src/site/components';
import { eventRecords, retrySiteData, selectHomeEvents } from '../src/site/data';
import { homePage } from '../src/site/home';
import { loadSitePage } from '../src/site/page-loader';
import type { EventLineView } from '../src/types';

test('首页事件选择会去重、按时间排序并跳过失效编辑 id', () => {
  const early = event({ id: 'early', year: -300, importance: 1 });
  const late = event({ id: 'late', year: 700, importance: 3 });
  const sameId = event({ id: 'late', year: 701, importance: 1 });

  assert.deepEqual(
    selectHomeEvents([late, early, sameId], ['late', 'missing', 'early', 'late']).map((item) => item.id),
    ['early', 'late'],
  );
  assert.deepEqual(selectHomeEvents([late], ['late'], 0), []);
  assert.deepEqual(
    [late, early, sameId].map((item) => item.id),
    ['late', 'early', 'late'],
  );
});

test('事件线合并只保留一个事件，并按年份、importance 和 id 稳定排序', () => {
  const duplicate = event({ id: 'duplicate', year: 100, importance: 1 });
  const duplicateFromSecondLine = event({ id: 'duplicate', year: 999, importance: 3 });
  const sameYearLow = event({ id: 'same-low', year: 100, importance: 1 });
  const sameYearHigh = event({ id: 'same-high', year: 100, importance: 3 });
  const history: EventLineView = eventLine({ id: 'history', events: [duplicate, sameYearLow, sameYearHigh] });
  const military: EventLineView = eventLine({ id: 'military', events: [duplicateFromSecondLine] });

  assert.deepEqual(
    eventRecords({
      catalog: undefined,
      people: [],
      events: [history, military],
      collections: [],
      eras: [],
      failures: [],
    }).map((item) => item.id),
    ['same-high', 'duplicate', 'same-low'],
  );
});

test('事件摘要复用实体链接、年份和类型，并转义编辑文本', () => {
  const html = eventSummary(
    event({
      id: 'unsafe/event',
      display: '<安史 & "乱">',
      type: 'rebellion',
      year: 755,
      endYear: 763,
      endYearAccuracy: 'exact',
      place: '<范阳>',
      desc: '<正文 & 说明>',
    }),
  );

  assert.match(html, /href="\/events\/unsafe%2Fevent"/);
  assert.match(html, /data-entity-kind="event" data-entity-id="unsafe\/event"/);
  assert.match(html, /&lt;安史 &amp; &quot;乱&quot;&gt;/);
  assert.match(html, /755—763 年/);
  assert.match(html, /data-event-type="rebellion"/);
  assert.match(html, />民变<\/span>/);
  assert.match(html, /&lt;范阳&gt;/);
  assert.match(html, /&lt;正文 &amp; 说明&gt;/);
});

test('共享内容原语保留既有 data attributes 和可访问入口', () => {
  const heading = sectionHeading('<精选>', {
    id: 'featured',
    description: '<说明>',
    href: '/events',
    linkLabel: '查看纪事',
  });
  const era = eraSummary({
    contractVersion: 1,
    id: 'qin',
    name: '<秦>',
    from: -221,
    to: -206,
    group: 'qin-han',
    personCount: 1,
    eventCount: 2,
  });
  const collection = collectionFeature(
    {
      contractVersion: 1,
      id: 'series',
      name: '<系列>',
      category: 'thought',
      summary: '<简介>',
      memberCount: 1,
      featuredMembers: [
        {
          id: 'person',
          name: '<人物>',
          display: '<人物>',
          lane: 'lane-a',
          birthAccuracy: 'unknown',
          deathAccuracy: 'unknown',
        },
      ],
    },
    { categoryLabel: '思想' },
  );

  assert.match(heading, /id="featured"/);
  assert.match(heading, /&lt;精选&gt;/);
  assert.match(heading, /data-site-link/);
  assert.match(era, /data-era-id="qin"/);
  assert.match(era, /前 221—前 206 年/);
  assert.match(collection, /href="\/collections\/series" data-site-link/);
  assert.match(collection, /data-entity-kind="person"/);
  assert.match(collection, /&lt;简介&gt;/);
});

test('首页路由请求 history 和 military 两条事件线', async () => {
  retrySiteData();
  const requests: string[] = [];
  const siteCatalog = catalog({ editorial: { dynasties: [], collections: [], events: [] } });
  assert.deepEqual(validateCatalog(siteCatalog), []);
  const lines = {
    '/data/history.json': eventLine({ id: 'history' }),
    '/data/military.json': eventLine({ id: 'military' }),
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    const value =
      url === '/data/index.json'
        ? siteCatalog
        : url === '/data/collections.json'
          ? []
          : url === '/data/eras.json'
            ? []
            : lines[url as keyof typeof lines];
    if (value === undefined) return new Response('missing', { status: 404 });
    return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await loadSitePage('/', '');
  assert.ok(requests.includes('/data/history.json'));
  assert.ok(requests.includes('/data/military.json'));
});

test('首页使用整幅 Hero 背景并输出轻量实体脉络节点', () => {
  const selected = event({ id: 'selected', display: '<编辑 & "事件">', year: 300 });
  const fallback = event({ id: 'fallback', display: '未选事件', year: 100 });
  const featuredPerson = person({ id: 'person-a', display: '<人物 & 甲>' });
  const html = homePage({
    catalog: catalog({ editorial: { dynasties: [], collections: ['series'], events: ['selected'] } }),
    people: [],
    events: [eventLine({ id: 'history', events: [fallback, selected] })],
    collections: [
      {
        contractVersion: 1,
        id: 'series',
        name: '<群像 & "系列">',
        category: 'thought',
        summary: '<简介>',
        memberCount: 1,
        featuredMembers: [featuredPerson],
      },
    ],
    eras: [],
    failures: [],
  });

  assert.match(
    html,
    /<section class="lt-home-hero" aria-labelledby="home-title">\s*<div class="lt-home-hero-media">[\s\S]*?banner-home-portraits-1440\.webp[\s\S]*?<\/div>\s*<div class="lt-home-hero-shell">/,
  );
  assert.match(html, /<h1 id="home-title" tabindex="-1">纵横千年，人物相望<\/h1>/);
  assert.match(html, /<div class="lt-home-search-box">/);
  assert.match(html, /<button class="lt-home-search-submit" type="submit" aria-label="搜索">/);
  assert.match(html, /<nav class="lt-home-hero-threads" aria-label="人物与事件脉络">/);
  assert.equal((html.match(/class="lt-home-hero-thread-node lt-home-hero-thread-node-/g) ?? []).length, 3);
  assert.match(
    html,
    /<a class="lt-home-hero-thread-node lt-home-hero-thread-node-person" href="\/people\/person-a" data-entity-kind="person" data-entity-id="person-a"><small>人物<\/small><strong>&lt;人物 &amp; 甲&gt;<\/strong><span>精选人物<\/span><\/a>/,
  );
  assert.match(
    html,
    /<a class="lt-home-hero-thread-node lt-home-hero-thread-node-event" href="\/events\/selected" data-entity-kind="event" data-entity-id="selected"><small>事件<\/small><strong>&lt;编辑 &amp; &quot;事件&quot;&gt;<\/strong>/,
  );
  assert.match(
    html,
    /<a class="lt-home-hero-thread-node lt-home-hero-thread-node-collection" href="\/collections\/series" data-site-link><small>群像<\/small><strong>&lt;群像 &amp; &quot;系列&quot;&gt;<\/strong><span>编辑精选<\/span><\/a>/,
  );
  assert.doesNotMatch(html, /<aside class="lt-home-visual"/);
  assert.doesNotMatch(html, /<h2[^>]*>人物与事件脉络<\/h2>/);
  assert.doesNotMatch(html, /未选事件/);
  assert.match(html, /精选群像/);
  assert.match(html, /推荐朝代/);
});
