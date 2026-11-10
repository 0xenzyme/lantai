import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  openSync,
  closeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';

import { compileAll, compileEventDetails, compilePersonDetails, compileCollectionDetails } from './compile';
import {
  parseContentBatch,
  reviewProblems,
  type AdmissionItem,
  type ApplyResult,
  type ContentBatch,
  type ContentCandidate,
  type ContentProposal,
  type PublishCheckResult,
} from './content-batch';
import { atomicJson, atomicText, readText, safePath } from './content-io';
import { lintPipeline, lintRegistryPerson } from './lint';
import { loadPipeline } from './load';
import { formatTopicIndex, parsePersonMarkdown, topicIndexRows, type TopicIndexContext } from './person-md';
import type { CandidateEntry, PipelineData, RegistryPerson, LintMessage } from './types';

export type { AdmissionItem, ApplyResult, PublishCheckResult };

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 已维护事实字段都需要 claim 依据映射；display 是展示短名，profile 是结构性标记，均不要求独立史实 claim。 */
const PERSON_CLAIM_FACTS = [
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
];

interface PersonPlan {
  person: RegistryPerson;
  topicId: string;
  /** publish：从候选台账 seat 取泳道，应用时写入 topic.json people。 */
  lane?: string;
  /** publish：应用后从候选台账移除该 pending 条目。 */
  consumeCandidate: boolean;
  /** already-applied 恢复计划：只投影 bookkeeping 后状态，不重复跑收录 lint。 */
  recovered?: boolean;
}

function canonicalPersonPath(topicId: string, id: string): string {
  return `content/${topicId}/${id}.md`;
}

function personEvidenceProblems(candidate: ContentCandidate, person: RegistryPerson): string[] {
  const p = candidate.proposal;
  const problems: string[] = [];
  for (const field of PERSON_CLAIM_FACTS) {
    if (
      person[field as keyof RegistryPerson] !== undefined &&
      !p.claims.some((claim) => claim.fields.includes(field))
    ) {
      problems.push(`[CLAIM] 缺少 ${field} 的依据映射`);
    }
  }
  for (const source of person.sources ?? []) {
    if (!p.evidence.some((e) => e.work === source.work && (!source.part || e.locator.includes(source.part)))) {
      problems.push(`[EVIDENCE] 缺少 ${source.work} ${source.part ?? ''} 的定位与必要摘录`);
    }
  }
  return problems;
}

/** 新人物必须来自某一个专题候选台账里的 pending 条目；返回条目与所属专题。 */
function findPendingCandidate(data: PipelineData, id: string): { topicId: string; entry: CandidateEntry } | string {
  const hits: Array<{ topicId: string; entry: CandidateEntry }> = [];
  for (const topic of data.topics) {
    const entry = (data.candidates.get(topic.meta.id) ?? []).find(
      (item) => item.id === id && item.status === 'pending',
    );
    if (entry) hits.push({ topicId: topic.meta.id, entry });
  }
  if (hits.length === 0) return '[INTAKE] 新人物必须先在 pipeline/topics/<id>/candidates.json 记为 pending';
  if (hits.length > 1) return `[INTAKE] 候选 ${id} 在多个专题台账里 pending，先人工裁撤`;
  return hits[0];
}

/** 修订目标必须是已登记的 Markdown 人物；返回所在专题。legacy registry JSON 不在本工具范围内。 */
function findRegisteredTopic(data: PipelineData, id: string): string | undefined {
  const match = /^content\/([a-z0-9-]+)\/[a-z0-9-]+\.md$/.exec(data.personPaths.get(id) ?? '');
  return match?.[1];
}

function buildPlan(data: PipelineData, candidate: ContentCandidate): { plan?: PersonPlan; problems: string[] } {
  const p = candidate.proposal;
  const problems: string[] = [];
  let topicId: string | undefined;
  let lane: string | undefined;
  let consumeCandidate = false;

  if (p.operation === 'publish') {
    if (p.before !== null) problems.push('[OPERATION] publish 只接受新人物，before 应为 null');
    if (data.people.has(p.id)) problems.push('[OPERATION] 人物已登记，请使用 revise');
    const pending = findPendingCandidate(data, p.id);
    if (typeof pending === 'string') problems.push(pending);
    else {
      topicId = pending.topicId;
      lane = pending.entry.seat;
      consumeCandidate = true;
    }
  } else {
    if (p.before === null) problems.push('[OPERATION] revise 需要当前原文，before 不能为 null');
    topicId = findRegisteredTopic(data, p.id);
    if (!topicId) problems.push('[OPERATION] 只能修订已登记的 Markdown 人物');
  }
  if (p.before === p.after) problems.push('[NO_CHANGE] 候选没有修改');

  const path = canonicalPersonPath(topicId ?? data.order[0], p.id);
  const parsed = parsePersonMarkdown(p.after, path);
  problems.push(...parsed.messages.filter((m) => m.level === 'error').map((m) => m.message));
  const person = parsed.person;
  if (problems.length === 0 && !person) problems.push('[PARSE] 不能解析候选');

  if (person && topicId) {
    if (p.operation === 'revise') {
      const before = parsePersonMarkdown(p.before!, path);
      if (before.messages.some((m) => m.level === 'error')) problems.push('[BASE] before 必须是可解析且格式正确的原文');
    }
    if (lane) {
      const topic = data.topics.find((t) => t.meta.id === topicId)!;
      if (!topic.lanes.some((l) => l.id === lane)) problems.push(`[LANE] 泳道 ${lane} 不在专题 ${topicId} 里`);
    }
    const categoryIds = new Set(data.categories.map((c) => c.id));
    const polityIds = new Set(data.polities.map((v) => v.id));
    const linted = lintRegistryPerson(person, categoryIds, polityIds, path);
    problems.push(...linted.filter((m) => m.level === 'error').map((m) => m.message));
    problems.push(...personEvidenceProblems(candidate, person));
  }
  if (problems.length > 0 || !person || !topicId) return { problems };
  return { plan: { person, topicId, lane, consumeCandidate }, problems };
}

function projectPeople(data: PipelineData, plans: Map<string, PersonPlan>): PipelineData {
  const people = new Map(data.people);
  const personPaths = new Map(data.personPaths);
  const candidates = new Map(data.candidates);
  const topics = data.topics.map((topic) => ({ ...topic, people: [...topic.people] }));
  for (const [id, plan] of plans) {
    people.set(id, plan.person);
    personPaths.set(id, canonicalPersonPath(plan.topicId, id));
    if (plan.consumeCandidate) {
      candidates.set(
        plan.topicId,
        (candidates.get(plan.topicId) ?? []).filter((entry) => entry.id !== id),
      );
    }
    if (plan.lane) {
      const topic = topics.find((t) => t.meta.id === plan.topicId);
      if (topic && !topic.people.some((person) => person.id === id)) {
        topic.people.push({ id, lane: plan.lane! });
      }
    }
  }
  return { ...data, people, personPaths, candidates, topics };
}

/**
 * 「详表尚未写关系」按专题汇总的队列深度会随批次增减。PLAYBOOK 明确它不拒绝编译，
 * 关系由人在 topic.json 另行收录，所以准入差分把它整体排除，不当新增 warning。
 */
const RELATIONS_QUEUE = /^详表尚未写关系 \d+ 人：/;

function warningKey(message: LintMessage): string {
  return JSON.stringify(message);
}

function validateProjection(data: PipelineData): LintMessage[] {
  const { catalog, topics, events } = compileAll(data);
  const messages = lintPipeline(data, topics, catalog);
  compileEventDetails(data, events);
  compilePersonDetails(data, events);
  compileCollectionDetails(data, events);
  return messages;
}

/** 从磁盘解析候选目标专题；check 阶段用加载后的 data，apply 内部直接读盘。 */
function resolveTopicForProposal(
  root: string,
  data: PipelineData | null,
  proposal: ContentProposal,
): string | undefined {
  if (data && proposal.operation === 'revise') return findRegisteredTopic(data, proposal.id);
  const order = JSON.parse(readFileSync(safePath(root, 'pipeline/topics.json'), 'utf8')) as string[];
  // 1) 文件所在专题是 canonical 真值，覆盖已应用恢复与修订。
  for (const topicId of order) {
    if (existsSync(safePath(root, canonicalPersonPath(topicId, proposal.id)))) return topicId;
  }
  // 2) 未应用的 publish 候选：pending 台账。
  for (const topicId of order) {
    const ledgerPath = safePath(root, `pipeline/topics/${topicId}/candidates.json`);
    if (!existsSync(ledgerPath)) continue;
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as { people: CandidateEntry[] };
    if (ledger.people.some((entry) => entry.id === proposal.id && entry.status === 'pending')) return topicId;
  }
  // 3) 台账已消耗但 bookkeeping 已完成：topic.json people。
  for (const topicId of order) {
    const topic = JSON.parse(readFileSync(safePath(root, `pipeline/topics/${topicId}/topic.json`), 'utf8')) as {
      people: Array<{ id: string }>;
    };
    if (topic.people.some((person) => person.id === proposal.id)) return topicId;
  }
  return undefined;
}

function inspectPeopleBatch(batch: ContentBatch, root: string, requireReview: boolean): PublishCheckResult {
  // Revalidate callers as well as CLI input.
  parseContentBatch(batch);
  if (!batch.scope.personIds?.length) throw new Error('[SCOPE] 人物批次需要非空的 scope.personIds');
  const result: PublishCheckResult = { ok: false, batchId: batch.id, items: [], errors: [], warnings: [] };
  let data: PipelineData;
  try {
    const resuming = batch.items.some((item) => {
      if (reviewProblems(item).length !== 0) return false;
      const topicId = resolveTopicForProposal(root, null, item.proposal);
      return (
        topicId !== undefined &&
        readText(safePath(root, canonicalPersonPath(topicId, item.proposal.id))) === item.proposal.after
      );
    });
    data = loadPipeline(join(root, 'pipeline'), { allowTopicIndexDrift: resuming });
  } catch (error) {
    result.errors.push(`[BASELINE] ${String(error)}`);
    result.items = batch.items.map(({ proposal }) => ({
      id: proposal.id,
      state: 'pending',
      reasons: [...result.errors],
    }));
    return result;
  }

  const plans = new Map<string, PersonPlan>();
  for (const candidate of batch.items) {
    const p = candidate.proposal;
    const reasons = reviewProblems(candidate, requireReview);
    const row: AdmissionItem = { id: p.id, state: 'pending', reasons };
    result.items.push(row);
    try {
      const topicId =
        resolveTopicForProposal(root, data, candidate.proposal) ??
        resolveTopicForProposal(root, null, candidate.proposal);
      const current = topicId ? readText(safePath(root, canonicalPersonPath(topicId, p.id))) : null;
      // 已应用恢复：正式内容等于 after 时，台账与 topic.json 可能已改写或仍待补齐。
      // 用恢复计划投影「应用完成后的状态」，使中断窗口（文件已写、台账未消耗）不阻断恢复。
      if (current !== null && current === p.after) {
        if (reasons.length === 0) {
          row.state = 'already-applied';
          const person = data.people.get(p.id);
          if (person && topicId) {
            const ledger = data.candidates.get(topicId) ?? [];
            const entry = ledger.find((item) => item.id === p.id && item.status === 'pending');
            plans.set(p.id, {
              person,
              topicId,
              lane: entry?.seat,
              consumeCandidate: entry !== undefined,
              recovered: true,
            });
          }
        }
        continue;
      }
      if (current !== p.before) reasons.push('[CONFLICT] 正式文件与候选基线不同，保留当前文件');
      const { plan, problems } = buildPlan(data, candidate);
      reasons.push(...problems);
      if (reasons.length === 0 && plan) {
        row.state = 'ready';
        plans.set(p.id, plan);
      }
    } catch (error) {
      reasons.push(`[CANDIDATE] ${String(error)}`);
    }
  }

  // 新建和重新整理的人物须清除自身 lint 信息；跨实体影响交给下面的全局投影。
  const categoryIds = new Set(data.categories.map((c) => c.id));
  const polityIds = new Set(data.polities.map((v) => v.id));
  for (const row of result.items) {
    const plan = plans.get(row.id);
    if (!plan || plan.recovered) continue;
    const messages = lintRegistryPerson(plan.person, categoryIds, polityIds, canonicalPersonPath(plan.topicId, row.id));
    if (messages.length) {
      row.reasons.push(...messages.map((m) => `${m.level}: ${m.message}`));
      row.state = 'pending';
      plans.delete(row.id);
    }
  }
  try {
    const baseline = validateProjection(data);
    const baselineWarnings = new Set(
      baseline.filter((m) => m.level === 'warning' && !RELATIONS_QUEUE.test(m.message)).map(warningKey),
    );
    const projected = validateProjection(projectPeople(data, plans));
    result.warnings = projected.filter((m) => m.level === 'warning');
    const blocking = projected.filter(
      (m) => m.level === 'error' || (!RELATIONS_QUEUE.test(m.message) && !baselineWarnings.has(warningKey(m))),
    );
    if (blocking.length) result.errors.push(...blocking.map((m) => `${m.path}: ${m.message}`));
  } catch (error) {
    result.errors.push(`[PROJECTION] ${String(error)}`);
  }
  if (result.errors.length) {
    for (const row of result.items) {
      if (row.state !== 'pending') {
        row.state = 'pending';
        row.reasons.push(...result.errors);
      }
    }
  }
  result.ok = result.errors.length === 0 && result.items.every((row) => row.state !== 'pending');
  return result;
}

/** Admission always requires an independent review. */
export function checkPeopleBatch(batch: ContentBatch, root = repoRoot): PublishCheckResult {
  return inspectPeopleBatch(batch, root, true);
}

/** Writer-only structural preflight; never produces an admission or writes files. */
export function preflightPeopleBatch(batch: ContentBatch, root = repoRoot) {
  const result = inspectPeopleBatch(batch, root, false);
  return {
    kind: 'preflight' as const,
    batchId: result.batchId,
    checksPassed: result.ok,
    admissionGranted: false as const,
    items: result.items.map((item) => ({
      ...item,
      state:
        item.state === 'pending'
          ? ('needs-revision' as const)
          : item.state === 'already-applied'
            ? ('already-applied' as const)
            : ('awaiting-review' as const),
    })),
    errors: result.errors,
    warnings: result.warnings,
  };
}

export function runPeoplePublishCheck(batchPath: string, root = repoRoot): PublishCheckResult {
  return checkPeopleBatch(parseContentBatch(JSON.parse(readFileSync(batchPath, 'utf8'))), root);
}

function appendTopicPerson(root: string, topicId: string, id: string, lane: string): boolean {
  const path = `pipeline/topics/${topicId}/topic.json`;
  const topic = JSON.parse(readFileSync(safePath(root, path), 'utf8')) as {
    people: Array<{ id: string; lane: string }>;
  };
  if (topic.people.some((person) => person.id === id)) return false;
  topic.people.push({ id, lane });
  atomicJson(root, path, topic);
  return true;
}

function consumeCandidate(root: string, topicId: string, id: string): boolean {
  const path = `pipeline/topics/${topicId}/candidates.json`;
  const ledger = JSON.parse(readFileSync(safePath(root, path), 'utf8')) as { people: CandidateEntry[] };
  const next = ledger.people.filter((entry) => entry.id !== id);
  if (next.length === ledger.people.length) return false;
  atomicJson(root, path, { ...ledger, people: next });
  return true;
}

function topicContextsFromDisk(root: string): TopicIndexContext[] {
  const order = JSON.parse(readFileSync(safePath(root, 'pipeline/topics.json'), 'utf8')) as string[];
  return order.map((id) => {
    const topic = JSON.parse(readFileSync(safePath(root, `pipeline/topics/${id}/topic.json`), 'utf8')) as {
      meta: { title: string };
      people: Array<{ id: string }>;
    };
    return { id, title: topic.meta.title, people: topic.people.map((person) => person.id) };
  });
}

/** 只重写受影响专题的索引；索引无法生成时中断，已应用项保留，重跑本批次补齐。 */
function rewriteTopicIndex(root: string, topic: TopicIndexContext): void {
  const directory = join(root, 'content', topic.id);
  if (!existsSync(directory)) return;
  const names = readdirSync(directory)
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .sort();
  const files = names.map((name) =>
    parsePersonMarkdown(readFileSync(join(directory, name), 'utf8'), `content/${topic.id}/${name}`),
  );
  const rows = topicIndexRows(topic.people, files);
  if (!rows) throw new Error(`专题 ${topic.id} 索引无法生成；已应用项保留，修复后重新执行本批次`);
  atomicText(root, `content/${topic.id}.md`, formatTopicIndex(topic.id, topic.title, rows));
}

/** Apply only ready candidates. A global projection error blocks all writes to canonical sources. */
export function applyPeopleBatch(batch: ContentBatch, root = repoRoot, verify?: () => string[]): ApplyResult {
  parseContentBatch(batch);
  const lock = safePath(root, 'workspace/content/.apply.lock');
  mkdirSync(dirname(lock), { recursive: true });
  const fd = openSync(lock, 'wx');
  try {
    writeFileSync(fd, `${process.pid}\n`);
    const rawPath = `workspace/content/raw/${batch.id}/batch.json`;
    const pendingPath = `workspace/content/pending/${batch.id}/batch.json`;
    const resultPath = `workspace/content/raw/${batch.id}/result.json`;
    const acceptedPath = `workspace/content/raw/${batch.id}/accepted.json`;
    const acceptedText = readText(safePath(root, acceptedPath));
    const accepted = acceptedText === null ? [] : parseContentBatch(JSON.parse(acceptedText)).items;
    for (const item of batch.items) {
      const fixed = accepted.find((entry) => entry.proposal.id === item.proposal.id);
      if (fixed && !isDeepStrictEqual(fixed, item)) {
        throw new Error(`候选 ${item.proposal.id} 已接受，新的修订请使用新批次 id，保留原审核依据`);
      }
    }
    const previous = readText(safePath(root, rawPath));
    if (previous !== null) {
      const old = parseContentBatch(JSON.parse(previous));
      if (!isDeepStrictEqual(old.scope, batch.scope)) throw new Error('同一批次 id 的 scope 已变化，请使用新批次 id');
      const items = new Map(old.items.map((item) => [item.proposal.id, item]));
      for (const item of batch.items) {
        const previousItem = items.get(item.proposal.id);
        const topicId = resolveTopicForProposal(root, null, item.proposal);
        if (
          previousItem &&
          topicId &&
          readText(safePath(root, canonicalPersonPath(topicId, item.proposal.id))) === previousItem.proposal.after &&
          !isDeepStrictEqual(previousItem.proposal, item.proposal)
        ) {
          throw new Error(`候选 ${item.proposal.id} 已应用，新的修订请使用新批次 id，保留原审核依据`);
        }
        items.set(item.proposal.id, item);
      }
      batch = { ...batch, items: [...items.values()] };
    }
    const checked = checkPeopleBatch(batch, root);
    const result: ApplyResult = { ...checked, appliedIds: [], verification: 'not-run' };
    const acceptedById = new Map(accepted.map((item) => [item.proposal.id, item]));
    for (const item of batch.items) {
      if (checked.items.some((row) => row.id === item.proposal.id && row.state !== 'pending')) {
        acceptedById.set(item.proposal.id, item);
      }
    }
    // Preserve accepted content and review before canonical writes; subsequent drift cannot erase it.
    if (acceptedById.size) atomicJson(root, acceptedPath, { ...batch, items: [...acceptedById.values()] });
    atomicJson(root, rawPath, batch);
    const pendingIds = new Set(result.items.filter((row) => row.state === 'pending').map((row) => row.id));
    const pending = batch.items.filter((item) => pendingIds.has(item.proposal.id));
    if (pending.length) atomicJson(root, pendingPath, { ...batch, items: pending });
    atomicJson(root, resultPath, result);
    const ready = batch.items.filter((item) =>
      result.items.some((row) => row.id === item.proposal.id && row.state === 'ready'),
    );
    // Recheck all targets before the first write. Unrelated files do not participate in this check.
    for (const { proposal: p } of ready) {
      const topicId = resolveTopicForProposal(root, null, p);
      if (!topicId) throw new Error(`候选 ${p.id} 无法解析目标专题，停止应用`);
      if (readText(safePath(root, canonicalPersonPath(topicId, p.id))) !== p.before)
        throw new Error(`候选 ${p.id} 在预检后变化，停止应用`);
    }
    const affectedTopics = new Set<string>();
    for (const { proposal: p } of ready) {
      // Recheck immediately before each write; interrupted application resumes by comparing exact after content.
      const topicId = resolveTopicForProposal(root, null, p)!;
      const path = canonicalPersonPath(topicId, p.id);
      if (readText(safePath(root, path)) !== p.before) throw new Error(`候选 ${p.id} 在写入前变化，停止应用`);
      atomicText(root, path, p.after);
      result.appliedIds.push(p.id);
      affectedTopics.add(topicId);
      atomicJson(root, resultPath, result);
    }
    // Bookkeeping: lane entry into topic.json, then candidate ledger removal.
    // already-applied 项也执行：中断在文件写入之后、bookkeeping 之前的恢复靠这里补齐，均为幂等检查。
    const appliedIds = new Set([
      ...result.appliedIds,
      ...result.items.filter((row) => row.state === 'already-applied').map((row) => row.id),
    ]);
    for (const { proposal: p } of batch.items) {
      if (!appliedIds.has(p.id)) continue;
      const topicId = resolveTopicForProposal(root, null, p);
      if (!topicId) continue;
      affectedTopics.add(topicId);
      if (p.operation !== 'publish') continue;
      const lane = findPendingLane(root, topicId, p.id);
      if (lane) appendTopicPerson(root, topicId, p.id, lane);
      consumeCandidate(root, topicId, p.id);
    }
    if (ready.length || result.items.some((row) => row.state === 'already-applied')) {
      // Only regenerate affected topic indexes, never format unrelated canonical sources.
      const contexts = topicContextsFromDisk(root);
      for (const topicId of affectedTopics) {
        const context = contexts.find((topic) => topic.id === topicId);
        if (context) rewriteTopicIndex(root, context);
      }
    }
    if (pending.length === 0 && existsSync(safePath(root, pendingPath))) unlinkSync(safePath(root, pendingPath));
    if (verify && (result.appliedIds.length || result.items.some((row) => row.state === 'already-applied'))) {
      try {
        result.errors.push(...verify());
      } catch (error) {
        result.errors.push(`[VERIFY] ${String(error)}`);
      }
      result.verification = result.errors.length ? 'failed' : 'passed';
      if (result.verification === 'failed') result.ok = false;
    }
    atomicJson(root, resultPath, result);
    atomicJson(
      root,
      `workspace/content/pending/${batch.id}/reasons.json`,
      result.items.filter((row) => row.state === 'pending'),
    );
    return result;
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

function findPendingLane(root: string, topicId: string, id: string): string | undefined {
  const ledger = JSON.parse(readFileSync(safePath(root, `pipeline/topics/${topicId}/candidates.json`), 'utf8')) as {
    people: CandidateEntry[];
  };
  return ledger.people.find((entry) => entry.id === id && entry.status === 'pending')?.seat;
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || args.includes('--help') || !command) {
    console.log(
      '用法：tsx pipeline/people-production.ts preflight|publish-check|apply --batch <batch.json> [--json]\npreflight 只读且不要求 review；publish-check 要求独立审核；apply 分流、应用通过项并运行 content 与 build。',
    );
    return;
  }
  let path = '';
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--batch') path = args[++i] ?? '';
    else if (args[i] === '--json') json = true;
    else throw new Error(`未知参数 ${args[i]}`);
  }
  if (!path || !['preflight', 'publish-check', 'apply'].includes(command))
    throw new Error('需要 preflight|publish-check|apply --batch <batch.json>');
  const batch = parseContentBatch(JSON.parse(readFileSync(resolve(path), 'utf8')));
  if (command === 'preflight') {
    const result = preflightPeopleBatch(batch);
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      for (const item of result.items) console.log(`${item.state} ${item.id}: ${item.reasons.join('; ')}`);
      for (const error of result.errors) console.error(error);
      console.log('仅完成机器预检，未授予准入。已应用项不重写审核历史；未应用项交给独立审核会话：');
      console.log(
        `使用项目 people-review Skill 独立审核批次 ${resolve(path)}；核对史料并记录审核结论，再运行准入工具应用通过项，保留 pending。`,
      );
    }
    if (!result.checksPassed) process.exitCode = 1;
    return;
  }
  let result: PublishCheckResult | ApplyResult;
  if (command === 'apply') {
    result = applyPeopleBatch(batch, repoRoot, () => {
      for (const script of ['content', 'build']) {
        const run = spawnSync('npm', ['run', script], { cwd: repoRoot, encoding: 'utf8' });
        if (!json) {
          process.stdout.write(run.stdout ?? '');
          process.stderr.write(run.stderr ?? '');
        }
        if (run.status !== 0 || run.error) {
          if (json) process.stderr.write((run.stderr || run.stdout || '').slice(-6000));
          return [
            `[VERIFY:${script}] ${run.error?.message ?? `exit ${run.status}`}，已写入源文件但未验证完成；修复后重跑同一批次`,
          ];
        }
      }
      return [];
    });
  } else result = checkPeopleBatch(batch);
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const item of result.items)
      console.log(`${item.state} ${item.id}${item.reasons.length ? `: ${item.reasons.join('; ')}` : ''}`);
    for (const error of result.errors) console.error(error);
    if ('verification' in result) console.log(`verification: ${result.verification}`);
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
