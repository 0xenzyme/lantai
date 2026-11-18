import assert from 'node:assert/strict';
import test from 'node:test';

import { createLibrary, ensureLine } from '../src/app/model';
import type { EventLineView, SearchRecord } from '../src/types';
import { catalog, event, eventLine } from './fixtures';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

test('瘦索引失败回退 people.json，事件线加载后补出事件检索', async () => {
  const personRow: SearchRecord = {
    id: 'li-bai',
    name: '李白',
    display: '李白',
    birth: 701,
    death: 762,
    birthAccuracy: 'exact',
    deathAccuracy: 'exact',
    topicId: 'tang',
    topicTitle: '唐',
  };
  const military = eventLine({ id: 'military', events: [event({ id: 'e1', aliases: ['别名'] })] });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/data/index.json')) return json(catalog());
    if (url.endsWith('/data/people.json')) return json([personRow]);
    if (url.endsWith('/data/military.json')) return json(military satisfies EventLineView);
    return json({ message: 'missing' }, 500);
  };

  const library = await createLibrary();
  assert.deepEqual(
    library.people.map((record) => record.id),
    ['li-bai'],
    '瘦索引 500 时应回退到 people.json 的人物行',
  );
  assert.equal(library.events.length, 0, '首包不加载完整事件线');
  assert.equal(library.eventSearch.length, 0, '事件瘦索引失败时先保持空检索');

  await ensureLine(library, 'military');
  assert.equal(library.events.length, 1);
  assert.deepEqual(
    library.eventSearch.map((record) => record.id),
    ['e1'],
    '完整事件线加载后应补出可检索的事件行',
  );
  assert.deepEqual(library.eventSearch[0].catalogs, ['military']);
});
