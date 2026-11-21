/**
 * 运行时共享状态：app / render / interaction / view 四个模块共用同一份可变状态、
 * DOM 元素引用与 canvas context。状态只在这里定义一次，避免模块之间复制或循环导入。
 */

import type { Topic } from '../types';
import type { EntityGroups, LaneLayout } from './layout';
import type { Library } from './model';
import type { Route } from '../routing';
import type { TimelineState } from '../timeline-state';

export type LineId = 'people' | 'military' | 'history';
export type ChipId = 'all' | 'military' | 'political' | 'cultural' | 'female';
export type Selection = { kind: 'person' | 'event'; id: string };

export const STORAGE = {
  onboarded: 'ht-onboarded',
  line: 'ht-line',
  strip: 'ht-strip',
  lanes: 'ht-hidden-lanes',
  topic: 'ht-topic',
};
export const DEFAULT_TOPIC = 'han';

export interface AppState {
  library: Library;
  line: LineId;
  topicId: string;
  topic: Topic | null;
  /** 当前章节 id。地址栏写的是它，缩放不算换章节，所以只有切专题和点章节会改。 */
  viewId: string | null;
  domain: [number, number];
  scrollY: number;
  chip: ChipId;
  selected: Selection | null;
  /** 人物线聚焦模式：只排版选中人物及其关联人物与关联事件，收起全部无关条目。 */
  focusMode: boolean;
  /** 聚焦对比模式：额外加入同屏比对的人物 ID 集合。 */
  comparedPersonIds: Set<string>;
  /** 对比时是否展示一度关联人物（默认 false 保持对比目标极简；true 时拉入主人物关系网）。 */
  compareShowRelations: boolean;
  hiddenLanes: Set<string>;
  stripOpen: boolean;
  /** 02 同图：人物 / 战事 / 历史事件三个分组的显隐。 */
  groups: EntityGroups;
}

export let state: AppState;

export function setState(next: AppState): void {
  state = next;
}

export function selectedPersonId(): string | undefined {
  return state.selected?.kind === 'person' ? state.selected.id : undefined;
}

export function personCategoryVisible(lane: string, showPeople = state.groups.people): boolean {
  return showPeople && !state.hiddenLanes.has(`lane:${lane}`);
}

export let layouts: LaneLayout[] = [];

export function setLayouts(next: LaneLayout[]): void {
  layouts = next;
}

export let contentH = 0;

export function setContentH(next: number): void {
  contentH = next;
}

export let W = 0;
export let H = 0;

export function setViewportSize(width: number, height: number): void {
  W = width;
  H = height;
}

export let loadingTopic = false;

export function setLoadingTopic(next: boolean): void {
  loadingTopic = next;
}

/** 当前可见事件线正在加载的目录；null 表示没有可见的线加载。 */
export let loadingLine: 'military' | 'history' | null = null;

export function setLoadingLine(next: 'military' | 'history' | null): void {
  loadingLine = next;
}

export let initial: Route | null = null;
export let initialTimeline: TimelineState | null = null;

export function setInitial(next: Route | null): void {
  initial = next;
}

export function setInitialTimeline(next: TimelineState | null): void {
  initialTimeline = next;
}

export interface DragState {
  x: number;
  y: number;
  domain: [number, number];
  /** 手势开始时指针所在的年份，用于跨密度布局时保持锚点。 */
  anchor: number;
  scrollY: number;
  moved: boolean;
}

/** 指针拖拽状态；只有 interaction 写这些字段。 */
export const motion: { drag: DragState | null; dragging: boolean } = {
  drag: null,
  dragging: false,
};

export interface TimelineDom {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  ribbon: HTMLCanvasElement;
  card: HTMLElement;
  cardBody: HTMLElement;
  cardActions: HTMLElement;
  hint: HTMLElement;
  chips: HTMLElement;
  lanePanel: HTMLElement;
  laneList: HTMLElement;
  laneChapters: HTMLElement;
  stripToggle: HTMLButtonElement;
  search: HTMLInputElement;
  searchResults: HTMLElement;
  status: HTMLElement;
  exportMenu: HTMLElement;
  topbar: HTMLElement;
  focusPill?: HTMLElement | null;
  focusPillText?: HTMLElement | null;
  btnToggleRelations?: HTMLButtonElement | null;
  btnExitFocus?: HTMLButtonElement | null;
}

export const dom = {} as TimelineDom;
export let ctx: CanvasRenderingContext2D;
export let rctx: CanvasRenderingContext2D;

/** React 提交 DOM 后绑定本次挂载的元素，避免模块缓存保留已卸载的 canvas。 */
export function initializeRuntimeDom(root: ParentNode): void {
  const get = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`年表挂载缺少 ${selector}`);
    return element;
  };
  Object.assign(dom, {
    stage: get<HTMLElement>('#stage'),
    canvas: get<HTMLCanvasElement>('#chart'),
    ribbon: get<HTMLCanvasElement>('#ribbon-canvas'),
    card: get<HTMLElement>('#card'),
    cardBody: get<HTMLElement>('#card-body'),
    cardActions: get<HTMLElement>('#card-actions'),
    hint: get<HTMLElement>('#hint'),
    chips: get<HTMLElement>('#chips'),
    lanePanel: get<HTMLElement>('#lane-panel'),
    laneList: get<HTMLElement>('#lane-list'),
    laneChapters: get<HTMLElement>('#lane-chapters'),
    stripToggle: get<HTMLButtonElement>('#strip-toggle'),
    search: get<HTMLInputElement>('#search'),
    searchResults: get<HTMLElement>('#search-results'),
    status: get<HTMLElement>('#status'),
    exportMenu: get<HTMLElement>('#export-menu'),
    topbar: get<HTMLElement>('#topbar'),
    focusPill: root.querySelector<HTMLElement>('#focus-pill'),
    focusPillText: root.querySelector<HTMLElement>('#focus-pill-text'),
    btnToggleRelations: root.querySelector<HTMLButtonElement>('#btn-toggle-relations'),
    btnExitFocus: root.querySelector<HTMLButtonElement>('#btn-exit-focus'),
  } satisfies TimelineDom);
  ctx = dom.canvas.getContext('2d') as CanvasRenderingContext2D;
  rctx = dom.ribbon.getContext('2d') as CanvasRenderingContext2D;
}
/** 浏览器缩放会改变 devicePixelRatio；每次 resize 都重新读取，避免旧位图被拉伸。 */
export function currentDpr(): number {
  return Math.max(1, Math.min(3, window.devicePixelRatio || 1));
}

/** 由 app.ts 提供的编排回调；render / interaction / view 通过它调用上层流程，避免循环导入。 */
export interface AppHooks {
  setLine(line: LineId, sync?: boolean): void;
  setTopic(topicId: string, sync?: boolean): Promise<void>;
  selectAndReveal(selection: Selection, sync?: boolean, keepDomain?: boolean): Promise<void>;
  rebuildLayout(): void;
  resizeChart(): void;
  syncTimelineUrl(mode?: 'push' | 'replace'): void;
  syncFocusPill?(): void;
  toggleFocusMode?(force?: boolean): void;
  toggleComparePerson?(id: string): void;
  /** 每次绘制后同步工作区 DOM（场景头、朝代高亮、缩放读数）。 */
  syncChrome?(): void;
}

let hooks: AppHooks | null = null;

export function setHooks(next: AppHooks): void {
  hooks = next;
}

export function getHooks(): AppHooks {
  if (!hooks) throw new Error('app hooks 未初始化');
  return hooks;
}
