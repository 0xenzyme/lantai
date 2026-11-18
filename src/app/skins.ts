import type { EventScale, EventType, SourceRef } from '../types';

/**
 * 画布配色。颜色值全部来自 src/styles.css 的自定义属性（body.skin-voyage），
 * 运行时由 paletteFor() 读回，画布与外框不可能各画一份。
 */
export interface Palette {
  paper: string;
  ink: string;
  ink2: string;
  muted: string;
  line: string;
  hair: string;
  accent: string;
  laneLabel: string;
  headerBg: string;
  axisText: string;
  labelInBar: string;
  ribbonBg: string;
  ribbonText: string;
  density: string;
  viewportWash: string;
  eventAlpha: number;
  eventAlphaDim: number;
}

type ColorToken = Exclude<keyof Palette, 'eventAlpha' | 'eventAlphaDim'>;

/** token → styles.css 里的变量名。加 token 必须在 styles.css 的 body.skin-voyage 里补变量。 */
const PALETTE_VARS: Record<ColorToken, string> = {
  paper: '--bg',
  ink: '--ink',
  ink2: '--ink-2',
  muted: '--muted',
  line: '--line',
  hair: '--hair',
  accent: '--accent',
  laneLabel: '--canvas-lane-label',
  headerBg: '--canvas-header-bg',
  axisText: '--canvas-axis-text',
  labelInBar: '--canvas-label-in-bar',
  ribbonBg: '--ribbon-bg',
  ribbonText: '--canvas-ribbon-text',
  density: '--canvas-density',
  viewportWash: '--canvas-viewport-wash',
};

const EVENT_ALPHA = 0.1;
const EVENT_ALPHA_DIM = 0.03;

/** 底部朝代带色带色（无 CSS 对应的字面量）：淡彩宣纸色。 */
export function ribbonBand(hue: number): string {
  return `hsl(${hue}, 26%, 76%)`;
}

const paletteCache = new Map<string, Palette>();

/** 丢弃缓存：开发期样式热更新后重新读变量。 */
export function invalidatePalette(): void {
  paletteCache.clear();
}

/**
 * 读取画布配色。
 * 变量必须已经挂在 document.body 上，所以只能在 body 加上 skin-voyage class 之后调用；
 * 缺变量直接抛错，不能画出一片空白。
 */
export function paletteFor(): Palette {
  const cached = paletteCache.get('voyage');
  if (cached) return cached;
  if (!document.body.classList.contains('skin-voyage')) {
    throw new Error('读取画布配色时 body 上没有 skin-voyage，配色会和样式错位');
  }
  const style = getComputedStyle(document.body);
  const colors = {} as Record<ColorToken, string>;
  const missing: string[] = [];
  for (const [token, name] of Object.entries(PALETTE_VARS) as Array<[ColorToken, string]>) {
    const value = style.getPropertyValue(name).trim();
    if (!value) missing.push(name);
    colors[token] = value;
  }
  if (missing.length > 0) {
    throw new Error(`styles.css 的 body.skin-voyage 缺少变量：${missing.join('、')}`);
  }
  const next: Palette = {
    ...colors,
    eventAlpha: EVENT_ALPHA,
    eventAlphaDim: EVENT_ALPHA_DIM,
  };
  paletteCache.set('voyage', next);
  return next;
}

export const EVENT_COLORS: Record<EventType, string> = {
  military: '#b0442f',
  political: '#33658a',
  rebellion: '#8f4a55',
  institutional: '#3f7d52',
  diplomatic: '#6b5b95',
  cultural: '#a8763a',
};

export const TYPE_NAMES: Record<EventType, string> = {
  military: '军事',
  political: '政治',
  rebellion: '民变',
  institutional: '制度',
  diplomatic: '盟约',
  cultural: '文化',
};

export const SCALE_NAMES: Record<EventScale, string> = {
  war: '战争',
  campaign: '战役',
  battle: '会战',
  engagement: '交锋',
};

export const SOURCE_KIND_NAMES: Record<NonNullable<SourceRef['kind']>, string> = {
  classic: '典籍',
  modern: '现代考证',
  database: '数据库',
};
