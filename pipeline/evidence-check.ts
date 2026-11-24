import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ContentEvidence } from './content-batch';
import { REPO_ROOT, loadRawBook, stripSpace } from './raw-sources';

export type EvidenceStatus = 'ok' | 'not-found' | 'not-local';

export interface EvidenceResult {
  personId: string;
  evidenceId: string;
  work: string;
  status: EvidenceStatus;
  /** 未找到时给出那一段；不在本地原典时给出原因。 */
  detail?: string;
}

/** 摘录可以用省略号连接原典里不相邻的几句；每一段都要能单独核对。 */
export function excerptSegments(excerpt: string): string[] {
  return excerpt
    .split(/…+|\.{3,}/)
    .map((segment) => stripSpace(segment))
    .filter(Boolean);
}

/**
 * 逐条核对摘录是否逐字出现在 raw/ 里该书正文中。比较前两边都去掉空白。
 * not-local 表示这本书不在本机 raw/ 里，只能由审核者用别的手段核对。
 */
export function checkEvidence(
  personId: string,
  evidence: ContentEvidence[],
  root: string = REPO_ROOT,
): EvidenceResult[] {
  return evidence.map((item) => {
    const base = { personId, evidenceId: item.id, work: item.work };
    let pages;
    try {
      pages = loadRawBook(item.work, root);
    } catch (error) {
      return { ...base, status: 'not-local', detail: error instanceof Error ? error.message : String(error) };
    }
    const segments = excerptSegments(item.excerpt);
    if (!segments.length) return { ...base, status: 'not-found', detail: '摘录为空' };
    for (const segment of segments) {
      if (!pages.some((page) => page.text.includes(segment))) {
        return { ...base, status: 'not-found', detail: `「${segment}」不在 ${item.work} 正文里` };
      }
    }
    return { ...base, status: 'ok' };
  });
}

export function summarizeEvidence(results: EvidenceResult[]): string {
  const count = (status: EvidenceStatus) => results.filter((item) => item.status === status).length;
  return `摘录校验：${count('ok')} 条逐字命中，${count('not-found')} 条未找到，${count('not-local')} 条不在本机原典（须由审核者另行核对）。`;
}

function main(): void {
  const args = process.argv.slice(2);
  let path = '';
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--batch') path = args[++i] ?? '';
    else if (args[i] === '--json') json = true;
    else throw new Error(`未知参数 ${args[i]}，用法：--batch <batch.json> [--json]`);
  }
  if (!path) throw new Error('需要 --batch <batch.json>');
  const raw = JSON.parse(readFileSync(resolve(path), 'utf8')) as {
    items?: Array<{ proposal?: { id: string; evidence: ContentEvidence[] } }>;
  };
  if (!Array.isArray(raw.items)) throw new Error('不是内容批次文件：缺少 items');
  const results = raw.items.flatMap((item) =>
    item.proposal ? checkEvidence(item.proposal.id, item.proposal.evidence) : [],
  );
  const ok = !results.some((item) => item.status === 'not-found');
  if (json) {
    console.log(JSON.stringify({ ok, results }, null, 1));
    return;
  }
  const mark = { ok: '命中', 'not-found': '未找到', 'not-local': '非本地' } as const;
  for (const item of results) {
    console.log(
      `${mark[item.status]}  ${item.personId}  ${item.evidenceId}  ${item.work}${item.detail ? `：${item.detail}` : ''}`,
    );
  }
  console.log(summarizeEvidence(results));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
