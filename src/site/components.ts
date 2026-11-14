import type { Accuracy, CollectionSummary, EraSummary, EventRecord, Person, SourceRef } from '../types';
import { SOURCE_KIND_NAMES, TYPE_NAMES } from '../app/skins';
import { escapeHtml } from './escape';
import { formatEventRange, formatLifeRange } from './format';
import { icon, type IconId } from './icons';

export interface SectionHeadingOptions {
  id?: string;
  level?: 2 | 3;
  description?: string;
  href?: string;
  linkLabel?: string;
  className?: string;
  iconId?: IconId;
}

/** 页面章节标题的最小结构，标题、副文案和可选入口保持一致。 */
export function sectionHeading(title: string, options: SectionHeadingOptions = {}): string {
  const level = options.level ?? 2;
  const headingId = options.id ? ` id="${escapeHtml(options.id)}"` : '';
  const action = options.href
    ? `<a href="${escapeHtml(options.href)}" data-site-link>${escapeHtml(options.linkLabel ?? '查看全部')} ${icon(options.iconId ?? 'arrow-up-right')}</a>`
    : '';
  return `<div class="${escapeHtml(options.className ?? 'lt-section-heading')}"><div><h${level}${headingId}>${escapeHtml(title)}</h${level}>${options.description ? `<p>${escapeHtml(options.description)}</p>` : ''}</div>${action}</div>`;
}

export function entityLink(kind: 'person' | 'event', id: string, label: string, className = ''): string {
  return `<a class="${escapeHtml(className)}" href="/${kind === 'person' ? 'people' : 'events'}/${encodeURIComponent(id)}" data-entity-kind="${kind}" data-entity-id="${escapeHtml(id)}">${escapeHtml(label)}</a>`;
}

export function sourceList(sources: SourceRef[], compact = false): string {
  if (sources.length === 0) return '<p class="lt-muted">出处尚未整理。</p>';
  const groups = new Map<string, SourceRef[]>();
  for (const source of sources) {
    const kind = source.kind ?? 'classic';
    groups.set(kind, [...(groups.get(kind) ?? []), source]);
  }
  return `<div class="lt-sources ${compact ? 'lt-sources-compact' : ''}">${[...groups]
    .map(
      ([kind, values]) =>
        `<section><h3>${SOURCE_KIND_NAMES[kind as keyof typeof SOURCE_KIND_NAMES]}</h3><ul>${values
          .map(
            (source) =>
              `<li><span>${escapeHtml(source.work)}${source.part ? ` · ${escapeHtml(source.part)}` : ''}</span>${kind === 'database' ? '<span class="lt-tag">检索线索</span>' : ''}${source.note ? `<small>${escapeHtml(source.note)}</small>` : ''}</li>`,
          )
          .join('')}</ul></section>`,
    )
    .join('')}</div>`;
}

export function expandableSources(sources: SourceRef[]): string {
  if (sources.length === 0) return '';
  return `<details class="lt-source-details"><summary>查看出处</summary>${sourceList(sources, true)}</details>`;
}

export function lifeDates(person: Pick<Person, 'birth' | 'birthAccuracy' | 'death' | 'deathAccuracy'>): string {
  return formatLifeRange(person);
}

export function eventDates(event: EventRecord): string {
  return formatEventRange(event);
}

export function accuracyNote(_accuracy: Accuracy | undefined, note: string | undefined, label = '查看'): string {
  if (!note) return '';
  return `<details class="lt-year-note"><summary>${escapeHtml(label)}年份说明</summary><p>${escapeHtml(note)}</p></details>`;
}

export function eventType(event: EventRecord): string {
  return `<span class="lt-event-type" data-event-type="${escapeHtml(event.type)}"><span aria-hidden="true" class="lt-event-shape"></span>${escapeHtml(TYPE_NAMES[event.type])}</span>`;
}

export interface EventSummaryOptions {
  className?: string;
  showType?: boolean;
  showPlace?: boolean;
}

/** 事件摘要只负责实体入口、时间、类型和一行正文，不承担通用卡片布局。 */
export function eventSummary(event: EventRecord, options: EventSummaryOptions = {}): string {
  const classes = ['lt-event-summary', options.className].filter(Boolean).map((value) => escapeHtml(value));
  const facts = [
    `<span class="lt-data">${escapeHtml(eventDates(event))}</span>`,
    options.showType === false ? '' : eventType(event),
    options.showPlace === false || !event.place ? '' : `<span>${escapeHtml(event.place)}</span>`,
  ].filter(Boolean);
  const excerpt = event.desc?.split('\n')[0].trim();
  return `<article class="${classes.join(' ')}"><h3>${entityLink('event', event.id, event.display || event.name)}</h3><div class="lt-event-summary-facts">${facts.join('')}</div>${excerpt ? `<p>${escapeHtml(excerpt)}</p>` : ''}</article>`;
}

export interface EraSummaryOptions {
  className?: string;
}

/** 朝代摘要只呈现名称、区间和已有编辑简介。 */
export function eraSummary(era: EraSummary, options: EraSummaryOptions = {}): string {
  const classes = ['lt-era-summary', options.className].filter(Boolean).map((value) => escapeHtml(value));
  const years = `${era.from < 0 ? `前 ${-era.from}` : era.from}—${era.to < 0 ? `前 ${-era.to}` : era.to}`;
  return `<article class="${classes.join(' ')}"><a href="/eras/${encodeURIComponent(era.id)}" data-site-link data-era-id="${escapeHtml(era.id)}"><h3>${escapeHtml(era.name)}</h3><p class="lt-data">${escapeHtml(years)} 年</p>${era.summary ? `<p>${escapeHtml(era.summary)}</p>` : ''}<span aria-hidden="true">${icon('arrow-up-right')}</span></a></article>`;
}

export interface CollectionFeatureOptions {
  className?: string;
  categoryLabel?: string;
}

/** 群像精选呈现系列入口、简介和代表人物，避免引入可变的万能 Card。 */
export function collectionFeature(collection: CollectionSummary, options: CollectionFeatureOptions = {}): string {
  const classes = ['lt-collection-feature', options.className].filter(Boolean).map((value) => escapeHtml(value));
  const featured = collection.featuredMembers.slice(0, 3);
  const category = options.categoryLabel ? `<span class="lt-tag">${escapeHtml(options.categoryLabel)}</span>` : '';
  const members = featured.length
    ? `<p>代表人物：${featured.map((person) => entityLink('person', person.id, person.display || person.name)).join('、')}</p>`
    : '';
  return `<article class="${classes.join(' ')}">${category ? `<div>${category}</div>` : ''}<h3><a href="/collections/${encodeURIComponent(collection.id)}" data-site-link>${escapeHtml(collection.name)}</a></h3><p>${escapeHtml(collection.summary)}</p>${members}<a href="/collections/${encodeURIComponent(collection.id)}" data-site-link>进入系列 ${icon('arrow-up-right')}</a></article>`;
}

export function personCard(person: Person): string {
  return `<article class="lt-related-card">${entityLink('person', person.id, person.display || person.name, 'lt-related-name')}<span class="lt-data">${lifeDates(person)}</span>${person.title ? `<p>${escapeHtml(person.title)}</p>` : ''}</article>`;
}

export function pageError(kind: 'person' | 'event', id: string, notFound: boolean): string {
  const label = kind === 'person' ? '人物' : '事件';
  return `<main class="lt-page lt-state-page" id="main-content"><h1 tabindex="-1">${notFound ? `未找到该${label}` : `暂时无法加载该${label}`}</h1><p>${notFound ? `「${escapeHtml(id)}」的链接可能已失效。` : '数据请求未完成，请重试。'}</p><div class="lt-actions">${notFound ? '' : '<button type="button" class="lt-button" data-retry>重试</button>'}<a class="lt-button lt-button-secondary" href="/search">全站搜索</a><a class="lt-button lt-button-secondary" href="/timeline">返回年表</a></div></main>`;
}
