import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeTopicRelations } from './lint';
import { loadPipeline } from './load';
import type { RegistryPerson, TopicDraft } from './types';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const YEAR_MIN = -3000;
const YEAR_MAX = 2100;

/** 生卒区间；任一端缺失时用极值展开。完全无年份的人物返回 null，不生成候选。 */
function lifeSpan(person: RegistryPerson): { birth: number; death: number; exact: boolean } | null {
  if (person.birth === undefined && person.death === undefined) return null;
  return {
    birth: person.birth ?? YEAR_MIN,
    death: person.death ?? YEAR_MAX,
    exact: person.birth !== undefined && person.death !== undefined,
  };
}

function overlapYears(a: RegistryPerson, b: RegistryPerson): { years: number; exact: boolean } | null {
  const spanA = lifeSpan(a);
  const spanB = lifeSpan(b);
  if (!spanA || !spanB) return null;
  const start = Math.max(spanA.birth, spanB.birth);
  const end = Math.min(spanA.death, spanB.death);
  return { years: end > start ? end - start : 0, exact: spanA.exact && spanB.exact };
}

function yearText(year: number | undefined): string {
  if (year === undefined) return '?';
  return year < 0 ? `前${-year}` : String(year);
}

function lifeText(person: RegistryPerson): string {
  return `${yearText(person.birth)}–${yearText(person.death)}`;
}

interface ContemporariesOptions {
  topicId: string;
  personId: string;
  limit: number;
}

/** 只读研究报告：列出专题内与目标人物生卒重叠的轴上人物，供关系收录参考。不写任何文件。 */
export function reportContemporaries(root: string, options: ContemporariesOptions): string {
  const data = loadPipeline(join(root, 'pipeline'));
  const topic: TopicDraft | undefined = data.topics.find((item) => item.meta.id === options.topicId);
  if (!topic) throw new Error(`专题 ${options.topicId} 不存在`);
  const target = data.people.get(options.personId);
  if (!target) throw new Error(`人物 ${options.personId} 未登记`);
  if (!topic.people.some((person) => person.id === options.personId))
    throw new Error(`人物 ${options.personId} 不在专题 ${options.topicId} 里`);

  const related = new Map<string, string[]>();
  for (const merged of mergeTopicRelations(data.topics).relations) {
    if (merged.source === options.personId || merged.target === options.personId) {
      const other = merged.source === options.personId ? merged.target : merged.source;
      const list = related.get(other) ?? [];
      list.push(merged.type);
      related.set(other, list);
    }
  }

  const lanes = new Map(topic.lanes.map((lane) => [lane.id, lane.name ?? lane.id]));
  const rows: Array<{ id: string; overlap: number; missing: boolean; line: string }> = [];
  for (const overlay of topic.people) {
    if (overlay.id === options.personId) continue;
    const person = data.people.get(overlay.id);
    if (!person) continue;
    const overlap = overlapYears(target, person);
    if (overlap === null || overlap.years <= 0) continue;
    const existing = related.get(person.id);
    rows.push({
      id: person.id,
      overlap: overlap.years,
      missing: !existing,
      line: `${person.id}｜${person.name}｜${lifeText(person)}｜泳道 ${lanes.get(overlay.lane) ?? overlay.lane}｜重叠${
        overlap.exact ? '约' : '至少'
      } ${overlap.years} 年｜${existing ? `已有关系 ${[...new Set(existing)].join('/')}` : '尚无关系'}`,
    });
  }
  rows.sort((left, right) => {
    if (left.missing !== right.missing) return left.missing ? -1 : 1;
    return right.overlap - left.overlap || left.id.localeCompare(right.id);
  });

  const header = [
    `# 同时代候选：${target.name}（${options.topicId}）`,
    '',
    '仅供研究参考。同时代候选不得直接写成 relations：每条关系须人工判断叙事意义，并在 topic.json 写明 note 与依据（pipeline/PLAYBOOK.md「关系」）。',
    '',
  ];
  if (!rows.length) return `${header.join('\n')}专题内没有生卒重叠的轴上人物。\n`;
  const shown = rows.slice(0, options.limit);
  const more = rows.length > shown.length ? [``, `……另有 ${rows.length - shown.length} 人，可加大 --limit。`] : [];
  return `${header.join('\n')}${shown.map((row) => `- ${row.line}`).join('\n')}\n${more.join('\n')}`;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length < 2) {
    console.log(
      '用法：tsx pipeline/relations-report.ts <topic> <person-id> [--limit <n>]\n只读输出专题内与目标人物生卒重叠的轴上人物；不写文件。',
    );
    process.exit(args.includes('--help') ? 0 : 1);
  }
  const [topicId, personId] = args;
  let limit = 40;
  for (let i = 2; i < args.length; i += 1) {
    if (args[i] === '--limit') limit = Number(args[++i]);
    else throw new Error(`未知参数 ${args[i]}`);
  }
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limit 必须是正整数');
  console.log(reportContemporaries(repoRoot, { topicId, personId, limit }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
