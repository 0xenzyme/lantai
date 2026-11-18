import {
  loadCatalog,
  loadLine,
  loadSearchIndex,
  loadTimelineEventIndex,
  loadTimelinePeopleIndex,
  loadTopic,
} from '../loader';
import type {
  Catalog,
  CatalogEntry,
  DynastyTerm,
  EventCatalog,
  EventRecord,
  SearchRecord,
  TimelineEventRecord,
  TimelinePersonRecord,
  Topic,
} from '../types';

export type LineId = 'people' | 'military' | 'history';
export type TimeLineId = 'military' | 'history';

const DATA = './data';
const FALLBACK_RANGE: [number, number] = [-2070, 1949];

function dataUrl(file: string): string {
  return `${DATA}/${file}`;
}

/**
 * 运行时实体库。
 * 首屏只加载目录、人物瘦索引和事件瘦索引；军事 / 历史两条完整事件线按需加载。
 */
export interface Library {
  catalog: Catalog;
  topics: CatalogEntry[];
  lines: Record<TimeLineId, EventLineViewLike>;
  /** 人物轴可绘制的事件集合：首包由瘦索引补出，完整线加载后同 id 记录覆盖。 */
  events: EventRecord[];
  /** 完整事件记录。瘦索引记录不在其中，选中事件时用它判断是否需要加载事件线。 */
  eventById: Map<string, EventRecord>;
  eventsByPerson: Map<string, EventRecord[]>;
  /** 首包事件瘦索引。检索与按需加载决策用它，不依赖完整事件线。 */
  eventSearch: TimelineEventRecord[];
  dynasties: DynastyTerm[];
  categoryNames: Map<string, string>;
  polityNames: Map<string, string>;
  /** 跨专题人物瘦索引。人物卡、事件卡与检索用它把 id 换成姓名。 */
  people: TimelinePersonRecord[];
  personById: Map<string, TimelinePersonRecord>;
  topicCache: Map<string, Topic>;
  /** 已加载的完整事件线。 */
  loadedLines: Set<TimeLineId>;
  /** 进行中的事件线请求，避免切线、深链和重试重复下载。 */
  lineLoads: Map<TimeLineId, Promise<void>>;
}

interface EventLineViewLike {
  id: TimeLineId;
  title: string;
  subtitle?: string;
  range: [number, number];
  events: EventRecord[];
  dynasties: DynastyTerm[];
}

function lineMetadata(catalog: Catalog, id: TimeLineId): { title: string; subtitle?: string; range: [number, number] } {
  const line = catalog.lines?.find((item) => item.id === id);
  return {
    title: line?.title ?? (id === 'military' ? '军事' : '历史事件'),
    subtitle: line?.subtitle,
    range: line?.range && line.range.length === 2 && line.range[0] < line.range[1] ? line.range : FALLBACK_RANGE,
  };
}

function emptyLine(catalog: Catalog, id: TimeLineId, dynasties: DynastyTerm[]): EventLineViewLike {
  const meta = lineMetadata(catalog, id);
  return { id, title: meta.title, subtitle: meta.subtitle, range: meta.range, events: [], dynasties };
}

function toTimelinePerson(record: SearchRecord): TimelinePersonRecord {
  return {
    id: record.id,
    name: record.name,
    display: record.display,
    aliases: record.aliases,
    tags: record.tags,
    gender: record.gender,
    birth: record.birth,
    death: record.death,
    birthAccuracy: record.birthAccuracy ?? 'unknown',
    deathAccuracy: record.deathAccuracy ?? 'unknown',
    topicId: record.topicId,
    topicTitle: record.topicTitle,
  };
}

let legacySearchRows: Promise<SearchRecord[]> | null = null;

/** 瘦索引失败时回退到全站 people.json；再失败则保持空索引，人物轴与专题正文仍可用。 */
function fallbackPeopleIndex(): Promise<TimelinePersonRecord[]> {
  legacySearchRows ??= loadSearchIndex(dataUrl('people.json')).catch((error) => {
    legacySearchRows = null;
    throw error;
  });
  return legacySearchRows
    .then((rows) => {
      const seen = new Set<string>();
      const people: TimelinePersonRecord[] = [];
      for (const row of rows) {
        if (row.kind === 'event' || seen.has(row.id)) continue;
        seen.add(row.id);
        people.push(toTimelinePerson(row));
      }
      return people;
    })
    .catch((error) => {
      console.warn('[年表人物索引降级失败]', error);
      return [];
    });
}

async function loadPeopleIndexSafely(): Promise<TimelinePersonRecord[]> {
  try {
    return await loadTimelinePeopleIndex(dataUrl('timeline-people.json'));
  } catch (error) {
    console.warn('[年表人物瘦索引加载失败，回退 people.json]', error);
    return fallbackPeopleIndex();
  }
}

async function loadEventIndexSafely(): Promise<TimelineEventRecord[]> {
  try {
    return await loadTimelineEventIndex(dataUrl('timeline-events.json'));
  } catch (error) {
    // 完整事件线加载后会自动补出事件检索行，因此这里只需保持空索引。
    console.warn('[年表事件瘦索引加载失败，事件检索将在事件线加载后补全]', error);
    return [];
  }
}

/**
 * 把首包事件瘦记录补成可绘制的轻量记录：条的位置、类型、起止年份来自瘦索引。
 * 描述、人物、来源等字段仍等完整事件线；因此这类记录只进 library.events，不进 eventById。
 */
function indexEventRecord(record: TimelineEventRecord): EventRecord {
  const event: EventRecord = {
    id: record.id,
    name: record.name,
    display: record.display,
    kind: record.endYear === undefined ? 'point' : 'span',
    type: record.type,
    importance: record.importance,
    year: record.year,
    yearAccuracy: 'unknown',
    sources: [],
  };
  if (record.catalogs.length > 0) event.catalogs = record.catalogs;
  if (record.endYear !== undefined) event.endYear = record.endYear;
  if (record.aliases && record.aliases.length > 0) event.aliases = record.aliases;
  return event;
}

function rebuildEventIndexes(library: Library): void {
  const events: EventRecord[] = [];
  const eventById = new Map<string, EventRecord>();
  for (const lineId of ['history', 'military'] as const) {
    for (const event of library.lines[lineId].events) {
      if (eventById.has(event.id)) continue;
      const copy: EventRecord = { ...event };
      eventById.set(event.id, copy);
      events.push(copy);
    }
  }
  // 人物轴首屏用瘦索引画事件条；完整线加载后同一事件由完整记录覆盖。
  for (const record of library.eventSearch) {
    if (eventById.has(record.id)) continue;
    events.push(indexEventRecord(record));
  }
  events.sort((a, b) => a.year - b.year || b.importance - a.importance);
  library.events = events;
  // eventById 只存完整记录：选中事件时据此判断是否还需加载完整事件线。
  library.eventById = eventById;

  const eventsByPerson = new Map<string, EventRecord[]>();
  for (const event of events) {
    for (const personId of event.people ?? []) {
      const list = eventsByPerson.get(personId);
      if (list) list.push(event);
      else eventsByPerson.set(personId, [event]);
    }
  }
  for (const list of eventsByPerson.values()) list.sort((a, b) => a.year - b.year);
  library.eventsByPerson = eventsByPerson;

  // 瘦索引缺失或失败时，用已加载的完整事件补出检索行；已存在的行不覆盖。
  const searchIds = new Set(library.eventSearch.map((row) => row.id));
  const memberships = new Map<string, EventCatalog[]>();
  for (const lineId of ['military', 'history'] as const) {
    for (const event of library.lines[lineId].events) {
      const catalogs = memberships.get(event.id);
      if (catalogs) {
        if (!catalogs.includes(lineId)) catalogs.push(lineId);
      } else memberships.set(event.id, [lineId]);
    }
  }
  for (const event of events) {
    if (searchIds.has(event.id)) continue;
    const catalogs = memberships.get(event.id);
    if (!catalogs || catalogs.length === 0) continue;
    const row: TimelineEventRecord = {
      id: event.id,
      name: event.name,
      display: event.display,
      year: event.year,
      type: event.type,
      importance: event.importance,
      catalogs,
    };
    if (event.endYear !== undefined) row.endYear = event.endYear;
    if (event.aliases && event.aliases.length > 0) row.aliases = event.aliases;
    library.eventSearch.push(row);
    searchIds.add(event.id);
  }
  library.eventSearch.sort(
    (left, right) => left.year - right.year || right.importance - left.importance || left.id.localeCompare(right.id),
  );
}

export async function createLibrary(): Promise<Library> {
  const [catalog, people, eventSearch] = await Promise.all([
    loadCatalog(dataUrl('index.json')),
    loadPeopleIndexSafely(),
    loadEventIndexSafely(),
  ]);

  const dynasties = catalog.dynasties ?? [];
  const library: Library = {
    catalog,
    topics: catalog.topics,
    lines: {
      military: emptyLine(catalog, 'military', dynasties),
      history: emptyLine(catalog, 'history', dynasties),
    },
    events: [],
    eventById: new Map(),
    eventsByPerson: new Map(),
    eventSearch,
    dynasties,
    categoryNames: new Map(catalog.categories.map((term) => [term.id, term.name])),
    polityNames: new Map((catalog.polities ?? []).map((term) => [term.id, term.name])),
    people,
    personById: new Map(people.map((record) => [record.id, record])),
    topicCache: new Map(),
    loadedLines: new Set(),
    lineLoads: new Map(),
  };
  rebuildEventIndexes(library);
  return library;
}

/** 按需加载一条完整事件线；同一路径的并发调用共享一个请求。 */
export function ensureLine(library: Library, line: TimeLineId): Promise<void> {
  if (library.loadedLines.has(line)) return Promise.resolve();
  const pending = library.lineLoads.get(line);
  if (pending) return pending;
  const file = library.catalog.lines?.find((item) => item.id === line)?.file ?? `${line}.json`;
  const task = loadLine(dataUrl(file), line)
    .then((loaded) => {
      if (library.dynasties.length === 0 && loaded.dynasties.length > 0) {
        library.dynasties = loaded.dynasties;
        library.lines[line === 'military' ? 'history' : 'military'].dynasties = loaded.dynasties;
      }
      library.lines[line] = {
        id: line,
        title: loaded.title,
        subtitle: loaded.subtitle,
        range: loaded.range,
        events: loaded.events,
        dynasties: loaded.dynasties.length > 0 ? loaded.dynasties : library.dynasties,
      };
      library.loadedLines.add(line);
      rebuildEventIndexes(library);
    })
    .finally(() => {
      library.lineLoads.delete(line);
    });
  library.lineLoads.set(line, task);
  return task;
}

/** 事件实际所属的目录；瘦索引缺失时退回两条线，保证深链仍能解析。 */
export function linesForEvent(library: Library, eventId: string): TimeLineId[] {
  const record = library.eventSearch.find((row) => row.id === eventId);
  if (record && record.catalogs.length > 0) return record.catalogs;
  return ['military', 'history'];
}

/** 选中事件前按需加载其目录；单条线失败不阻塞另一条线的事件。 */
export async function ensureEventLines(library: Library, eventId: string): Promise<void> {
  await Promise.all(
    linesForEvent(library, eventId).map((line) =>
      ensureLine(library, line).catch((error) => {
        console.warn(`[${line} 事件线加载失败]`, error);
      }),
    ),
  );
}

export async function loadTopicData(library: Library, topicId: string): Promise<Topic | null> {
  const cached = library.topicCache.get(topicId);
  if (cached) return cached;
  const entry = library.topics.find((topic) => topic.id === topicId);
  if (!entry) return null;
  const topic = await loadTopic(dataUrl(entry.file), topicId);
  library.topicCache.set(topicId, topic);
  return topic;
}

export function findTopicEntry(library: Library, topicId: string): CatalogEntry | null {
  return library.topics.find((topic) => topic.id === topicId) ?? null;
}

/** 朝代区间 → 专题：取与该朝代重叠最多的专题。用于底部朝代带跳转。 */
export function topicForDynasty(library: Library, dynastyId: string): CatalogEntry | null {
  const dynasty = library.dynasties.find((item) => item.id === dynastyId);
  if (!dynasty) return null;
  let best: CatalogEntry | null = null;
  let bestOverlap = 0;
  let nearest: CatalogEntry | null = null;
  let nearestGap = Infinity;
  for (const entry of library.topics) {
    const range = topicRange(library, entry);
    if (!range) continue;
    const overlap = Math.min(range[1], dynasty.to) - Math.max(range[0], dynasty.from);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = entry;
    }
    const gap = Math.max(range[0] - dynasty.to, dynasty.from - range[1], 0);
    if (gap < nearestGap) {
      nearestGap = gap;
      nearest = entry;
    }
  }
  return best ?? nearest;
}

/** 专题年份区间。目录里没有区间，用已加载专题的 meta，缺失时按朝代词表估算。 */
const rangeCache = new Map<string, [number, number] | null>();

/** 专题 eras 用的是 17 个时代 id，朝代词表用的是 26 个朝代 id，少数节点要换名。 */
const ERA_ALIASES: Record<string, string[]> = {
  jin: ['western-jin', 'eastern-jin'],
  'sixteen-kingdoms': ['shiliuguo'],
};

export function topicRange(library: Library, entry: CatalogEntry): [number, number] | null {
  const cached = rangeCache.get(entry.id);
  if (cached !== undefined) return cached;
  const loaded = library.topicCache.get(entry.id);
  if (loaded) {
    rangeCache.set(entry.id, loaded.meta.range);
    return loaded.meta.range;
  }
  const eraIds = entry.eras.flatMap((eraId) => ERA_ALIASES[eraId] ?? [eraId]);
  const eras = eraIds
    .map((eraId) => library.dynasties.find((item) => item.id === eraId))
    .filter((item): item is DynastyTerm => Boolean(item));
  const range: [number, number] | null =
    eras.length > 0 ? [Math.min(...eras.map((item) => item.from)), Math.max(...eras.map((item) => item.to))] : null;
  rangeCache.set(entry.id, range);
  return range;
}
