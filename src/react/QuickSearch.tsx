import { useEffect, useMemo, useRef, useState } from 'react';
import { TYPE_NAMES } from '../app/skins';
import { fmtYear } from '../app/util';
import { loadTimelineEventIndex, loadTimelinePeopleIndex } from '../loader';
import { openEntity, openSiteUrl } from '../site/context';
import type { TimelineEventRecord, TimelinePersonRecord } from '../types';

interface QuickHit {
  kind: 'person' | 'event';
  id: string;
  title: string;
  meta: string;
}

interface QuickIndex {
  people: TimelinePersonRecord[];
  events: TimelineEventRecord[];
}

/** 瘦索引全站共用一份，首次唤起后缓存在模块里。 */
let indexPromise: Promise<QuickIndex> | null = null;

function loadIndex(): Promise<QuickIndex> {
  indexPromise ??= Promise.all([
    loadTimelinePeopleIndex('/data/timeline-people.json'),
    loadTimelineEventIndex('/data/timeline-events.json'),
  ]).then(([people, events]) => ({ people, events }));
  return indexPromise;
}

function searchHits(query: string, index: QuickIndex): QuickHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const matched = (fields: Array<string | undefined>): boolean =>
    fields.some((field) => field && field.toLowerCase().includes(needle));
  const people: QuickHit[] = [];
  for (const record of index.people) {
    if (people.length >= 6) break;
    if (!matched([record.name, record.display, ...(record.aliases ?? [])])) continue;
    people.push({
      kind: 'person',
      id: record.id,
      title: record.display || record.name,
      meta: `${record.topicTitle} · ${record.birth != null ? fmtYear(record.birth) : '生年不详'}—${
        record.death != null ? fmtYear(record.death) : '卒年不详'
      }`,
    });
  }
  const events: QuickHit[] = [];
  for (const record of index.events) {
    if (events.length >= 6) break;
    if (!matched([record.name, record.display, ...(record.aliases ?? [])])) continue;
    events.push({
      kind: 'event',
      id: record.id,
      title: record.display || record.name,
      meta: `${TYPE_NAMES[record.type]} · ${fmtYear(record.year)}`,
    });
  }
  return [...people, ...events];
}

/**
 * Cmd/Ctrl+K 全站快速查找：瘦索引即时结果直达详情页，
 * 无匹配或明确需要时回车进入全站搜索页。
 */
export function QuickSearch() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<QuickIndex | null>(null);
  const [selected, setSelected] = useState(0);
  const hits = useMemo(() => (index ? searchHits(query, index) : []), [query, index]);
  const needle = query.trim();
  const rows: Array<QuickHit | 'site'> = needle.length > 0 ? [...hits, 'site'] : [];

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      void loadIndex().then(setIndex);
      inputRef.current?.select();
    } else {
      dialog.close();
      setQuery('');
      setSelected(0);
    }
  }, [open]);

  const run = (row: QuickHit | 'site'): void => {
    if (row === 'site') {
      openSiteUrl(`/search?q=${encodeURIComponent(needle)}`);
    } else {
      openEntity(row.kind, row.id);
    }
    setOpen(false);
  };

  return (
    <dialog
      ref={dialogRef}
      className="lt-quick-search"
      data-quick-search
      aria-label="快速查找"
      onCancel={(event) => {
        event.preventDefault();
        setOpen(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSelected((value) => Math.min(value + 1, rows.length - 1));
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSelected((value) => Math.max(value - 1, 0));
        } else if (event.key === 'Enter' && rows[selected]) {
          event.preventDefault();
          run(rows[selected]);
        }
      }}
    >
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="查找人物或纪事…"
        aria-label="查找人物或纪事"
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(0);
        }}
      />
      <ul className="lt-quick-search-list">
        {rows.map((row, position) => {
          const isSite = row === 'site';
          const active = position === selected;
          return (
            <li key={isSite ? 'site' : `${row.kind}:${row.id}`}>
              <button
                type="button"
                className={active ? 'active' : ''}
                aria-selected={active}
                onMouseEnter={() => setSelected(position)}
                onClick={() => run(row)}
              >
                {isSite ? (
                  <>
                    <span className="lt-quick-search-title">在全站搜索「{needle}」</span>
                    <span className="lt-quick-search-meta">搜索页</span>
                  </>
                ) : (
                  <>
                    <span className="lt-quick-search-title">{row.title}</span>
                    <span className="lt-quick-search-meta">{row.meta}</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
        {needle.length > 0 && index === null && <li className="lt-quick-search-empty">正在载入索引…</li>}
        {needle.length > 0 && index !== null && hits.length === 0 && (
          <li className="lt-quick-search-empty">没有匹配「{needle}」的人物或纪事</li>
        )}
      </ul>
      <p className="lt-quick-search-foot">↑ ↓ 选择 · 回车打开 · Esc 关闭</p>
    </dialog>
  );
}
