/**
 * DOM 视图装配：详情卡、搜索、专题下拉、泳道面板、chip 状态、提示条与 tooltip。
 * 只负责写 DOM 与少量视图状态，跨模块的导航流程通过 runtime 的 hooks 回调。
 */

import { renderEventCard, renderPersonCard, type CardContext } from './cards';
import { mountPortraits } from '../site/portrait';
import { BAR_H, ROW_GAP, buildEventLayout, topicPeopleForView } from './layout';
import { TYPE_NAMES } from './skins';
import { esc, fmtYear } from './util';
import { draw, skinPalette, visibleEvents } from './render';
import { dom, getHooks, state, STORAGE, type Selection } from './runtime';

// ---------- 详情卡 ----------

function cardContext(viewedId?: string): CardContext {
  const selectedPersonId = state.line === 'people' && state.selected?.kind === 'person' ? state.selected.id : null;
  return {
    library: state.library,
    palette: skinPalette(),
    topic: state.topic,
    focusMode: state.focusMode,
    selectedPersonId,
    isCompared: Boolean(viewedId && state.comparedPersonIds?.has(viewedId)),
  };
}

const MODAL_BACKGROUND = [
  '#site-header-mount',
  '.lt-timeline-hero',
  '.lt-skip-link[data-timeline-only]',
  '#lane-panel',
  '.lt-timeline-center',
  '.lt-dynasty-band',
];

/** 移动预览是对话框：背景不可交互，桌面固定栏不改变页面可操作性。 */
export function syncCardModal(): void {
  const modal = window.innerWidth < 768 && dom.card.classList.contains('show');
  if (modal) {
    document.getElementById('lane-panel')?.classList.remove('open');
    dom.card.setAttribute('role', 'dialog');
    dom.card.setAttribute('aria-modal', 'true');
  } else {
    dom.card.removeAttribute('role');
    dom.card.removeAttribute('aria-modal');
  }
  document.querySelectorAll<HTMLElement>(MODAL_BACKGROUND.join(',')).forEach((element) => {
    element.inert = modal;
  });
}

export function trapCardFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || dom.card.getAttribute('aria-modal') !== 'true') return;
  const focusable = [
    ...dom.card.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  ].filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) {
    event.preventDefault();
    dom.card.querySelector<HTMLElement>('.card-title')?.focus();
    return;
  }
  const active = document.activeElement;
  const activeOutside = !dom.card.contains(active);
  const activeTitle = active instanceof HTMLElement && active.classList.contains('card-title');
  if (event.shiftKey && (active === first || activeOutside || activeTitle)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || activeOutside || activeTitle)) {
    event.preventDefault();
    first.focus();
  }
}

export function showCard(selection: Selection): void {
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dom.card.dataset.triggerId = trigger?.dataset.id ?? '';
  dom.card.dataset.triggerKind = trigger?.dataset.kind ?? '';
  const context = cardContext(selection.id);
  if (selection.kind === 'person') {
    dom.cardBody.innerHTML = renderPersonCard(context, selection.id);
  } else {
    const event = state.library.eventById.get(selection.id);
    if (!event) return;
    dom.cardBody.innerHTML = renderEventCard(context, event);
  }
  dom.cardActions.replaceChildren();
  const actions = dom.cardBody.querySelector<HTMLElement>('.card-actions');
  if (actions) dom.cardActions.append(actions);
  // 卡片与选中态必须同时成立：setTopic / setLine 会清掉 selected，这里重新对齐。
  state.selected = selection;
  dom.card.classList.add('show');
  mountPortraits(dom.cardBody);
  getHooks().syncTimelineUrl();
  syncCardModal();
  dom.card.querySelector<HTMLElement>('.card-title')?.setAttribute('tabindex', '-1');
  dom.card.querySelector<HTMLElement>('.card-title')?.focus({ preventScroll: true });
  const detailButton = dom.cardActions.querySelector<HTMLAnchorElement>('[data-open-detail]');
  if (detailButton) {
    detailButton.dataset.entityKind = selection.kind;
    detailButton.dataset.entityId = selection.id;
  }
}

export function hideCard(): void {
  const triggerKind = CSS.escape(dom.card.dataset.triggerKind ?? '');
  const triggerId = CSS.escape(dom.card.dataset.triggerId ?? '');
  const trigger = document.querySelector<HTMLElement>(
    `#timeline-entity-list button[data-kind="${triggerKind}"][data-id="${triggerId}"]`,
  );
  dom.card.classList.remove('show');
  dom.cardBody.innerHTML = '';
  dom.cardActions.replaceChildren();
  syncCardModal();
  state.selected = null;
  const hadFocus = state.focusMode;
  state.focusMode = false;
  state.comparedPersonIds?.clear();
  state.compareShowRelations = false;
  if (hadFocus) {
    getHooks().rebuildLayout();
    getHooks().syncFocusPill?.();
  }
  announce('已关闭详情');
  getHooks().syncTimelineUrl();
  draw();
  if (trigger) trigger.focus({ preventScroll: true });
  else dom.canvas.focus({ preventScroll: true });
}

export function hideCardSilent(): void {
  dom.card.classList.remove('show');
  dom.cardBody.innerHTML = '';
  dom.cardActions.replaceChildren();
  syncCardModal();
  state.selected = null;
  const hadFocus = state.focusMode;
  state.focusMode = false;
  state.comparedPersonIds?.clear();
  state.compareShowRelations = false;
  if (hadFocus) {
    getHooks().rebuildLayout();
    getHooks().syncFocusPill?.();
  }
}

export function announce(text: string): void {
  dom.status.textContent = text;
}

// ---------- 章节与泳道面板 ----------

export function buildLanePanel(): void {
  const laneDefs: { id: string; name: string; color: string; count: number }[] = [];
  if (state.line === 'people' && state.topic) {
    for (const lane of state.topic.lanes) {
      laneDefs.push({
        id: lane.id,
        name: lane.name,
        color: lane.color,
        count: topicPeopleForView(state.topic, state.viewId).filter((person) => person.lane === lane.id).length,
      });
    }
  } else if (state.line !== 'people') {
    const events = visibleEvents();
    for (const lane of buildEventLayout(events, state.line, new Set(), BAR_H + ROW_GAP)) {
      laneDefs.push({ id: lane.id, name: lane.name, color: lane.color, count: lane.items.length });
    }
  }

  dom.laneList.innerHTML = laneDefs
    .map(
      (lane) => `
    <label class="lane-row">
      <input type="checkbox" data-lane="${esc(lane.id)}" ${state.hiddenLanes.has(laneKey(lane.id)) ? '' : 'checked'} />
      <span class="lane-swatch" style="background:${esc(lane.color)}"></span>
      <span>${esc(lane.name)}</span>
      <span class="lane-count">${lane.count}</span>
    </label>
  `,
    )
    .join('');

  const views = state.line === 'people' ? (state.topic?.views ?? []) : [];
  dom.laneChapters.innerHTML =
    views.length === 0
      ? ''
      : `<div class="lane-panel-head"><span>章节</span></div>` +
        views
          .map(
            (view) =>
              `<button type="button" class="lane-chapter" data-view="${esc(view.id)}" ${view.id === state.viewId ? 'aria-current="true"' : ''}>${esc(view.name)}</button>`,
          )
          .join('');
}

/** 泳道勾选按当前内容线隔离，避免人物泳道 id 与事件类型 id 互相影响。 */
const laneKey = (id: string): string => (state.line === 'people' ? `lane:${id}` : `type:${id}`);

export function toggleLane(id: string, show: boolean): void {
  const key = laneKey(id);
  if (show) state.hiddenLanes.delete(key);
  else state.hiddenLanes.add(key);
  localStorage.setItem(STORAGE.lanes, JSON.stringify([...state.hiddenLanes]));
  getHooks().rebuildLayout();
  getHooks().syncTimelineUrl();
  draw();
}

export function setAllLanes(show: boolean): void {
  const keys = [...dom.laneList.querySelectorAll<HTMLInputElement>('input[data-lane]')].map((input) =>
    laneKey(input.dataset.lane ?? ''),
  );
  for (const key of keys) {
    if (show) state.hiddenLanes.delete(key);
    else state.hiddenLanes.add(key);
  }
  localStorage.setItem(STORAGE.lanes, JSON.stringify([...state.hiddenLanes]));
  buildLanePanel();
  getHooks().rebuildLayout();
  getHooks().syncTimelineUrl();
  draw();
}

// ---------- 事件条等视图状态 ----------

export function syncStripToggle(): void {
  const inPeople = state.line === 'people';
  dom.stripToggle.style.display = inPeople ? 'block' : 'none';
  dom.stripToggle.textContent = state.stripOpen ? '事件条 ▴' : '事件条 ▾';
  dom.stripToggle.setAttribute('aria-expanded', String(inPeople && state.stripOpen));
  document.body.classList.toggle('strip-open', inPeople && state.stripOpen);
  getHooks().resizeChart();
}

// ---------- 搜索 ----------

interface SearchHit {
  kind: 'person' | 'event';
  id: string;
  title: string;
  meta: string;
}

function aliasEventId(query: string): string | undefined {
  const needle = query.trim();
  // 事件瘦索引最多几百条，直接反查即可；不缓存，事件线按需加载后不会读到旧索引。
  for (let index = state.library.eventSearch.length - 1; index >= 0; index -= 1) {
    const record = state.library.eventSearch[index];
    if (record.aliases?.includes(needle)) return record.id;
  }
  return undefined;
}

export function runSearch(query: string): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const hits: SearchHit[] = [];
  const aliasId = aliasEventId(query);

  for (const record of state.library.people) {
    const fields = [record.name, record.display, ...(record.aliases ?? []), ...(record.tags ?? [])];
    if (!fields.some((field) => field && field.toLowerCase().includes(needle))) continue;
    hits.push({
      kind: 'person',
      id: record.id,
      title: record.display || record.name,
      meta: record.topicTitle,
    });
    if (hits.length >= 8) break;
  }

  const eventHits: SearchHit[] = [];
  for (const event of state.library.eventSearch) {
    if (eventHits.length >= 8) break;
    const matched =
      event.id === aliasId ||
      [event.name, event.display, ...(event.aliases ?? [])].some(
        (field) => field && field.toLowerCase().includes(needle),
      );
    if (!matched) continue;
    eventHits.push({
      kind: 'event',
      id: event.id,
      title: event.display || event.name,
      meta: `${TYPE_NAMES[event.type]} · ${fmtYear(event.year)}`,
    });
  }
  return [...hits, ...eventHits];
}

export function renderSearchResults(query: string): void {
  const hits = runSearch(query);
  if (hits.length === 0) {
    dom.searchResults.hidden = query.trim().length === 0;
    dom.searchResults.innerHTML =
      query.trim().length === 0 ? '' : `<div class="search-empty">没有匹配「${esc(query.trim())}」的条目</div>`;
    return;
  }
  const canCompare = Boolean(state.line === 'people' && state.selected?.kind === 'person');
  dom.searchResults.innerHTML = hits
    .map((hit) => {
      const isPerson = hit.kind === 'person';
      const isSelected = isPerson && state.selected?.id === hit.id;
      const isCompared = isPerson && Boolean(state.comparedPersonIds?.has(hit.id));
      const showCompareBtn = canCompare && isPerson && !isSelected;
      return `
    <div class="search-hit" data-kind="${hit.kind}" data-id="${esc(hit.id)}">
      <button type="button" class="search-hit-main" data-action="select" data-kind="${hit.kind}" data-id="${esc(hit.id)}">
        <span class="search-hit-title">${esc(hit.title)}</span>
        <span class="search-hit-meta">${esc(hit.meta)}</span>
      </button>
      ${
        showCompareBtn
          ? `<button type="button" class="search-hit-compare ${isCompared ? 'active' : ''}" data-action="toggle-compare" data-id="${esc(hit.id)}" title="${isCompared ? '取消对比' : '加入对比'}">
              ${isCompared ? '已对比' : '+ 对比'}
            </button>`
          : ''
      }
    </div>
  `;
    })
    .join('');
  dom.searchResults.hidden = false;
}

// ---------- 悬浮提示 ----------

export function personTooltip(id: string): string {
  const person = state.topic?.people.find((item) => item.id === id);
  const record = state.library.personById.get(id);
  const label = person?.display ?? record?.display ?? id;
  const birth = person?.birth ?? record?.birth;
  const death = person?.death ?? record?.death;
  return `${label}　${birth != null ? fmtYear(birth) : '生年不详'} — ${death != null ? fmtYear(death) : '卒年不详'}`;
}

export function eventTooltip(id: string): string {
  const event = state.library.eventById.get(id);
  if (!event) return id;
  const range =
    event.endYear && event.endYear !== event.year
      ? `${fmtYear(event.year)} — ${fmtYear(event.endYear)}`
      : fmtYear(event.year);
  return `${event.display || event.name}　${range}`;
}

let hintTimer = 0;
const DEFAULT_HINT = '滚轮缩放 · 拖动平移 · 点击人物或事件 · 底部朝代带可跳转';

export function flashHint(text: string): void {
  dom.hint.textContent = text;
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => {
    dom.hint.textContent = DEFAULT_HINT;
  }, 2600);
}
