import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Relation } from '../src/types';
import { atomicJson, readText, safePath } from './content-io';
import { parseContentBatch } from './content-batch';
import { loadPipeline } from './load';
import { batchDir, type RelationProposal } from './people-batch-assemble';

/**
 * 把批次里已通过独立审核的关系提案写进 topic.json。
 * 关系不属于人物批次工具的候选载荷，所以单独合并：只有审核结论为 pass 的人物，
 * 它提交的 relations 与 relationFixes 才会被写入。默认只报告，--apply 才落盘。
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 关系 note 在人物页列表和画布卡片里是一行说明，写长了会挤掉正文。 */
export const RELATION_NOTE_MAX = 50;

export interface RelationOutcome {
  by: string;
  topic: string;
  source: string;
  target: string;
  type: string;
  note: string;
  state: 'added' | 'fixed' | 'exists' | 'rejected';
  reason?: string;
}

interface TopicFile {
  people: Array<{ id: string }>;
  relationTypes: Array<{ id: string; directed?: boolean }>;
  relations: Relation[];
}

/** 无向类型在合并与查重时不在乎方向，与 lint 的 mergeTopicRelations 同一口径。 */
function edgeKey(topic: TopicFile, relation: RelationProposal): string {
  const directed = topic.relationTypes.find((item) => item.id === relation.type)?.directed ?? false;
  const ends = directed ? [relation.source, relation.target] : [relation.source, relation.target].sort();
  return `${ends.join('\0')}\0${relation.type}`;
}

function readJson<T>(path: string): T | null {
  const text = readText(path);
  return text === null ? null : (JSON.parse(text) as T);
}

export function mergeRelations(root: string, batchId: string, apply: boolean): RelationOutcome[] {
  const proposed = readJson<{
    relations: Array<RelationProposal & { by: string }>;
    fixes: Array<RelationProposal & { by: string }>;
  }>(safePath(root, batchDir(batchId, 'relations.proposed.json')));
  if (!proposed) return [];
  const batchPath = safePath(root, batchDir(batchId, 'batch.json'));
  const batchText = readText(batchPath);
  if (batchText === null) return [];
  const batch = parseContentBatch(JSON.parse(batchText));
  const passed = new Set(
    batch.items.filter((item) => item.review?.decision === 'pass').map((item) => item.proposal.id),
  );
  const data = loadPipeline(join(root, 'pipeline'));
  const topics = new Map<string, TopicFile>();
  const topicFile = (id: string): TopicFile | undefined => {
    const cached = topics.get(id);
    if (cached) return cached;
    const path = `pipeline/topics/${id}/topic.json`;
    if (!existsSync(safePath(root, path))) return undefined;
    const loaded = JSON.parse(readFileSync(safePath(root, path), 'utf8')) as TopicFile;
    topics.set(id, loaded);
    return loaded;
  };

  const handle = (edge: RelationProposal & { by: string }, fix: boolean): RelationOutcome => {
    const outcome: RelationOutcome = {
      by: edge.by,
      topic: edge.topic,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      note: edge.note,
      state: 'rejected',
    };
    const reject = (reason: string): RelationOutcome => ({ ...outcome, reason });
    if (!passed.has(edge.by)) return reject('该项没有通过独立审核');
    const topic = topicFile(edge.topic);
    if (!topic) return reject(`专题 ${edge.topic} 不存在`);
    const member = (id: string) => data.people.has(id) && topic.people.some((person) => person.id === id);
    for (const [label, id] of [
      ['source', edge.source],
      ['target', edge.target],
    ] as const) {
      if (!member(id)) return reject(`${label} ${id} 不是专题 ${edge.topic} 收录的人物`);
    }
    if (edge.source === edge.target) return reject('关系的两端不能是同一个人');
    if (!topic.relationTypes.some((item) => item.id === edge.type)) {
      return reject(`type ${edge.type} 不在专题 ${edge.topic} 的 relationTypes 里`);
    }
    if (edge.note.length > RELATION_NOTE_MAX) return reject(`note 超过 ${RELATION_NOTE_MAX} 字`);
    const key = edgeKey(topic, edge);
    const found = topic.relations.filter((relation) => edgeKey(topic, relation as RelationProposal) === key);
    if (!fix) {
      if (found.length) return { ...outcome, state: 'exists', reason: found[0].note };
      topic.relations.push({ source: edge.source, target: edge.target, type: edge.type, note: edge.note });
      return { ...outcome, state: 'added' };
    }
    if (!found.length) return reject('要修订的关系边不存在');
    for (const relation of found) relation.note = edge.note;
    return { ...outcome, state: 'fixed' };
  };

  const outcomes = [
    ...proposed.relations.map((edge) => handle(edge, false)),
    ...proposed.fixes.map((edge) => handle(edge, true)),
  ];
  const writable = outcomes.some((item) => item.state === 'added' || item.state === 'fixed');
  if (apply && writable) {
    for (const [id, topic] of topics) {
      if (outcomes.some((item) => item.topic === id && (item.state === 'added' || item.state === 'fixed'))) {
        atomicJson(root, `pipeline/topics/${id}/topic.json`, topic);
      }
    }
  }
  atomicJson(root, batchDir(batchId, 'relations.applied.json'), { applied: apply && writable, outcomes });
  return outcomes;
}

function main(): void {
  const args = process.argv.slice(2);
  let id = '';
  let apply = false;
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--id') id = args[++i] ?? '';
    else if (args[i] === '--apply') apply = true;
    else if (args[i] === '--json') json = true;
    else throw new Error(`未知参数 ${args[i]}，用法：--id <批次id> [--apply] [--json]`);
  }
  if (!id) throw new Error('需要 --id <批次id>');
  const outcomes = mergeRelations(repoRoot, id, apply);
  if (json) {
    console.log(JSON.stringify({ applied: apply, outcomes }, null, 1));
    return;
  }
  const count = (state: RelationOutcome['state']) => outcomes.filter((item) => item.state === state).length;
  console.log(
    `${apply ? '已写入' : '预演'}：新增 ${count('added')}，修订 note ${count('fixed')}，已存在 ${count('exists')}，拒绝 ${count('rejected')}`,
  );
  for (const item of outcomes.filter((entry) => entry.state === 'rejected')) {
    console.log(`  拒绝 ${item.by}: ${item.source}→${item.target}/${item.type} ${item.reason}`);
  }
  if (count('rejected')) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
