import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateCatalog,
  validateEventLine,
  validateTimelineEventIndex,
  validateTimelinePeopleIndex,
  validateTopic,
} from '../src/contract';
import { CONTRACT_VERSION, type Catalog, type TimelineEventIndex, type TimelinePeopleIndex } from '../src/types';
import { catalog, event, eventLine, topic } from './fixtures';

test('合法目录通过校验', () => {
  assert.deepEqual(validateCatalog(catalog()), []);
});

test('目录版本、专题 id 与文件名重复会被拒绝', () => {
  const problems = validateCatalog(
    catalog({
      contractVersion: CONTRACT_VERSION + 1,
      topics: [
        {
          id: 'han',
          title: '汉',
          subtitle: '',
          file: 'han.json',
          region: 'china',
          eras: ['han'],
          themes: ['unified'],
        },
        {
          id: 'han',
          title: '汉二',
          subtitle: '',
          file: 'han.json',
          region: 'china',
          eras: ['han'],
          themes: ['unified'],
        },
      ],
    }),
  );
  assert.ok(problems.some((item) => item.includes('contractVersion')));
  assert.ok(problems.some((item) => item.includes('专题 id 重复')));
  assert.ok(problems.some((item) => item.includes('专题 file 重复')));
});

test('目录里的非法文件名与未知词表会被拒绝', () => {
  const problems = validateCatalog(
    catalog({
      topics: [
        {
          id: 'han',
          title: '汉',
          subtitle: '',
          file: 'han yan.json',
          region: 'mars',
          eras: ['unknown-era'],
          themes: ['unknown-theme'],
        },
      ],
    }),
  );
  assert.ok(problems.some((item) => item.includes('file 非法')));
  assert.ok(problems.some((item) => item.includes('region mars')));
  assert.ok(problems.some((item) => item.includes('era unknown-era')));
  assert.ok(problems.some((item) => item.includes('theme unknown-theme')));
});

test('合法专题通过校验', () => {
  assert.deepEqual(validateTopic(topic(), 'han'), []);
});

test('专题校验覆盖泳道、生卒顺序与 id 重复', () => {
  const problems = validateTopic(
    topic({
      people: [
        {
          id: 'a',
          name: 'a',
          display: 'a',
          lane: 'missing',
          birth: -50,
          death: -100,
          birthAccuracy: 'exact',
          deathAccuracy: 'exact',
        },
        { id: 'a', name: 'a2', display: 'a2', lane: 'lane-a', birthAccuracy: 'unknown', deathAccuracy: 'unknown' },
      ],
      relations: [{ source: 'a', target: 'ghost', type: 'friend', note: '无' }],
    }),
    'han',
  );
  assert.ok(problems.some((item) => item.includes('people 存在重复 id')));
  assert.ok(problems.some((item) => item.includes('不存在的泳道')));
  assert.ok(problems.some((item) => item.includes('生年晚于卒年')));
  assert.ok(problems.some((item) => item.includes('target 人物不存在')));
  assert.ok(problems.some((item) => item.includes('关系类型 friend 不存在')));
});

test('专题 id 与目录不一致会被拒绝', () => {
  const problems = validateTopic(topic(), 'qin');
  assert.ok(problems.some((item) => item.includes('与目录中的 qin 不一致')));
});

test('合法事件线通过校验', () => {
  assert.deepEqual(validateEventLine(eventLine(), 'military'), []);
});

test('目录 homeEvents 通过校验并拒绝坏记录', () => {
  const good = catalog({ homeEvents: [event({ id: 'featured' })] });
  assert.deepEqual(validateCatalog(good), []);
  const badEvents = [
    event({ id: 'featured', year: 0 }),
    { ...event({ id: 'featured' }), importance: 9 },
  ] as Catalog['homeEvents'];
  const problems = validateCatalog(catalog({ homeEvents: badEvents }));
  assert.ok(problems.some((item) => item.includes('homeEvents featured year 无效')));
  assert.ok(problems.some((item) => item.includes('不能是公元 0 年')));
  assert.ok(problems.some((item) => item.includes('homeEvents featured id 重复')));
  assert.ok(problems.some((item) => item.includes('homeEvents featured importance 无效')));
});

test('年表人物瘦索引通过校验并拒绝缺检索字段的记录', () => {
  const good: TimelinePeopleIndex = {
    contractVersion: CONTRACT_VERSION,
    people: [
      {
        id: 'li-bai',
        name: '李白',
        display: '李白',
        aliases: ['太白'],
        tags: ['诗'],
        gender: 'male',
        birth: 701,
        death: 762,
        birthAccuracy: 'exact',
        deathAccuracy: 'exact',
        topicId: 'tang',
        topicTitle: '唐',
      },
    ],
  };
  assert.deepEqual(validateTimelinePeopleIndex(good), []);
  const problems = validateTimelinePeopleIndex({
    contractVersion: CONTRACT_VERSION,
    people: [
      { ...good.people[0], topicId: '' },
      { ...good.people[0], id: 'li-bai', display: '' },
      { ...good.people[0], id: 'bad-year', birth: 0, birthAccuracy: 'unknown' },
      { ...good.people[0], id: 'bad-gender', gender: 'other' as never },
    ],
  });
  assert.ok(problems.some((item) => item.includes('li-bai 缺少 topicId')));
  assert.ok(problems.some((item) => item.includes('li-bai id 重复')));
  assert.ok(problems.some((item) => item.includes('bad-year birth 无效')));
  assert.ok(problems.some((item) => item.includes('bad-gender gender 无效')));
});

test('年表事件瘦索引通过校验并拒绝坏目录与年份', () => {
  const good: TimelineEventIndex = {
    contractVersion: CONTRACT_VERSION,
    events: [
      {
        id: 'anshi-zhiluan',
        name: '安史之乱',
        display: '安史之乱',
        year: 755,
        endYear: 763,
        type: 'rebellion',
        importance: 3,
        catalogs: ['military', 'history'],
      },
    ],
  };
  assert.deepEqual(validateTimelineEventIndex(good), []);
  const problems = validateTimelineEventIndex({
    contractVersion: CONTRACT_VERSION,
    events: [
      { ...good.events[0], catalogs: [] },
      { ...good.events[0], id: 'year-zero', year: 0 },
      { ...good.events[0], id: 'bad-catalog', catalogs: ['other' as never] },
      { ...good.events[0], id: 'bad-end', endYear: 700 },
    ],
  });
  assert.ok(problems.some((item) => item.includes('anshi-zhiluan catalogs 为空')));
  assert.ok(problems.some((item) => item.includes('year-zero year 无效')));
  assert.ok(problems.some((item) => item.includes('bad-catalog catalogs 无效')));
  assert.ok(problems.some((item) => item.includes('bad-end endYear 无效')));
});

test('事件线校验覆盖公元 0 年、重复 id 与分段归属', () => {
  const problems = validateEventLine(
    eventLine({
      events: [
        event({ id: 'e1', year: 0 }),
        event({ id: 'e1', year: -450, endYear: -400, kind: 'span', endYearAccuracy: 'exact' }),
      ],
      segments: [
        { id: 's1', label: '一', from: -600, to: -400, events: ['e1'] },
        { id: 's2', label: '二', from: -600, to: -400, events: ['e1'] },
      ],
    }),
  );
  assert.ok(problems.some((item) => item.includes('不能是公元 0 年')));
  assert.ok(problems.some((item) => item.includes('id 重复')));
  assert.ok(problems.some((item) => item.includes('应恰好属于一个分段')));
});

test('事件线的 id 与范围不变量会被校验', () => {
  const problems = validateEventLine(eventLine({ id: 'people' as 'military', events: [] }), 'military');
  assert.ok(problems.some((item) => item.includes('id 为 people，期望 military')));
  assert.ok(problems.some((item) => item.includes('事件线 id 必须是')));
});

test('线段范围必须与事件年份一致', () => {
  const problems = validateEventLine(
    eventLine({
      segments: [{ id: 'seg-1', label: '一', from: -100, to: 100, events: ['e1'] }],
    }),
  );
  assert.ok(problems.some((item) => item.includes('年份不在所属分段范围内')));
});
