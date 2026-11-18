import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileAll } from '../pipeline/compile';
import { lintPipeline } from '../pipeline/lint';
import { loadPipeline } from '../pipeline/load';

const pipelineRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'pipeline');

test('真实内容可以加载、编译并通过错误级校验', () => {
  const data = loadPipeline(pipelineRoot);
  assert.ok(data.order.length > 0, '专题列表不能为空');
  assert.ok(data.people.size > 0, '人物库不能为空');
  assert.ok(data.events.size > 0, '事件库不能为空');

  const { catalog, topics, events, lines, timelinePeople, timelineEvents } = compileAll(data);

  assert.equal(topics.length, data.order.length);
  assert.deepEqual(
    catalog.topics.map((item) => item.id),
    data.order,
  );
  assert.equal(lines.length, 2);
  assert.ok(events.length >= data.events.size, '编译后的事件不能少于源文件数');
  assert.ok(timelinePeople.length > 0, '年表人物瘦索引不能为空');
  assert.ok(timelineEvents.length > 0, '年表事件瘦索引不能为空');
  assert.equal(
    new Set(timelinePeople.map((record) => record.id)).size,
    timelinePeople.length,
    '人物瘦索引 id 必须唯一',
  );
  assert.equal(
    new Set(timelineEvents.map((record) => record.id)).size,
    timelineEvents.length,
    '事件瘦索引 id 必须唯一',
  );
  assert.equal(
    timelinePeople.some((record) => 'bio' in record),
    false,
    '人物瘦索引不得包含 bio',
  );
  const lineEventIds = new Set(lines.flatMap((line) => line.events.map((event) => event.id)));
  assert.deepEqual(
    new Set(timelineEvents.map((record) => record.id)),
    lineEventIds,
    '事件瘦索引必须覆盖两条事件线的并集',
  );

  for (const topic of topics) assert.equal(topic.contractVersion, catalog.contractVersion);
  const ids = new Set(events.map((item) => item.id));
  assert.equal(ids.size, events.length, '事件 id 必须全局唯一');

  const errors = lintPipeline(data, topics, catalog).filter((item) => item.level === 'error');
  assert.deepEqual(
    errors.map((item) => `${item.path}: ${item.message}`),
    [],
  );
});
