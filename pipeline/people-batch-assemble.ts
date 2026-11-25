import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { auditPeople } from './audit-people';
import { compileAll } from './compile';
import { atomicJson, atomicText, readText, safePath } from './content-io';
import {
  parseContentBatch,
  type ContentBatch,
  type ContentCandidate,
  type ContentClaim,
  type ContentEvidence,
  type ContentReview,
} from './content-batch';
import { checkEvidence, type EvidenceResult } from './evidence-check';
import { lintPipeline } from './lint';
import { loadPipeline } from './load';
import { formatPersonMarkdown, parsePersonMarkdown } from './person-md';
import { preflightPeopleBatch } from './people-production';
import type { PipelineData } from './types';

/**
 * 人物批次的工作目录工具。执行者和审核者每人只写自己的文件，batch.json 只由本工具组装：
 *   workspace/content/raw/<batch-id>/
 *     scope.json                 批次范围与起草者标识，init 写入后不再变
 *     items/<id>.md              候选目标原文（人物 Markdown），起草者写
 *     items/<id>.json            收录理由、摘录、claim、关系提案，起草者写
 *     reviews/<id>.json          独立审核结论，审核者写
 *     check/<id>.json            单人自检用的临时批次，check 生成
 *     batch.json                 组装后的权威批次，assemble 生成
 *     assembled.json             每人当前状态与内容指纹
 *     relations.proposed.json    已通过审核的关系提案与关系 note 修订
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface RelationProposal {
  topic: string;
  source: string;
  target: string;
  type: string;
  note: string;
}

export interface ItemSidecar {
  id: string;
  admission: string;
  evidence: ContentEvidence[];
  claims: ContentClaim[];
  /** 本专题 topic.json 里新增的关系边。 */
  relations?: RelationProposal[];
  /** 修订 topic.json 里已有关系边的 note，按 topic、端点、type 定位。 */
  relationFixes?: RelationProposal[];
  /** 勘误批逐条记录改了什么；升档批可省略。 */
  changes?: string[];
  /** init 写入的参考信息：与本人在各专题里已有的关系边。不属于候选内容，不参与内容指纹。 */
  existingRelations?: RelationProposal[];
}

interface Scope {
  id: string;
  description: string;
  author: string;
  topic?: string;
  mode?: string;
  ids: string[];
}

interface ReviewFile {
  reviewer: string;
  decision: ContentReview['decision'];
  reason: string;
  /** 审核时 assembled.json 或自检输出里给出的内容指纹；草稿改动后旧审核失效。 */
  proposalHash: string;
}

export interface ItemCheck {
  id: string;
  hash?: string;
  /** 可以交给独立审核。 */
  ok: boolean;
  /** 草稿与正式文件相同，没有可审的修改。 */
  unchanged: boolean;
  problems: string[];
  evidence: EvidenceResult[];
  /** 仓库其他文件里已经存在的全局错误，不是本条目造成的。不挡自检，但应用前的准入检查要求全库无错。 */
  external: string[];
  /** 自检判断不了、独立审核却会打回的情况。每次自检都提示，不挡自检。 */
  hints: string[];
}

const STANDING_HINTS = [
  '原稿把原典不载的年份（尤其是生卒年）写成 exact 的，把 accuracy 降为 approx 或 unknown，并在 note 里写明推算依据；年份本身保留。',
  '原稿已有的内容不因本地原典没有提到而删除，只有与原典矛盾才改。',
];

/** 不带本条目改动时全库已有的 error。用来把仓库其他文件的问题与本条目造成的问题分开。 */
function baselineErrors(data: PipelineData): string[] {
  const { catalog, topics } = compileAll(data);
  return lintPipeline(data, topics, catalog)
    .filter((message) => message.level === 'error')
    .map((message) => `${message.path}: ${message.message}`);
}

export function batchDir(batchId: string, ...parts: string[]): string {
  return join('workspace/content/raw', batchId, ...parts);
}

function readJson<T>(path: string): T | null {
  const text = readText(path);
  return text === null ? null : (JSON.parse(text) as T);
}

function readScope(root: string, batchId: string): Scope {
  const scope = readJson<Scope>(safePath(root, batchDir(batchId, 'scope.json')));
  if (!scope) throw new Error(`批次 ${batchId} 还没有 init：缺少 scope.json`);
  return scope;
}

export function readSidecar(root: string, batchId: string, id: string): ItemSidecar {
  return readJson<ItemSidecar>(safePath(root, batchDir(batchId, 'items', `${id}.json`)))!;
}

/** 审核结论绑定这份指纹：目标原文、理由、摘录、claim、关系提案任一改动，旧审核即失效。 */
function itemHash(proposal: ContentCandidate['proposal'], sidecar: ItemSidecar): string {
  const { id, after, admission, evidence, claims } = proposal;
  const payload = JSON.stringify({
    id,
    after,
    admission,
    evidence,
    claims,
    relations: sidecar.relations ?? [],
    relationFixes: sidecar.relationFixes ?? [],
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function relationProblems(label: string, relations: RelationProposal[] | undefined): string[] {
  if (relations === undefined) return [];
  if (!Array.isArray(relations)) return [`${label} 必须是数组`];
  const fields: Array<keyof RelationProposal> = ['topic', 'source', 'target', 'type', 'note'];
  return relations.flatMap((relation, index) =>
    fields.some((field) => typeof relation?.[field] !== 'string' || !relation[field].trim())
      ? [`${label}[${index}] 的 topic、source、target、type、note 都必须是非空字符串`]
      : [],
  );
}

function sidecarProblems(sidecar: ItemSidecar | null, id: string): string[] {
  if (!sidecar) return [`缺少 items/${id}.json`];
  const problems: string[] = [];
  if (sidecar.id !== id) problems.push(`items/${id}.json 的 id 应为 ${id}，现在是 ${String(sidecar.id)}`);
  if (typeof sidecar.admission !== 'string' || !sidecar.admission.trim())
    problems.push('admission 不能为空：写清为什么这样修订或升级');
  if (!Array.isArray(sidecar.evidence) || !sidecar.evidence.length) problems.push('evidence 至少一条');
  if (!Array.isArray(sidecar.claims) || !sidecar.claims.length) problems.push('claims 至少一条');
  problems.push(...relationProblems('relations', sidecar.relations));
  problems.push(...relationProblems('relationFixes', sidecar.relationFixes));
  return problems;
}

interface BuiltItem {
  candidate?: ContentCandidate;
  sidecar?: ItemSidecar;
  hash?: string;
  unchanged: boolean;
  problems: string[];
}

function buildItem(data: PipelineData, root: string, scope: Scope, id: string): BuiltItem {
  const draftPath = batchDir(scope.id, 'items', `${id}.md`);
  const draft = readText(safePath(root, draftPath));
  if (draft === null) return { unchanged: false, problems: [`缺少 ${draftPath}`] };
  const parsed = parsePersonMarkdown(draft, draftPath);
  const problems = parsed.messages.map((message) => `${message.level}: ${message.message}`);
  const sidecar = readSidecar(root, scope.id, id);
  problems.push(...sidecarProblems(sidecar, id));
  const canonical = data.personPaths.get(id);
  const before = canonical ? readText(safePath(root, canonical)) : null;
  if (!canonical || before === null) {
    problems.push(`人物 ${id} 没有已登记的 Markdown 文件，本工具只修订已登记人物`);
    return { sidecar: sidecar ?? undefined, unchanged: false, problems };
  }
  if (problems.length || !parsed.person) return { sidecar: sidecar ?? undefined, unchanged: false, problems };

  const candidate: ContentCandidate = {
    proposal: {
      id,
      operation: 'revise',
      author: scope.author,
      before,
      after: formatPersonMarkdown(parsed.person),
      admission: sidecar.admission,
      evidence: sidecar.evidence,
      claims: sidecar.claims,
    },
  };
  try {
    parseContentBatch(singleBatch(scope, [candidate]));
  } catch (error) {
    problems.push(`[CANDIDATE] ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    candidate,
    sidecar,
    hash: itemHash(candidate.proposal, sidecar),
    unchanged: candidate.proposal.before === candidate.proposal.after,
    problems,
  };
}

function singleBatch(scope: Scope, items: ContentCandidate[]): ContentBatch {
  return {
    schemaVersion: 2,
    id: scope.id,
    scope: { description: scope.description, personIds: [...scope.ids] },
    items,
  };
}

/** 《详表质量规范》里的核心枢纽：帝王、名相、摄政、名将、文豪。 */
const CORE_CATEGORIES = new Set(['monarch', 'chancellor', 'regent', 'general', 'poetry', 'literature']);

/**
 * 升档批的完整度要求：自检的其余部分只核对「写出来的内容对不对」，这里核对「规范要求的内容写没写齐」。
 * 核心人物至少 3 条经历，其他人物至少 2 条；已有关系加本次新提的关系合计至少 2 条。
 * 勘误和恢复批不新增内容，不做这项检查。
 */
function completenessProblems(scope: Scope, id: string, after: string, sidecar: ItemSidecar): string[] {
  if (scope.mode !== 'upgrade') return [];
  const person = parsePersonMarkdown(after, `items/${id}.md`).person;
  if (!person) return [];
  const main = person.primary ?? (person.categories ?? [])[0];
  const core = main !== undefined && CORE_CATEGORIES.has(main);
  const minimum = core ? 3 : 2;
  const experiences = person.experiences?.length ?? 0;
  const existing = sidecar.existingRelations?.length ?? 0;
  const proposed = sidecar.relations?.length ?? 0;
  const problems: string[] = [];
  if (experiences < minimum) {
    problems.push(
      `[COMPLETENESS] 升档批要求${core ? '核心人物' : '人物'}至少 ${minimum} 条 experiences，现在是 ${experiences}。不能用 event 关联公共事件的经历，写成自带 year、yearAccuracy 的经历。`,
    );
  }
  if (existing + proposed < 2) {
    problems.push(
      `[COMPLETENESS] 升档批要求关系合计至少 2 条：已有 ${existing} 条，本次新提 ${proposed} 条。在 items/${id}.json 的 relations 里补有原典依据的关系。`,
    );
  }
  return problems;
}

/** 起草者交接前与工作流闸门共用的单人自检：格式、claim 映射、摘录逐字、人物 lint 与全局投影。 */
export function checkItem(root: string, batchId: string, id: string): ItemCheck {
  const scope = readScope(root, batchId);
  const data = loadPipeline(join(root, 'pipeline'));
  const built = buildItem(data, root, scope, id);
  const problems = [...built.problems];
  let evidence: EvidenceResult[] = [];
  let external: string[] = [];
  let unchanged = built.unchanged;
  if (built.candidate && unchanged && built.sidecar) {
    // 升档批里，草稿与正式文件相同但规范要求的内容没写齐（例如没有任何个人经历），不算完成。
    const gaps = completenessProblems(scope, id, built.candidate.proposal.after, built.sidecar);
    if (gaps.length) {
      problems.push(...gaps);
      unchanged = false;
    }
  }
  if (built.candidate && !unchanged) {
    if (built.sidecar) problems.push(...completenessProblems(scope, id, built.candidate.proposal.after, built.sidecar));
    evidence = checkEvidence(id, built.candidate.proposal.evidence, root);
    problems.push(
      ...evidence
        .filter((item) => item.status === 'not-found')
        .map((item) => `[EXCERPT] ${item.evidenceId}：${item.detail}`),
    );
    mkdirSync(safePath(root, batchDir(batchId, 'check')), { recursive: true });
    const batch = singleBatch(scope, [built.candidate]);
    atomicJson(root, batchDir(batchId, 'check', `${id}.json`), batch);
    const preflight = preflightPeopleBatch(batch, root);
    // 别的会话写坏了仓库里不相关的文件时，本条目不该被判为自检失败；只有本条目新引入的全局错误才挡它。
    // 准入工具会把全局错误同时抄进每个条目的 reasons，所以两处都要按基线过滤。
    const baseline = new Set(baselineErrors(data));
    problems.push(
      ...(preflight.items.find((row) => row.id === id)?.reasons ?? []).filter((reason) => !baseline.has(reason)),
    );
    for (const error of preflight.errors) {
      if (baseline.has(error)) external.push(error);
      else problems.push(`[GLOBAL] ${error}`);
    }
    external = [...new Set(external)];
  }
  return {
    id,
    hash: built.hash,
    ok: Boolean(built.candidate) && !unchanged && problems.length === 0,
    unchanged,
    problems: [...new Set(problems)],
    evidence,
    external,
    hints: STANDING_HINTS,
  };
}

interface AssembleReport {
  batchId: string;
  items: Record<
    string,
    { state: 'reviewed' | 'awaiting-review' | 'problems' | 'unchanged' | 'missing'; hash?: string; problems?: string[] }
  >;
}

/** 组装 batch.json：有审核结论的候选全部写入（未通过的结论一并留档），没有审核的不写入。 */
export function assembleBatch(root: string, batchId: string): AssembleReport {
  const scope = readScope(root, batchId);
  const data = loadPipeline(join(root, 'pipeline'));
  const previousPath = safePath(root, batchDir(batchId, 'batch.json'));
  const previous = readJson<ContentBatch>(previousPath);
  const report: AssembleReport = { batchId, items: {} };
  const items: ContentCandidate[] = [];
  const relations: Array<RelationProposal & { by: string }> = [];
  const fixes: Array<RelationProposal & { by: string }> = [];
  for (const id of scope.ids) {
    const built = buildItem(data, root, scope, id);
    if (built.problems.length) {
      report.items[id] = {
        state:
          built.sidecar || existsSync(safePath(root, batchDir(batchId, 'items', `${id}.json`)))
            ? 'problems'
            : 'missing',
        problems: built.problems,
      };
      continue;
    }
    if (built.unchanged) {
      report.items[id] = { state: 'unchanged', hash: built.hash };
      continue;
    }
    const candidate = built.candidate!;
    const file = readJson<ReviewFile>(safePath(root, batchDir(batchId, 'reviews', `${id}.json`)));
    const carried = previous?.items.find((item) => item.proposal.id === id);
    let review: ContentReview | undefined;
    if (file && file.proposalHash === built.hash) {
      review = {
        reviewer: file.reviewer,
        decision: file.decision,
        reason: file.reason,
        reviewedProposal: candidate.proposal,
      };
    } else if (carried?.review && isDeepStrictEqual(carried.proposal, candidate.proposal)) {
      review = carried.review;
    }
    if (!review) {
      report.items[id] = { state: 'awaiting-review', hash: built.hash };
      continue;
    }
    items.push({ ...candidate, review });
    report.items[id] = { state: 'reviewed', hash: built.hash };
    if (review.decision !== 'pass') continue;
    relations.push(...(built.sidecar?.relations ?? []).map((relation) => ({ ...relation, by: id })));
    fixes.push(...(built.sidecar?.relationFixes ?? []).map((relation) => ({ ...relation, by: id })));
  }
  atomicJson(root, previousPath, singleBatch(scope, items));
  atomicJson(root, batchDir(batchId, 'assembled.json'), report);
  atomicJson(root, batchDir(batchId, 'relations.proposed.json'), { relations, fixes });
  return report;
}

function countStates(report: AssembleReport): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of Object.values(report.items)) counts[item.state] = (counts[item.state] ?? 0) + 1;
  return counts;
}

export interface InitOptions {
  id: string;
  description: string;
  author: string;
  topic?: string;
  mode?: string;
  ids?: string[];
  limit?: number;
  offset?: number;
}

export interface BatchInit {
  dir: string;
  ids: string[];
  people: Array<{ id: string; name: string }>;
}

/** 建批次目录，为每个人放下正式原文作草稿起点和空的理由/摘录/claim 文件。已存在的文件不覆盖。 */
export function initBatch(root: string, options: InitOptions): BatchInit {
  const data = loadPipeline(join(root, 'pipeline'));
  const dir = batchDir(options.id);
  const existing = readJson<Scope>(safePath(root, batchDir(options.id, 'scope.json')));
  let ids = options.ids;
  if (!ids) {
    if (!options.topic) throw new Error('没有 --ids 时需要 --topic');
    const ranked = auditPeople(data, options.topic, { includePeople: true }).people ?? [];
    const pending = ranked.filter((person) => !person.upgraded).map((person) => person.id);
    const offset = options.offset ?? 0;
    ids = pending.slice(offset, offset + (options.limit ?? 24));
  }
  // 同一批次 id 的 scope 不能变：重跑 init 时沿用 scope.json 里的人物，不按新的优先级重选。
  if (existing) ids = existing.ids;
  if (!ids.length) throw new Error('没有待处理的人物');
  for (const id of ids) {
    if (!data.personPaths.has(id)) throw new Error(`人物 ${id} 未登记`);
  }
  if (existsSync(safePath(root, batchDir(options.id, 'batch.json')))) {
    throw new Error(`批次 ${options.id} 已组装过；已接受的候选不能改，继续修订请新建批次 id`);
  }
  mkdirSync(safePath(root, batchDir(options.id, 'items')), { recursive: true });
  mkdirSync(safePath(root, batchDir(options.id, 'reviews')), { recursive: true });
  for (const id of ids) {
    const draft = safePath(root, batchDir(options.id, 'items', `${id}.md`));
    if (!existsSync(draft))
      atomicText(root, batchDir(options.id, 'items', `${id}.md`), readText(safePath(root, data.personPaths.get(id)!))!);
    const sidecarPath = batchDir(options.id, 'items', `${id}.json`);
    if (readText(safePath(root, sidecarPath)) === null) {
      const existingRelations = data.topics
        .filter((topic) => topic.people.some((person) => person.id === id))
        .flatMap((topic) =>
          topic.relations
            .filter((relation) => relation.source === id || relation.target === id)
            .map((relation) => ({
              topic: topic.meta.id,
              source: relation.source,
              target: relation.target,
              type: relation.type,
              note: relation.note ?? '',
            })),
        );
      atomicJson(root, sidecarPath, {
        id,
        admission: '',
        evidence: [],
        claims: [],
        relations: [],
        relationFixes: [],
        changes: [],
        existingRelations,
      } satisfies ItemSidecar & { existingRelations: unknown });
    }
  }
  if (!existing) {
    atomicJson(root, batchDir(options.id, 'scope.json'), {
      id: options.id,
      description: options.description,
      author: options.author,
      topic: options.topic,
      mode: options.mode,
      ids,
    } satisfies Scope);
  }
  return {
    dir,
    ids,
    people: ids.map((id) => ({ id, name: data.people.get(id)?.name ?? id })),
  };
}

function readIdsFile(path: string): string[] {
  return readFileSync(resolve(path), 'utf8')
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

function parseOptions(args: string[]): Record<string, string> & { ids?: string[]; positional: string[] } {
  const options: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      options[arg.slice(2)] = value;
    } else positional.push(arg);
  }
  const result = options as Record<string, string> & { ids?: string[]; positional: string[] };
  result.positional = positional;
  result.ids = options.ids
    ? options.ids
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : options['ids-file']
      ? readIdsFile(options['ids-file'])
      : undefined;
  return result;
}

function usage(): string {
  return [
    '用法：',
    '  npm run people:batch:init -- --id <批次id> --description "<范围说明>" --author "<起草者标识>" [--topic <专题> --limit 24 --offset 0 | --ids a,b,c | --ids-file <文件>] [--mode errata|upgrade] [--json]',
    '  npm run people:batch:check -- --id <批次id> --person <人物id> [--json]',
    '  npm run people:batch:assemble -- --id <批次id> [--json]',
    'init 建批次目录并放下草稿起点；check 对一个人做自检并输出内容指纹；assemble 把带审核结论的候选组装成 batch.json。',
  ].join('\n');
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || rest.includes('--help')) {
    console.log(usage());
    return;
  }
  const options = parseOptions(rest);
  const json = options.json === 'true';
  if (command === 'init') {
    for (const field of ['id', 'description', 'author']) {
      if (!options[field]) throw new Error(`init 需要 --${field}`);
    }
    const result = initBatch(repoRoot, {
      id: options.id,
      description: options.description,
      author: options.author,
      topic: options.topic,
      mode: options.mode,
      ids: options.ids,
      limit: options.limit ? Number(options.limit) : undefined,
      offset: options.offset ? Number(options.offset) : undefined,
    });
    if (json) console.log(JSON.stringify(result));
    else console.log(`批次 ${options.id}：${result.ids.length} 人，目录 ${result.dir}\n${result.ids.join(' ')}`);
    return;
  }
  if (!options.id) throw new Error(`需要 --id <批次id>\n${usage()}`);
  if (command === 'check') {
    if (!options.person) throw new Error('check 需要 --person <人物id>');
    const result = checkItem(repoRoot, options.id, options.person);
    if (json) console.log(JSON.stringify(result, null, 1));
    else {
      console.log(
        `${result.ok ? '可以送审' : result.unchanged ? '与正式文件相同' : '未通过'} ${result.id} 指纹 ${result.hash ?? '-'}`,
      );
      for (const problem of result.problems) console.log(`  - ${problem}`);
      const local = result.evidence.filter((item) => item.status === 'not-local');
      for (const item of local) console.log(`  需人工核对（不在本机原典）：${item.evidenceId} ${item.work}`);
      for (const error of result.external)
        console.log(`  仓库其他文件的全局错误（不挡本条目，应用前须修正）：${error}`);
      for (const hint of result.hints) console.log(`  提示：${hint}`);
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'assemble') {
    const report = assembleBatch(repoRoot, options.id);
    if (json) console.log(JSON.stringify(report, null, 1));
    else {
      console.log(`批次 ${options.id}：${JSON.stringify(countStates(report))}`);
      for (const [id, item] of Object.entries(report.items)) {
        if (item.problems?.length) console.log(`${id}: ${item.problems.join('; ')}`);
      }
    }
    return;
  }
  throw new Error(`未知命令 ${command}\n${usage()}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
