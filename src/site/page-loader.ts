import { collectionPage } from './collection';
import { collectionsDirectory, eventsDirectory, peopleDirectory } from './directories';
import { eraPage, erasDirectory } from './eras';
import { homePage } from './home';
import { eventPage } from './event';
import { personPage } from './person';
import { searchPage, type SearchKind } from './search';
import { loadCollectionPeople, loadSiteLibrary, type SiteDataKey, type SiteLibrary } from './data';
import type { CollectionViewState } from './collection-views';
import type { SiteSection } from '../react/SiteHeader';

export interface SitePageResult {
  key: string;
  content: string;
  library: SiteLibrary;
  section: SiteSection;
  query: string;
}

const PAGE_TITLES = new Map([
  ['/', '中国历史时间轴'],
  ['/people', '列传 · 中国历史人物'],
  ['/events', '纪事 · 中国历史事件'],
  ['/eras', '断代 · 中国历史朝代'],
  ['/collections', '群像 · 历史人物专题'],
]);

export function sitePageTitle(path: string, heading: string): string {
  return `${PAGE_TITLES.get(path) ?? heading} · 兰台`;
}

export function siteSectionFor(path: string): SiteSection {
  if (path === '/') return 'home';
  if (path.startsWith('/people')) return 'people';
  if (path.startsWith('/collections')) return 'collections';
  if (path.startsWith('/events')) return 'events';
  if (path.startsWith('/eras')) return 'eras';
  if (path.startsWith('/search')) return 'search';
  return 'other';
}

function routeEntityId(path: string): string {
  try {
    return decodeURIComponent(path.split('/')[2]);
  } catch {
    return path.split('/')[2];
  }
}

function requiredData(path: string): SiteDataKey[] {
  // 首页事件来自目录的 homeEvents，不再加载两条完整事件线。
  if (path === '/') return ['catalog', 'collections', 'eras'];
  if (path === '/search') return ['catalog', 'people', 'history', 'military', 'collections', 'eras'];
  if (path === '/people') return ['catalog', 'people', 'collections'];
  if (path === '/events') return ['people', 'history', 'military', 'eras'];
  if (path === '/collections') return ['catalog', 'collections'];
  if (path === '/eras') return ['eras'];
  if (path.startsWith('/eras/')) return ['catalog', 'collections', 'eras'];
  if (path.startsWith('/collections/')) return ['catalog'];
  return ['catalog', 'people', 'history', 'military', 'collections'];
}

export async function loadSitePage(
  pathname: string,
  search: string,
  options: { defaultRelationMode?: CollectionViewState['relationMode']; replaceUrl?: (url: string) => void } = {},
): Promise<SitePageResult> {
  const path = pathname.replace(/\/+$/, '') || '/';
  const query = new URLSearchParams(search);
  const section = siteSectionFor(path);
  const library = await loadSiteLibrary(requiredData(path));
  let content: string;
  if (path === '/') {
    const collectionId = library.catalog?.editorial?.collections[0];
    const personId = library.collections.find((collection) => collection.id === collectionId)?.featuredMembers[0]?.id;
    const { people } = personId ? await loadCollectionPeople([personId]) : { people: [] };
    content = homePage(library, people);
  } else if (/^\/people\/[^/]+$/.test(path)) content = await personPage(routeEntityId(path), library);
  else if (/^\/events\/[^/]+$/.test(path)) content = await eventPage(routeEntityId(path), library);
  else if (/^\/eras\/[^/]+$/.test(path))
    content = await eraPage(routeEntityId(path), library, search, options.replaceUrl);
  else if (/^\/collections\/[^/]+$/.test(path))
    content = await collectionPage(routeEntityId(path), library, { ...options, search });
  else if (path === '/search') {
    const requested = query.get('type');
    const type: SearchKind = ['person', 'event', 'collection', 'dynasty'].includes(requested ?? '')
      ? (requested as SearchKind)
      : 'all';
    content = searchPage(query.get('q') ?? '', type, library, requested !== null && requested !== type);
  } else if (path === '/people') content = peopleDirectory(library, search);
  else if (path === '/events') content = eventsDirectory(library, search);
  else if (path === '/collections') content = collectionsDirectory(library, search);
  else if (path === '/eras') content = erasDirectory(library, search);
  else {
    content = `<main class="lt-page lt-state-page" id="main-content"><h1 tabindex="-1">未找到该页面</h1><p>链接可能已失效。</p><a class="lt-button" href="/" data-site-link>返回首页</a></main>`;
  }
  const requiredDataFailure =
    (path === '/events' && library.events.length === 0) ||
    (path === '/collections' && library.failures.includes('collections')) ||
    ((path === '/eras' || path === '/events') && library.failures.includes('eras')) ||
    (path === '/events' && library.failures.length > 0);
  if (requiredDataFailure) throw new Error('目录核心数据暂时无法加载，请重试。');
  if (library.failures.length > 0 && !/^\/(eras|collections)\/[^/]+$/.test(path)) {
    content = `<aside class="lt-notice" role="status">部分关联数据暂时无法加载，当前可用内容仍可浏览。<button type="button" data-retry>重试</button></aside>${content}`;
  }
  content = content.replaceAll(
    /href="(\/timeline[^"]*)"/g,
    (_match, url: string) => `href="${url}" data-timeline-link`,
  );
  return { key: `${path}${search}`, content, library, section, query: query.get('q') ?? '' };
}
