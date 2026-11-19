import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BAR_H,
  LARGE_ROW_PITCH,
  LANE_PAD_B,
  LANE_TITLE_H,
  barTop,
  buildCombinedLayout,
  buildEventLayout,
  buildPeopleLayout,
  layoutHeight,
  topicPeopleForView,
} from '../src/app/layout';
import { event, person, topic } from './fixtures';

const PITCH = 40;
const LANE_HEIGHT = LANE_TITLE_H + PITCH + LANE_PAD_B;

test('单人泳道只有一行，高度按行距计算', () => {
  const lanes = buildPeopleLayout(topic(), new Set(), PITCH);
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].rows, 1);
  assert.equal(lanes[0].height, LANE_HEIGHT);
});

test('生卒重叠的人被打包到第二行', () => {
  const lanes = buildPeopleLayout(
    topic({
      people: [person({ id: 'a', birth: -100, death: -50 }), person({ id: 'b', birth: -80, death: -40 })],
    }),
    new Set(),
    PITCH,
  );
  assert.equal(lanes[0].rows, 2);
  assert.deepEqual(
    lanes[0].items.map((item) => [item.id, item.row]),
    [
      ['a', 0],
      ['b', 1],
    ],
  );
});

test('生卒不重叠的人共用一行', () => {
  const lanes = buildPeopleLayout(
    topic({
      people: [person({ id: 'a', birth: -200, death: -150 }), person({ id: 'b', birth: -100, death: -50 })],
    }),
    new Set(),
    PITCH,
  );
  assert.equal(lanes[0].rows, 1);
});

test('同生年按 order 排序', () => {
  const lanes = buildPeopleLayout(
    topic({
      people: [
        person({ id: 'late', birth: -100, death: -60, order: 9 }),
        person({ id: 'early', birth: -100, death: -60, order: 1 }),
      ],
    }),
    new Set(),
    PITCH,
  );
  assert.deepEqual(
    lanes[0].items.map((item) => item.id),
    ['early', 'late'],
  );
});

test('隐藏泳道不参与布局，空泳道仍保留行标题', () => {
  const lanes = buildPeopleLayout(
    topic({
      lanes: [
        { id: 'lane-a', name: '甲', color: '#111111' },
        { id: 'lane-b', name: '乙', color: '#222222' },
      ],
    }),
    new Set(['lane-a']),
    PITCH,
  );
  assert.deepEqual(
    lanes.map((lane) => [lane.id, lane.rows]),
    [['lane-b', 0]],
  );
});

test('缺生卒年时按前后 40 年补齐', () => {
  const lanes = buildPeopleLayout(
    topic({
      lanes: [{ id: 'lane-a', name: '甲', color: '#111111' }],
      people: [
        person({ id: 'birth-only', birth: -100, birthAccuracy: 'exact', deathAccuracy: 'unknown' }),
        person({ id: 'death-only', death: 100, birthAccuracy: 'unknown', deathAccuracy: 'exact' }),
      ],
    }),
    new Set(),
    PITCH,
  );
  const items = lanes[0].items;
  assert.deepEqual(
    items.map((item) => [item.id, item.from, item.to]),
    [
      ['birth-only', -100, -60],
      ['death-only', 60, 100],
    ],
  );
});

test('barTop 在行距内垂直居中', () => {
  const lane = buildPeopleLayout(topic(), new Set(), PITCH)[0];
  assert.equal(barTop(lane, 0), lane.y + LANE_TITLE_H + (PITCH - BAR_H) / 2);
  assert.equal(barTop(lane, 1) - barTop(lane, 0), PITCH);
});

test('事件线按 type 分行并跳过空类型', () => {
  const lanes = buildEventLayout(
    [event({ id: 'war', type: 'military', year: -500 }), event({ id: 'revolt', type: 'rebellion', year: -400 })],
    'military',
    new Set(),
    PITCH,
  );
  assert.deepEqual(
    lanes.map((lane) => lane.id),
    ['military', 'rebellion'],
  );
  assert.deepEqual(
    lanes.map((lane) => lane.height),
    [LANE_HEIGHT, LANE_HEIGHT],
  );
});

test('事件线不显示军事与叛乱之外的类型', () => {
  const lanes = buildEventLayout(
    [event({ id: 'culture', type: 'cultural', year: -500 })],
    'military',
    new Set(),
    PITCH,
  );
  assert.equal(lanes.length, 0);
});

test('事件线隐藏指定类型后不再生成该行', () => {
  const lanes = buildEventLayout(
    [event({ id: 'war', type: 'military', year: -500 }), event({ id: 'revolt', type: 'rebellion', year: -400 })],
    'military',
    new Set(['military']),
    PITCH,
  );
  assert.deepEqual(
    lanes.map((lane) => lane.id),
    ['rebellion'],
  );
});

test('时段事件按 endYear 占位', () => {
  const lanes = buildEventLayout(
    [
      event({ id: 'long', year: -600, endYear: -400, kind: 'span', endYearAccuracy: 'exact' }),
      event({ id: 'short', year: -450 }),
    ],
    'military',
    new Set(),
    PITCH,
  );
  assert.equal(lanes[0].rows, 2);
});

test('layoutHeight 取最后一条泳道的底部', () => {
  assert.equal(layoutHeight([]), 0);
  const lanes = buildPeopleLayout(topic(), new Set(), PITCH);
  assert.equal(layoutHeight(lanes), lanes[0].y + lanes[0].height);
});

test('章节 people 明确限制人物编排，无名单章节保留全量', () => {
  const scoped = topic({
    people: [person({ id: 'a', birth: -100, death: -50 }), person({ id: 'b', birth: -40, death: -10 })],
    views: [
      { id: 'all', name: '全览', from: -100, to: 0 },
      { id: 'focused', name: '精选', from: -100, to: 0, people: ['b'] },
    ],
  });
  assert.deepEqual(
    topicPeopleForView(scoped, 'focused').map((item) => item.id),
    ['b'],
  );
  assert.deepEqual(
    topicPeopleForView(scoped, 'all').map((item) => item.id),
    ['a', 'b'],
  );
});

test('合并布局按章节和时间窗过滤，并保留三类顶级分区', () => {
  const scoped = topic({
    people: [person({ id: 'outside', birth: -200, death: -150 }), person({ id: 'inside', birth: 50, death: 80 })],
    views: [{ id: 'focused', name: '精选', from: 0, to: 100, people: ['inside', 'outside'] }],
  });
  const lanes = buildCombinedLayout(
    scoped,
    [
      event({ id: 'war', type: 'military', year: 60 }),
      event({ id: 'history', type: 'political', year: 70 }),
      event({ id: 'outside-event', type: 'military', year: 200 }),
    ],
    new Set(),
    { people: true, war: true, history: true },
    BAR_H + 4,
    { viewId: 'focused', domain: [0, 100] },
  );
  assert.deepEqual(
    lanes.map((lane) => lane.id),
    ['people', 'war', 'history'],
  );
  assert.deepEqual(
    lanes[0].items.map((item) => item.id),
    ['inside'],
  );
  assert.equal(lanes[0].name, '人物（生卒年）');
  assert.equal(lanes[0].items[0].kind, 'person');
  assert.equal(lanes[0].items[0].color, '#111111');
  assert.deepEqual(
    lanes[1].items.map((item) => item.id),
    ['war'],
  );
  assert.deepEqual(
    lanes[2].items.map((item) => item.id),
    ['history'],
  );
});

test('大行模式一人一行，密条继续打包不重叠人物', () => {
  const scoped = topic({
    people: [person({ id: 'a', birth: -100, death: -50 }), person({ id: 'b', birth: -40, death: -10 })],
  });
  const large = buildCombinedLayout(
    scoped,
    [],
    new Set(),
    { people: true, war: false, history: false },
    LARGE_ROW_PITCH,
    {
      domain: [-200, 0],
      largeRows: true,
    },
  );
  assert.equal(large[0].presentation, 'large');
  assert.equal(large[0].rows, 2);
  assert.deepEqual(
    large[0].items.map((item) => item.row),
    [0, 1],
  );

  const dense = buildCombinedLayout(scoped, [], new Set(), { people: true, war: false, history: false }, BAR_H + 4, {
    domain: [-200, 0],
    largeRows: false,
  });
  assert.equal(dense[0].presentation, 'dense');
  assert.equal(dense[0].rows, 1);
});

test('聚焦模式过滤只保留 focusIds 内人物及相关事件，忽略不相干条目', () => {
  const scoped = topic({
    people: [
      person({ id: 'su-shi', lane: 'court', birth: 1037, death: 1101 }),
      person({ id: 'huang-tingjian', lane: 'court', birth: 1045, death: 1105 }),
      person({ id: 'dali-king', lane: 'dali', birth: 1040, death: 1100 }),
    ],
  });
  const events = [
    event({ id: 'wutai-poetry', type: 'political', year: 1079, people: ['su-shi'] }),
    event({ id: 'unrelated-war', type: 'military', year: 1080 }),
  ];

  const focusIds = new Set(['su-shi', 'huang-tingjian']);
  const lanes = buildCombinedLayout(scoped, events, new Set(), { people: true, war: true, history: true }, BAR_H + 4, {
    domain: [1030, 1110],
    focusIds,
  });

  assert.equal(lanes[0].name, '人物（聚焦关系网）');
  assert.deepEqual(
    lanes[0].items.map((item) => item.id),
    ['su-shi', 'huang-tingjian'],
  );

  assert.equal(lanes.length, 2);
  assert.equal(lanes[1].id, 'history');
  assert.deepEqual(
    lanes[1].items.map((item) => item.id),
    ['wutai-poetry'],
  );
});

test('聚焦对比模式支持跨专题解析人物并设置标题为人物（同屏对比）', () => {
  const scoped = topic({
    people: [person({ id: 'su-shi', birth: 1037, death: 1101 })],
  });

  const focusIds = new Set(['su-shi', 'li-bai']);
  const lanes = buildCombinedLayout(scoped, [], new Set(), { people: true, war: false, history: false }, BAR_H + 4, {
    domain: [700, 1120],
    focusIds,
    isComparing: true,
    personResolver: (id) =>
      id === 'li-bai' ? person({ id: 'li-bai', birth: 701, death: 762, name: '李白', display: '李白' }) : null,
  });

  assert.equal(lanes[0].name, '人物（同屏对比）');
  assert.equal(lanes[0].items.length, 2);
  assert.deepEqual(
    lanes[0].items.map((item) => item.id),
    ['li-bai', 'su-shi'],
  );
});
