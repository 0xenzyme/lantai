import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { cardBio } from '../src/app/cards';
import { bioParagraphs } from '../src/site/person';
import { auditPeople } from '../pipeline/audit-people';
import { checkEvidence, excerptSegments } from '../pipeline/evidence-check';
import { lintRegistryPerson } from '../pipeline/lint';
import { loadPipeline } from '../pipeline/load';
import { assembleBatch, checkItem, initBatch } from '../pipeline/people-batch-assemble';
import { mergeRelations } from '../pipeline/people-batch-relations';
import { formatPersonMarkdown, parsePersonMarkdown } from '../pipeline/person-md';
import { checkPeopleBatch } from '../pipeline/people-production';
import { readRawPassage, searchRawBook } from '../pipeline/source-search';
import type { ContentEvidence } from '../pipeline/content-batch';
import type { RegistryPerson } from '../pipeline/types';

// 合成的原典与夹具只测试机制，不表达史实。
const root = mkdtempSync(join(tmpdir(), 'lantai-people-batch-tools-'));
cpSync(resolve('pipeline'), join(root, 'pipeline'), { recursive: true });
cpSync(resolve('content'), join(root, 'content'), { recursive: true });
mkdirSync(join(root, 'raw/測試朝/測試書'), { recursive: true });
writeFileSync(join(root, 'raw/測試朝/測試書/卷一.md'), '測試人者，測試朝人也。\n卒於測試十年，年七十。\n');
after(() => rmSync(root, { recursive: true, force: true }));

test('原典检索按繁体逐字命中并标出命中部分', () => {
  const hits = searchRawBook('測試書', /測試朝人/, 5, 4, root);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'raw/測試朝/測試書/卷一.md');
  assert.equal(hits[0].context, '試人者，【測試朝人】也。卒於');
  // 换行不影响：去掉空白后「也。卒於」跨行相邻。
  assert.equal(searchRawBook('測試書', /人也。卒於/, 5, 0, root).length, 1);
  assert.equal(searchRawBook('測試書', /测试朝人/, 5, 4, root).length, 0, '简体检索不到繁体正文');
});

test('整段读取从首次命中处起连续输出，并可续读', () => {
  assert.equal(readRawPassage('測試書', /測試朝人/, 6, 0, root)?.text, '測試朝人也。');
  assert.equal(readRawPassage('測試書', /測試朝人/, 6, 6, root)?.text, '卒於測試十年');
  assert.equal(readRawPassage('測試書', /測試朝人/, 500, 0, root)?.text.length, 17, '读到底为止');
  assert.equal(readRawPassage('測試書', /不在書裏/, 6, 0, root), undefined);
});

test('摘录校验区分逐字命中、未找到与非本地', () => {
  const evidence: ContentEvidence[] = [
    { id: 'ok', work: '測試書', locator: '卷一', excerpt: '測試人者，測試朝人也。' },
    { id: 'gap', work: '測試書', locator: '卷一', excerpt: '測試人者……年七十。' },
    { id: 'miss', work: '測試書', locator: '卷一', excerpt: '測試人者。生於他鄉。' },
    { id: 'far', work: '別書', locator: '卷二', excerpt: '任意文字' },
  ];
  const results = checkEvidence('someone', evidence, root);
  assert.deepEqual(
    results.map((item) => [item.evidenceId, item.status]),
    [
      ['ok', 'ok'],
      ['gap', 'ok'],
      ['miss', 'not-found'],
      ['far', 'not-local'],
    ],
  );
  assert.match(results[2].detail!, /生於他鄉/);
  assert.deepEqual(excerptSegments('甲。……乙…丙'), ['甲。', '乙', '丙']);
});

test('bio 不接受 Markdown 标题，详情页按空行分段，卡片只取首段', () => {
  const person: RegistryPerson = {
    id: 'fixture',
    name: '夹具',
    display: '夹具',
    profile: 'full',
    gender: 'male',
    polity: ['qin'],
    birthAccuracy: 'unknown',
    deathAccuracy: 'unknown',
    sources: [{ work: '測試書', part: '卷一', kind: 'classic' }],
    bio: '### 早年\n\n第一段。\n\n第二段。',
  };
  const messages = lintRegistryPerson(person, new Set(), new Set(['qin']), 'content/qin/fixture.md');
  assert.ok(messages.some((message) => message.message.includes('PERSON_BIO_HEADING')));
  assert.ok(
    !/PERSON_BIO_HEADING/.test(
      JSON.stringify(lintRegistryPerson({ ...person, bio: '第一段。\n\n第二段。' }, new Set(), new Set(['qin']), 'p')),
    ),
  );

  assert.deepEqual(bioParagraphs('第一段。\n\n第二段。\n\n\n第三段。\n'), ['第一段。', '第二段。', '第三段。']);
  assert.deepEqual(bioParagraphs(undefined), []);
  assert.equal(cardBio('第一段。\n\n第二段。'), '第一段。');
  assert.equal(cardBio('只有一段'), '只有一段');
  assert.equal(cardBio(undefined), undefined);
});

test('体检看板按分类词表回退主分类，并标出已升级人物', () => {
  const report = auditPeople(loadPipeline(resolve('pipeline')), 'song', { includePeople: true });
  assert.equal(report.byTopic.length, 1);
  const people = report.people ?? [];
  // 忽必烈的源文件没有写 primary，编译器按词表 rank 取到 monarch。
  const hubi = people.find((item) => item.id === 'hu-bi-lie');
  assert.equal(hubi?.primary, 'monarch');
  for (let index = 1; index < people.length; index += 1) {
    assert.ok(people[index - 1].priorityScore >= people[index].priorityScore);
  }
  const tang = auditPeople(loadPipeline(resolve('pipeline')), 'tang', { includePeople: true });
  assert.equal((tang.people ?? []).find((item) => item.id === 'li-long-ji')?.upgraded, true);
  assert.ok(tang.overall.upgradedCount > 0 && tang.overall.upgradedCount < tang.totalPeople);
});

test('批次工作目录：自检拦住坏摘录，审核绑定内容指纹，关系只合并已通过审核的提案', () => {
  const data = loadPipeline(join(root, 'pipeline'));
  const qin = data.topics.find((topic) => topic.meta.id === 'qin')!;
  const [id, otherId] = qin.people
    .map((person) => person.id)
    .filter((personId) => data.personPaths.get(personId)?.startsWith('content/qin/'));
  const canonical = readFileSync(join(root, data.personPaths.get(id)!), 'utf8');
  const batchId = 'test-batch-tools';
  const directory = join(root, 'workspace/content/raw', batchId);

  const init = initBatch(root, { id: batchId, description: '合成测试批次', author: 'fixture-writer', ids: [id] });
  assert.deepEqual(init.ids, [id]);
  assert.equal(readFileSync(join(directory, 'items', `${id}.md`), 'utf8'), canonical, '草稿从正式原文起步');

  const parsed = parsePersonMarkdown(canonical, data.personPaths.get(id)!).person!;
  const draft: RegistryPerson = {
    ...parsed,
    sources: [{ work: '測試書', part: '卷一', kind: 'classic' }],
    bio: `${parsed.bio ?? ''}\n\n第二段：卒於測試十年。`.trim(),
  };
  writeFileSync(join(directory, 'items', `${id}.md`), formatPersonMarkdown(draft));
  const sidecarPath = join(directory, 'items', `${id}.json`);
  const skeleton = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  assert.equal(skeleton.admission, '', 'init 只给空的理由与证据骨架');

  const facts = [
    'name',
    'gender',
    'polity',
    'categories',
    'primary',
    'birth',
    'birthAccuracy',
    'birthNote',
    'death',
    'deathAccuracy',
    'deathNote',
    'title',
    'tags',
    'aliases',
    'sources',
    'works',
    'experiences',
    'bio',
  ].filter((field) => draft[field as keyof RegistryPerson] !== undefined);
  const sidecar = (excerpt: string) => ({
    id,
    admission: '合成测试：为已登记人物补第二段传记。',
    evidence: [{ id: 'e1', work: '測試書', locator: '卷一', excerpt }],
    claims: [{ text: '全部字段依据合成原典。', fields: facts, sourceIds: ['e1'] }],
    relations: [{ topic: 'qin', source: id, target: otherId, type: 'peer', note: '同朝为官，合成测试' }],
  });
  writeFileSync(sidecarPath, JSON.stringify(sidecar('不在原典的句子')));
  const failed = checkItem(root, batchId, id);
  assert.equal(failed.ok, false);
  assert.ok(
    failed.problems.some((problem) => problem.startsWith('[EXCERPT]')),
    failed.problems.join('; '),
  );

  writeFileSync(sidecarPath, JSON.stringify({ ...sidecar('測試人者……年七十。'), admission: '' }));
  assert.ok(checkItem(root, batchId, id).problems.some((problem) => problem.includes('admission')));

  writeFileSync(sidecarPath, JSON.stringify(sidecar('測試人者……年七十。')));
  const passed = checkItem(root, batchId, id);
  assert.equal(passed.ok, true, passed.problems.join('; '));
  assert.equal(passed.evidence[0].status, 'ok');

  assert.equal(assembleBatch(root, batchId).items[id].state, 'awaiting-review', '没有审核结论就不进 batch.json');
  const reviewPath = join(directory, 'reviews', `${id}.json`);
  const review = (proposalHash: string) => ({
    reviewer: 'fixture-reviewer',
    decision: 'pass',
    reason: '合成测试审核结论。',
    proposalHash,
  });
  writeFileSync(reviewPath, JSON.stringify(review('stale')));
  assert.equal(assembleBatch(root, batchId).items[id].state, 'awaiting-review', '指纹不符的旧审核不采用');

  writeFileSync(reviewPath, JSON.stringify(review(passed.hash!)));
  assert.equal(assembleBatch(root, batchId).items[id].state, 'reviewed');
  const batch = JSON.parse(readFileSync(join(directory, 'batch.json'), 'utf8'));
  assert.equal(batch.items.length, 1);
  assert.equal(
    batch.items[0].review.reviewedProposal.after,
    batch.items[0].proposal.after,
    '审核快照由工具按当前候选生成',
  );
  const checked = checkPeopleBatch(batch, root);
  assert.equal(checked.items[0].state, 'ready', checked.items[0].reasons.join('; '));

  const topicPath = join(root, 'pipeline/topics/qin/topic.json');
  const before = JSON.parse(readFileSync(topicPath, 'utf8')).relations.length;
  assert.equal(mergeRelations(root, batchId, false)[0].state, 'added', '默认只预演');
  assert.equal(JSON.parse(readFileSync(topicPath, 'utf8')).relations.length, before);
  assert.equal(mergeRelations(root, batchId, true)[0].state, 'added');
  const merged = JSON.parse(readFileSync(topicPath, 'utf8')).relations;
  assert.equal(merged.length, before + 1);
  assert.equal(merged[merged.length - 1].note, '同朝为官，合成测试');
  assert.equal(mergeRelations(root, batchId, true)[0].state, 'exists', '重跑不重复写入');
  assert.equal(JSON.parse(readFileSync(topicPath, 'utf8')).relations.length, before + 1);
});

test('自检只对本条目造成的全局错误负责，仓库其他文件的错误单独列出', () => {
  const data = loadPipeline(join(root, 'pipeline'));
  const [id, otherId] = data.topics
    .find((topic) => topic.meta.id === 'qin')!
    .people.map((person) => person.id)
    .filter((personId) => data.personPaths.get(personId)?.startsWith('content/qin/'));
  const otherPath = join(root, data.personPaths.get(otherId)!);
  const original = readFileSync(otherPath, 'utf8');
  // 模拟另一个会话把小标题写进了不相关的人物文件。
  writeFileSync(otherPath, `${original.trimEnd()}\n\n### 小标题\n正文。\n`);
  try {
    const result = checkItem(root, 'test-batch-tools', id);
    assert.equal(result.ok, true, result.problems.join('; '));
    assert.ok(
      result.external.some((error) => error.includes(otherId) && error.includes('PERSON_BIO_HEADING')),
      result.external.join('; '),
    );
    // 整批的准入检查仍然要求全库无错。
    const batch = JSON.parse(readFileSync(join(root, 'workspace/content/raw/test-batch-tools/batch.json'), 'utf8'));
    assert.ok(checkPeopleBatch(batch, root).errors.length > 0);
  } finally {
    writeFileSync(otherPath, original);
  }
});
