import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, lstatSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';

export function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Refuse symlinks in every existing path component, including output directories. */
export function safePath(root: string, path: string): string {
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`路径越界：${path}`);
  let current = root;
  for (const part of rel.split('/')) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`拒绝符号链接：${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return full;
}

/** Write through a unique temp file plus rename so interrupted runs never see a partial file. */
export function atomicText(root: string, path: string, text: string): void {
  const full = safePath(root, path);
  mkdirSync(dirname(full), { recursive: true });
  const tmp = `${full}.tmp-${process.pid}`;
  safePath(root, tmp);
  writeFileSync(tmp, text, { flag: 'wx' });
  try {
    renameSync(tmp, full);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

/** JSON 序列化固定两空格缩进加换行，与 pipeline/ 下现有人工维护文件格式一致。 */
export function atomicJson(root: string, path: string, value: unknown): void {
  atomicText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}
