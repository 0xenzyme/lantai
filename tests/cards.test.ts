import assert from 'node:assert/strict';
import test from 'node:test';

import { renderEventCard, renderPersonCard, type CardContext } from '../src/app/cards';
import type { Library } from '../src/app/model';
import type { Palette } from '../src/app/skins';
import { catalog, event, person, topic } from './fixtures';

function makeLibrary(overrides: Partial<Library> = {}): Library {
  const cat = catalog();
  return {
    catalog: cat,
    topics: cat.topics,
    lines: {
      military: { id: 'military', title: '军事', range: [-2070, 1949], events: [], dynasties: [] },
      history: { id: 'history', title: '历史事件', range: [-2070, 1949], events: [], dynasties: [] },
    },
    events: [],
    eventById: new Map(),
    eventsByPerson: new Map(),
    eventSearch: [],
    dynasties: [],
    categoryNames: new Map(),
    polityNames: new Map(),
    people: [],
    personById: new Map(),
    topicCache: new Map(),
    personBio: new Map(),
    personBioLoads: new Map(),
    loadedLines: new Set(),
    lineLoads: new Map(),
    ...overrides,
  };
}

function makePalette(overrides: Partial<Palette> = {}): Palette {
  return {
    paper: '#ffffff',
    ink: '#000000',
    ink2: '#222222',
    muted: '#888888',
    line: '#cccccc',
    hair: '#eeeeee',
    accent: '#cc0000',
    laneLabel: '#444444',
    headerBg: '#dddddd',
    axisText: '#ead5b7',
    labelInBar: '#ffffff',
    ribbonBg: 'rgba(0,0,0,0.1)',
    ribbonText: '#ffffff',
    density: '#999999',
    viewportWash: 'rgba(0,0,0,0.05)',
    eventAlpha: 0.1,
    eventAlphaDim: 0.03,
    ...overrides,
  };
}

function makeContext(overrides: Partial<CardContext> = {}): CardContext {
  return {
    library: makeLibrary(),
    palette: makePalette(),
    topic: null,
    ...overrides,
  };
}

const XSS = `<img src=x onerror=alert(1)>`;

test('人物卡转义姓名、称号、简介、标签与年份说明里的 HTML', () => {
  const evil = person({
    id: 'evil',
    name: XSS,
    display: `"><script>alert(2)</script>`,
    title: `<t>`,
    bio: `it's <b>bold</b>`,
    tags: [`a'b`],
    birthNote: `<evil>`,
    birth: -100,
    death: -50,
  });
  const ctx = makeContext({ topic: topic({ people: [evil] }) });
  const html = renderPersonCard(ctx, 'evil');
  assert.ok(!html.includes('<script>'), '不应出现未转义的 <script>');
  assert.ok(!html.includes('<img'), '不应出现未转义的 <img 标签');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('it&#39;s &lt;b&gt;bold&lt;/b&gt;'));
  assert.ok(html.includes('a&#39;b'));
});

test('人物卡转义关系注记、分类名与生平事件名', () => {
  const a = person({ id: 'a', birth: -100, death: -50 });
  const b = person({ id: 'b', display: XSS, birth: -90, death: -40 });
  const evilEvent = event({ id: 'e-evil', display: `<script>x</script>`, year: -60, people: ['a'] });
  const library = makeLibrary({
    categoryNames: new Map([['official', `<script>cat</script>`]]),
    polityNames: new Map([['han', `a"b'c`]]),
    eventsByPerson: new Map([['a', [evilEvent]]]),
  });
  const ctx = makeContext({
    library,
    topic: topic({
      people: [{ ...a, categories: ['official'], polity: ['han'] }, b],
      relationTypes: [{ id: 'rival', name: `<rival>`, color: '#cc0000', dash: null, directed: false }],
      relations: [{ source: 'a', target: 'b', type: 'rival', note: `note's "<payload>"` }],
    }),
  });
  const html = renderPersonCard(ctx, 'a');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<rival>'));
  assert.ok(html.includes('&lt;script&gt;cat&lt;/script&gt;'));
  assert.ok(html.includes('note&#39;s &quot;&lt;payload&gt;&quot;'));
  assert.ok(html.includes('a&quot;b&#39;c'));
});

test('事件卡转义名称、地点、描述与出处', () => {
  const record = event({
    id: 'e1',
    name: XSS,
    display: `<script>d</script>`,
    place: `<place>`,
    placeNow: `now's`,
    desc: `desc "quoted"`,
    result: `<result>`,
    yearNote: `yn's`,
    aliases: [`al'ias`],
    sources: [{ work: `<w>`, part: `p'`, note: `n"`, kind: 'classic' }],
  });
  const library = makeLibrary({ dynasties: [{ id: 'han', name: `<han>`, from: -206, to: 220 }] });
  const ctx = makeContext({ library });
  const html = renderEventCard(ctx, { ...record, dynasties: ['han'] });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<place>'));
  assert.ok(!html.includes('<han>'));
  assert.ok(html.includes('&lt;w&gt; · p&#39; —— n&quot;'));
  assert.ok(html.includes('now&#39;s'));
});

test('写进 style 属性的配色值也会被转义', () => {
  const record = event({ id: 'e1', scale: 'war' });
  const ctx = makeContext({ palette: makePalette({ muted: `" onload="alert(1)`, accent: `'><x>` }) });
  const html = renderEventCard(ctx, record);
  assert.ok(!html.includes('" onload="'), 'style 属性不应被引号闭合');
  assert.ok(html.includes('&quot; onload=&quot;alert(1)'));
});

test('未知人物渲染兜底卡片', () => {
  const html = renderPersonCard(makeContext(), 'nope');
  assert.ok(html.includes('未知条目'));
});

test('人物卡根据关系和聚焦模式渲染聚焦按钮与切换文案', () => {
  const p1 = person({ id: 'su-shi', name: '苏轼', display: '苏轼' });
  const p2 = person({ id: 'su-zhe', name: '苏辙', display: '苏辙' });
  const testTopic = topic({
    people: [p1, p2],
    relations: [{ source: 'su-shi', target: 'su-zhe', type: 'kin' }],
    relationTypes: [{ id: 'kin', name: '亲属', color: '#2e7d32', dash: null, directed: false }],
  });

  // 未聚焦状态：展示「仅看关联」
  const unfocusedCtx = makeContext({ topic: testTopic, focusMode: false });
  const unfocusedHtml = renderPersonCard(unfocusedCtx, 'su-shi');
  assert.ok(unfocusedHtml.includes('data-action="toggle-focus"'));
  assert.ok(unfocusedHtml.includes('仅看关联'));
  assert.ok(!unfocusedHtml.includes('lt-focus-toggle active'));

  // 聚焦状态：展示「退出聚焦」与 active 态
  const focusedCtx = makeContext({ topic: testTopic, focusMode: true });
  const focusedHtml = renderPersonCard(focusedCtx, 'su-shi');
  assert.ok(focusedHtml.includes('退出聚焦'));
  assert.ok(focusedHtml.includes('lt-focus-toggle active'));
});

test('人物卡支持对比操作：非主选中人物提供加入对比与移除对比按钮', () => {
  const p1 = person({ id: 'su-shi', name: '苏轼', display: '苏轼' });
  const p2 = person({ id: 'liu-yong', name: '柳永', display: '柳永' });
  const testTopic = topic({ people: [p1, p2] });

  // 主人物为苏轼，查看柳永：显示「+ 加入对比」
  const notComparedCtx = makeContext({
    topic: testTopic,
    selectedPersonId: 'su-shi',
    isCompared: false,
  });
  const notComparedHtml = renderPersonCard(notComparedCtx, 'liu-yong');
  assert.ok(notComparedHtml.includes('data-action="toggle-compare"'));
  assert.ok(notComparedHtml.includes('+ 加入对比'));
  assert.ok(!notComparedHtml.includes('lt-compare-toggle active'));

  // 柳永已在对比中：显示「✓ 移除对比」与 active 态
  const comparedCtx = makeContext({
    topic: testTopic,
    selectedPersonId: 'su-shi',
    isCompared: true,
  });
  const comparedHtml = renderPersonCard(comparedCtx, 'liu-yong');
  assert.ok(comparedHtml.includes('✓ 移除对比'));
  assert.ok(comparedHtml.includes('lt-compare-toggle active'));

  // 查看苏轼自身：不显示对比按钮
  const selfHtml = renderPersonCard(notComparedCtx, 'su-shi');
  assert.ok(!selfHtml.includes('data-action="toggle-compare"'));
});
