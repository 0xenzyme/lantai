import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listRawBooks, loadRawBook, stripSpace } from './raw-sources';

export interface SourceHit {
  /** 相对仓库根目录，例如 raw/唐/舊唐書/卷194上.md。 */
  path: string;
  /** 命中在去空白正文里的起止位置。 */
  start: number;
  end: number;
  /** 去空白后的上下文，命中部分用【】标出。 */
  context: string;
}

/** 在一本书的去空白正文里找正则。pattern 里的空白先去掉，所以检索词不受原文换行影响。 */
export function searchRawBook(work: string, pattern: RegExp, max: number, width: number, root?: string): SourceHit[] {
  const needle = stripSpace(pattern.source);
  const regex = new RegExp(needle, pattern.flags.replace('g', ''));
  const hits: SourceHit[] = [];
  for (const page of loadRawBook(work, root)) {
    const text = page.text;
    let from = 0;
    while (hits.length < max) {
      const match = regex.exec(text.slice(from));
      if (!match) break;
      const start = from + match.index;
      const end = start + match[0].length;
      const prefix = text.slice(Math.max(0, start - width), start);
      const suffix = text.slice(end, Math.min(text.length, end + width));
      hits.push({ path: page.path, start, end, context: `${prefix}【${match[0]}】${suffix}` });
      from = match[0].length ? end : end + 1;
    }
    if (hits.length >= max) break;
  }
  return hits;
}

export interface RawPassage {
  /** 相对仓库根目录，例如 raw/唐/舊唐書/卷96.md。 */
  path: string;
  /** 起始正则在去空白正文里首次命中的位置。 */
  start: number;
  /** 从命中处起、跳过 skip 个字之后连续的一段正文，原样输出，可以逐字复制成摘录。 */
  text: string;
}

/**
 * 从首次命中处起读出一段连续正文。读整篇本传用一次调用，比逐句检索省得多：
 * 子智能体每多一次检索，后面每一步都要重发更大的对话历史。
 */
export function readRawPassage(
  work: string,
  start: RegExp,
  chars: number,
  skip = 0,
  root?: string,
): RawPassage | undefined {
  const regex = new RegExp(stripSpace(start.source));
  for (const page of loadRawBook(work, root)) {
    const match = regex.exec(page.text);
    if (!match) continue;
    const from = match.index + skip;
    return { path: page.path, start: match.index, text: page.text.slice(from, from + chars) };
  }
  return undefined;
}

function usage(): string {
  return [
    '用法：npm run sources:search -- <正则> [--work 书名] [--max 8] [--width 60] [--json]',
    '       npm run sources:search -- <起始正则> --work <书名> --chars 8000 [--skip 0] [--json]',
    '       npm run sources:search -- --list',
    '第一种是检索：输出命中位置和上下文。第二种是整段读取：从首次命中处起输出连续正文，适合一次读完本传。',
    '正文是繁体，正则也要用繁体，例如 頡利可汗者。省略 --work 时检索 raw/ 下全部书，较慢。',
  ].join('\n');
}

const PASSAGE_MAX_CHARS = 20000;

function main(): void {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    console.log(usage());
    return;
  }
  let work: string | undefined;
  let max = 8;
  let width = 60;
  let chars: number | undefined;
  let skip = 0;
  let json = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = () => {
      const next = args[++i];
      if (next === undefined) throw new Error(`${arg} 缺少参数`);
      return next;
    };
    if (arg === '--work') work = value();
    else if (arg === '--max') max = Number(value());
    else if (arg === '--width') width = Number(value());
    else if (arg === '--chars') chars = Number(value());
    else if (arg === '--skip') skip = Number(value());
    else if (arg === '--json') json = true;
    else if (arg === '--list') {
      for (const book of listRawBooks()) console.log(`${book.name}\t${book.files} 页\t${book.dir}`);
      return;
    } else if (arg.startsWith('-')) throw new Error(`未知参数 ${arg}`);
    else positional.push(arg);
  }
  if (!Number.isInteger(max) || max <= 0 || !Number.isInteger(width) || width < 0) {
    throw new Error('--max 与 --width 必须是非负整数');
  }
  if (chars !== undefined && (!Number.isInteger(chars) || chars <= 0 || chars > PASSAGE_MAX_CHARS)) {
    throw new Error(`--chars 必须是 1 到 ${PASSAGE_MAX_CHARS} 之间的整数`);
  }
  if (!Number.isInteger(skip) || skip < 0) throw new Error('--skip 必须是非负整数');
  if (!positional.length) throw new Error(usage());
  const pattern = new RegExp(stripSpace(positional.join(' ')));

  if (chars !== undefined) {
    if (!work) throw new Error('整段读取需要 --work 书名');
    const passage = readRawPassage(work, pattern, chars, skip);
    if (!passage) {
      console.log(`没有命中：${pattern.source}`);
      console.log('确认检索词是繁体，并且是本传开头那几个字。');
      return;
    }
    if (json) {
      console.log(JSON.stringify(passage, null, 1));
      return;
    }
    const from = passage.start + skip;
    const to = from + passage.text.length;
    const more = passage.text.length === chars ? `；没有读完时用 --skip ${skip + chars} 续读` : '';
    console.log(`${passage.path}（第 ${from + 1} 至 ${to} 字${more}）`);
    console.log(passage.text);
    return;
  }

  const books = work ? [work] : listRawBooks().map((book) => book.name);
  const hits = books.flatMap((name) => searchRawBook(name, pattern, max, width));
  if (json) {
    console.log(JSON.stringify(hits, null, 1));
    return;
  }
  if (!hits.length) {
    console.log(`没有命中：${pattern.source}`);
    console.log('确认检索词是繁体；用 npm run sources:search -- --list 查看可用的书。');
    return;
  }
  const shown = hits.slice(0, max);
  for (const hit of shown) console.log(`${hit.path}\n  …${hit.context}…`);
  if (hits.length > shown.length) console.log(`另有 ${hits.length - shown.length} 处命中，加大 --max 查看。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
