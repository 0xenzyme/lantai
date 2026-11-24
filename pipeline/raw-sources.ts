import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * raw/ 是本机的维基文库抽取库，不入库。这里的函数只服务于「对着原典核对」的本机工具：
 * sources:search、people:evidence:check 与 people:batch:check。准入工具不依赖它，
 * 没有 raw/ 的机器照常准入。正文是繁体，检索词与摘录都要用繁体。
 * 参数 root 一律是仓库根目录，原典在 <root>/raw。
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export { REPO_ROOT };

/** 书名 → raw/<朝代>/<书名>。朝代目录名是简体，书名目录是繁体。key 收 content 里的简体书名。 */
const RAW_BOOK_DIRS: Record<string, string> = {
  史记: '先秦-西汉/史記',
  汉书: '西汉/漢書',
  后汉书: '东汉/後漢書',
  三国志: '三国/三國志',
  晋书: '晋/晉書',
  宋书: '南朝/宋書',
  南齐书: '南朝/南齊書',
  梁书: '南朝/梁書',
  陈书: '南朝/陳書',
  魏书: '北朝/魏書',
  北齐书: '北朝/北齊書',
  周书: '北朝/周書',
  隋书: '隋/隋書',
  旧唐书: '唐/舊唐書',
  新唐书: '唐/新唐書',
  旧五代史: '五代/舊五代史',
  新五代史: '五代/新五代史',
  宋史: '宋/宋史',
  辽史: '辽/遼史',
  金史: '金/金史',
  元史: '元/元史',
  明史: '明/明史',
  清史稿: '清/清史稿',
  南史: '南北朝/南史',
  北史: '南北朝/北史',
  资治通鉴: '通代/資治通鑑',
  续资治通鉴: '通代/續資治通鑑',
  通鉴纪事本末: '通代/通鑑紀事本末',
};

export interface RawBook {
  /** 繁体书名，即 raw/ 下的目录名。 */
  name: string;
  /** 相对 raw/ 的目录，例如 唐/舊唐書。 */
  dir: string;
  files: number;
}

export interface RawPage {
  /** 文件名，例如 卷194上.md。 */
  name: string;
  /** 相对仓库根目录，例如 raw/唐/舊唐書/卷194上.md。 */
  path: string;
  /** 已去掉全部空白的正文。 */
  text: string;
}

export function stripSpace(text: string): string {
  return text.replace(/\s+/g, '');
}

function directories(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

function pageNames(root: string, dir: string): string[] {
  const full = join(root, 'raw', dir);
  return existsSync(full)
    ? readdirSync(full)
        .filter((name) => name.endsWith('.md'))
        .sort()
    : [];
}

/** raw/ 下实际存在的书目录。dumps/ 是抽取工程的目录清单，不是书。 */
export function listRawBooks(root = REPO_ROOT): RawBook[] {
  const books: RawBook[] = [];
  const raw = join(root, 'raw');
  for (const period of directories(raw)) {
    if (period === 'dumps') continue;
    for (const name of directories(join(raw, period))) {
      const dir = `${period}/${name}`;
      const files = pageNames(root, dir).length;
      if (files) books.push({ name, dir, files });
    }
  }
  return books;
}

/** 书名 → raw 目录。繁体书名直接按目录名查找。 */
export function rawBookDir(work: string, root = REPO_ROOT): string | undefined {
  const mapped = RAW_BOOK_DIRS[work];
  if (mapped && existsSync(join(root, 'raw', mapped))) return mapped;
  return listRawBooks(root).find((book) => book.name === work)?.dir;
}

const cache = new Map<string, Map<string, RawPage[]>>();

/** 读入一本书的全部页面并去掉空白。每个仓库根目录、每本书只读一次。 */
export function loadRawBook(work: string, root = REPO_ROOT): RawPage[] {
  const loaded = cache.get(root);
  if (loaded?.has(work)) return loaded.get(work)!;
  const dir = rawBookDir(work, root);
  if (!dir) {
    const available = listRawBooks(root)
      .map((book) => book.name)
      .join('、');
    throw new Error(
      existsSync(join(root, 'raw'))
        ? `raw/ 里没有「${work}」。可用的书：${available}`
        : `本机没有 ${join(root, 'raw')}，无法对原典核对`,
    );
  }
  const pages = pageNames(root, dir).map((name) => {
    const path = `raw/${dir}/${name}`;
    return { name, path, text: stripSpace(readFileSync(join(root, path), 'utf8')) };
  });
  if (loaded) loaded.set(work, pages);
  else cache.set(root, new Map([[work, pages]]));
  return pages;
}
