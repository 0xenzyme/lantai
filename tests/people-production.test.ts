import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  symlinkSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseContentBatch, type ContentBatch, type ContentCandidate } from '../pipeline/content-batch';
import { applyPeopleBatch, checkPeopleBatch, preflightPeopleBatch } from '../pipeline/people-production';
import { formatPersonMarkdown, formatTopicIndex, parsePersonMarkdown, topicIndexRows } from '../pipeline/person-md';
import type { RegistryPerson } from '../pipeline/types';

const root = mkdtempSync(join(tmpdir(), 'lantai-people-admission-'));
cpSync(resolve('pipeline'), join(root, 'pipeline'), { recursive: true });
cpSync(resolve('content'), join(root, 'content'), { recursive: true });

const LEDGER_PATH = join(root, 'pipeline/topics/qin/candidates.json');
const TOPIC_JSON_PATH = join(root, 'pipeline/topics/qin/topic.json');
const INDEX_PATH = join(root, 'content/qin.md');
const originalLedger = readFileSync(LEDGER_PATH, 'utf8');
const originalTopicJson = readFileSync(TOPIC_JSON_PATH, 'utf8');
const originalIndex = readFileSync(INDEX_PATH, 'utf8');

afterEach(() => {
  writeFileSync(LEDGER_PATH, originalLedger);
  writeFileSync(TOPIC_JSON_PATH, originalTopicJson);
  writeFileSync(INDEX_PATH, originalIndex);
  rmSync(join(root, `content/qin/test-person.md`), { force: true });
  rmSync(join(root, 'workspace'), { recursive: true, force: true });
});
after(() => rmSync(root, { recursive: true, force: true }));

// Synthetic fixtures test admission mechanics, not historical truth.
function person(id = 'test-person', extra: Partial<RegistryPerson> = {}): RegistryPerson {
  return {
    id,
    name: '测试人',
    display: '测试人',
    profile: 'brief',
    gender: 'male',
    polity: ['qin'],
    birth: -220,
    birthAccuracy: 'exact',
    death: -200,
    deathAccuracy: 'exact',
    sources: [{ work: '测试甲书', part: '卷一', kind: 'classic' }],
    ...extra,
  };
}
function candidate(value = person(), before: string | null = null): ContentCandidate {
  const proposal = {
    id: value.id,
    operation: before === null ? ('publish' as const) : ('revise' as const),
    author: 'fixture-writer',
    before,
    after: formatPersonMarkdown(value),
    admission: '测试收录理由：占本专题官员席位，生卒有锚点。',
    evidence: value.sources!.map((s, i) => ({
      id: `s${i}`,
      work: s.work,
      locator: s.part!,
      excerpt: '测试摘录，仅用于自动化负例与正例。',
    })),
    claims: [
      {
        text: '测试字段支持映射。',
        fields: ['name', 'gender', 'polity', 'birth', 'birthAccuracy', 'death', 'deathAccuracy', 'sources'],
        sourceIds: ['s0'],
      },
    ],
  };
  return {
    proposal,
    review: {
      reviewer: 'fixture-reviewer',
      decision: 'pass',
      reason: '测试审核结论',
      reviewedProposal: structuredClone(proposal),
    },
  };
}
function batch(...items: ContentCandidate[]): ContentBatch {
  return {
    schemaVersion: 2,
    id: 'test-people-batch',
    scope: { description: '仅测试候选', personIds: items.map((i) => i.proposal.id) },
    items,
  };
}
/** 把 publish 候选登记进专题台账（lint 要求 pending 有 anchor 与可靠出处）。 */
function seedLedger(id = 'test-person', seat = 'qin-official'): void {
  const ledger = JSON.parse(originalLedger) as {
    people: Array<Record<string, unknown>>;
  };
  ledger.people.push({
    id,
    name: '测试人',
    seat,
    status: 'pending',
    anchor: '卒 -200（exact）；测试锚点',
    sources: [{ work: '测试甲书', part: '卷一', kind: 'classic' }],
  });
  writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
}
/** 把人物写进 canonical 并同步重建专题索引，保持 loadPipeline 的严格一致性。 */
function seedPersonFile(value: RegistryPerson): string {
  const text = formatPersonMarkdown(value);
  writeFileSync(join(root, `content/qin/${value.id}.md`), text);
  const topic = JSON.parse(originalTopicJson) as { meta: { title: string }; people: Array<{ id: string }> };
  const names = readdirSync(join(root, 'content/qin'))
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .sort();
  const files = names.map((name) =>
    parsePersonMarkdown(readFileSync(join(root, 'content/qin', name), 'utf8'), `content/qin/${name}`),
  );
  const rows = topicIndexRows(
    topic.people.map((overlay) => overlay.id),
    files,
  );
  if (!rows) throw new Error('夹具索引生成失败');
  writeFileSync(INDEX_PATH, formatTopicIndex('qin', topic.meta.title, rows));
  return text;
}
function reasons(value: ContentBatch): string {
  const result = checkPeopleBatch(value, root);
  return JSON.stringify([result.items, result.errors]);
}

test('检查可发布候选只读，不要求写入文件', () => {
  seedLedger();
  const result = checkPeopleBatch(batch(candidate()), root);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.items[0].state, 'ready');
  assert.equal(existsSync(join(root, 'content/qin/test-person.md')), false);
  assert.equal(existsSync(join(root, 'workspace')), false);
});

test('缺审核、自审与候选变化均进入 pending', () => {
  seedLedger();
  const item = candidate();
  delete item.review;
  assert.match(reasons(batch(item)), /尚无独立审核/);
  const self = candidate();
  self.review!.reviewer = self.proposal.author;
  assert.match(reasons(batch(self)), /起草者不能/);
  const changed = candidate();
  changed.proposal.evidence[0].excerpt = '修改后的摘录';
  assert.match(reasons(batch(changed)), /STALE_REVIEW/);
});

test('新人物必须经过候选台账 intake', () => {
  assert.match(reasons(batch(candidate())), /INTAKE/);
});

test('publish 应用：写文件、登记泳道、消耗台账、重写索引', () => {
  seedLedger();
  const input = batch(candidate());
  const result = applyPeopleBatch(input, root, () => []);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.appliedIds, ['test-person']);
  assert.equal(result.verification, 'passed');
  assert.match(readFileSync(join(root, 'content/qin/test-person.md'), 'utf8'), /test-person/);
  const topic = JSON.parse(readFileSync(TOPIC_JSON_PATH, 'utf8')) as {
    people: Array<{ id: string; lane: string }>;
  };
  assert.deepEqual(
    topic.people.find((p) => p.id === 'test-person'),
    { id: 'test-person', lane: 'qin-official' },
  );
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as { people: Array<{ id: string }> };
  assert.equal(
    ledger.people.some((entry) => entry.id === 'test-person'),
    false,
  );
  assert.match(readFileSync(INDEX_PATH, 'utf8'), /test-person/);
});

test('revise 升级详表可通过，关系汇总告警按稳定键比较', () => {
  const before = seedPersonFile(person('test-person'));
  const full = person('test-person', {
    profile: 'full',
    title: '测试头衔',
    tags: ['测试'],
    categories: ['official'],
    bio: '测试 bio：身份、关系与上轴理由。',
  });
  const item = candidate(full, before);
  item.proposal.claims.push({
    text: '详表字段支持映射。',
    fields: ['title', 'tags', 'categories', 'bio'],
    sourceIds: ['s0'],
  });
  item.review!.reviewedProposal = structuredClone(item.proposal);
  const result = applyPeopleBatch(batch(item), root, () => []);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(readFileSync(join(root, 'content/qin/test-person.md'), 'utf8'), /profile: full/);
});

test('自身 lint 错误与新增 warning 阻断准入', () => {
  seedLedger();
  const bad = person('test-person', { birth: 300, death: 240 });
  assert.match(reasons(batch(candidate(bad))), /生年晚于卒年/);
  seedLedger();
  const fullNoRelations = person('test-person', { profile: 'full', bio: '测试 bio。', categories: ['official'] });
  const item = candidate(fullNoRelations);
  item.proposal.claims.push({
    text: '详表字段支持映射。',
    fields: ['bio', 'categories'],
    sourceIds: ['s0'],
  });
  item.review!.reviewedProposal = structuredClone(item.proposal);
  const result = checkPeopleBatch(batch(item), root);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('已登记人物不能用 publish 覆盖', () => {
  seedPersonFile(person('test-person', { death: -190 }));
  assert.match(reasons(batch(candidate())), /人物已登记/);
});

test('源文件漂移进入 pending，保留当前文件', () => {
  seedPersonFile(person('test-person', { death: -190 }));
  const result = checkPeopleBatch(batch(candidate()), root);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.items), /CONFLICT/);
});

test('事实字段缺 claim 映射与出处缺证据均拦截', () => {
  seedLedger();
  const item = candidate();
  item.proposal.claims[0].fields = ['name'];
  item.review!.reviewedProposal = structuredClone(item.proposal);
  assert.match(reasons(batch(item)), /缺少 death 的依据映射/);
  const noEvidence = candidate();
  noEvidence.proposal.evidence = [];
  noEvidence.proposal.claims = [];
  noEvidence.review!.reviewedProposal = structuredClone(noEvidence.proposal);
  assert.match(reasons(batch(noEvidence)), /EVIDENCE/);
});

test('事件批次的 scope 被人物工具拒绝', () => {
  const input = batch(candidate());
  input.scope = { description: '事件范围', eventIds: ['test-person'] };
  assert.throws(() => checkPeopleBatch(input, root), /scope/);
});

test('部分通过只应用合格项，pending 保留并可恢复', () => {
  seedLedger();
  const yes = candidate();
  const no = candidate(person('test-person-2'));
  delete no.review;
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as { people: Array<Record<string, unknown>> };
  ledger.people.push({
    id: 'test-person-2',
    name: '测试人二',
    seat: 'qin-official',
    status: 'pending',
    anchor: '卒 -200（exact）；测试锚点',
    sources: [{ work: '测试甲书', part: '卷一', kind: 'classic' }],
  });
  writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
  const result = applyPeopleBatch(batch(yes, no), root, () => []);
  assert.deepEqual(result.appliedIds, ['test-person']);
  assert.equal(result.ok, false);
  assert.equal(existsSync(join(root, 'content/qin/test-person-2.md')), false);
  const pending = parseContentBatch(
    JSON.parse(readFileSync(join(root, 'workspace/content/pending/test-people-batch/batch.json'), 'utf8')),
  );
  assert.deepEqual(
    pending.items.map((item) => item.proposal.id),
    ['test-person-2'],
  );
  // 补齐审核后重跑 pending 子集。
  pending.items[0].review = {
    reviewer: 'fixture-reviewer',
    decision: 'pass',
    reason: '补审核',
    reviewedProposal: structuredClone(pending.items[0].proposal),
  };
  const resumed = applyPeopleBatch(pending, root, () => []);
  assert.deepEqual(resumed.appliedIds, ['test-person-2']);
  assert.equal(resumed.items.find((row) => row.id === 'test-person')?.state, 'already-applied');
  rmSync(join(root, 'content/qin/test-person-2.md'), { force: true });
});

test('验证失败保留已应用事实，重跑同一批次仅验证不重复写入', () => {
  seedLedger();
  const input = batch(candidate());
  const failed = applyPeopleBatch(input, root, () => ['模拟 build 失败']);
  assert.equal(failed.verification, 'failed');
  assert.equal(failed.ok, false);
  const resumed = applyPeopleBatch(input, root, () => []);
  assert.equal(resumed.verification, 'passed');
  assert.deepEqual(resumed.appliedIds, []);
  assert.equal(resumed.items[0].state, 'already-applied');
});

test('源文件已写但 bookkeeping 未做的中断可恢复', () => {
  seedLedger();
  const input = batch(candidate());
  writeFileSync(join(root, 'content/qin/test-person.md'), input.items[0].proposal.after);
  const result = applyPeopleBatch(input, root, () => []);
  assert.equal(result.verification, 'passed', JSON.stringify(result));
  assert.equal(result.items[0].state, 'already-applied');
  const topic = JSON.parse(readFileSync(TOPIC_JSON_PATH, 'utf8')) as {
    people: Array<{ id: string; lane: string }>;
  };
  assert.ok(topic.people.some((p) => p.id === 'test-person'));
  assert.match(readFileSync(INDEX_PATH, 'utf8'), /test-person/);
});

test('畸形批次在写入前拒绝', () => {
  seedLedger();
  const input = batch(candidate());
  input.items.push(input.items[0]);
  assert.throws(() => applyPeopleBatch(input, root), /重复/);
  const escape = batch(candidate());
  escape.id = '../escape';
  assert.throws(() => applyPeopleBatch(escape, root), /kebab/);
  assert.equal(existsSync(join(root, 'workspace')), false);
});

test('符号链接 canonical 和 workspace 不能作为写入路径', () => {
  seedLedger();
  const outside = join(root, 'outside.md');
  writeFileSync(outside, 'keep');
  symlinkSync(outside, join(root, 'content/qin/test-person.md'));
  assert.equal(checkPeopleBatch(batch(candidate()), root).ok, false);
  assert.equal(readFileSync(outside, 'utf8'), 'keep');
  mkdirSync(join(root, 'outside'), { recursive: true });
  symlinkSync(join(root, 'outside'), join(root, 'workspace'));
  assert.throws(() => applyPeopleBatch(batch(candidate()), root), /符号链接/);
});

test('人工交接：无审核预检可通过，但准入与应用仍拒绝', () => {
  seedLedger();
  const item = candidate();
  delete item.review;
  const input = batch(item);
  const result = preflightPeopleBatch(input, root);
  assert.equal(result.checksPassed, true);
  assert.equal(result.admissionGranted, false);
  assert.equal(result.items[0].state, 'awaiting-review');
  assert.equal(checkPeopleBatch(input, root).ok, false);
  const applied = applyPeopleBatch(input, root);
  assert.deepEqual(applied.appliedIds, []);
  assert.equal(existsSync(join(root, 'content/qin/test-person.md')), false);
  assert.match(
    readFileSync(join(root, 'workspace/content/pending/test-people-batch/reasons.json'), 'utf8'),
    /尚无独立审核/,
  );
});
