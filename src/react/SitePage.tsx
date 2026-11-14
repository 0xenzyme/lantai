import { useEffect, useRef, useState } from 'react';
import { COLLECTION_VIEW_NAMES, type CollectionViewState } from '../site/collection-views';
import type { CollectionView } from '../types';
import { retryCollection, retrySiteData, type SiteDataKey } from '../site/data';
import { escapeHtml } from '../site/escape';
import { loadSitePage, siteSectionFor, type SitePageResult } from '../site/page-loader';
import { consumeCollectionTabFocusRequest, wirePageControls } from '../site/page-controls';
import { mountPortraits } from '../site/portrait';
import type { BrowserLocation } from './location';
import { SiteHeader } from './SiteHeader';

const LOADING_CONTENT = `<main class="lt-page lt-state-page" id="main-content"><h1 tabindex="-1">正在加载</h1><p>正在读取页面数据。</p><div class="lt-loading-rows" aria-hidden="true"><span></span><span></span><span></span></div></main>`;

interface PageError {
  key: string;
  message: string;
}

export function SitePage({ route }: { route: BrowserLocation }) {
  const [result, setResult] = useState<SitePageResult | null>(null);
  const [error, setError] = useState<PageError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const pageRef = useRef<HTMLDivElement>(null);
  const path = route.pathname.replace(/\/+$/, '') || '/';
  const requestKey = `${path}${route.search}`;
  const currentResult = result?.key === requestKey ? result : null;
  const currentError = error?.key === requestKey ? error : null;

  useEffect(() => {
    let active = true;
    setResult(null);
    setError(null);
    document.title = '正在加载 · 兰台';
    if (/^\/(people|events)\/[^/]+$/.test(path) && !history.state?.lantaiDetail) {
      history.replaceState({ ...(history.state ?? {}), lantaiDetail: true }, '', location.href);
    }
    void loadSitePage(path, route.search)
      .then((next) => {
        if (active) setResult(next);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError({ key: requestKey, message: reason instanceof Error ? reason.message : String(reason) });
        }
      });
    return () => {
      active = false;
    };
  }, [path, route.search, reloadKey]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page || (!currentResult && !currentError)) return;
    const requestedTabFocus = consumeCollectionTabFocusRequest();
    document.title = `${page.querySelector('h1')?.textContent?.trim() ?? '兰台'} · 兰台`;
    const collectionTab = page.querySelector<HTMLElement>('[data-collection-tabs]');
    if (collectionTab && requestedTabFocus) {
      collectionTab.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
    } else if (route.hash) {
      let id = '';
      try {
        id = decodeURIComponent(route.hash.slice(1));
      } catch {
        id = route.hash.slice(1);
      }
      const target = id ? document.getElementById(id) : null;
      if (target instanceof HTMLElement) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        target.scrollIntoView();
      } else {
        page.querySelector<HTMLElement>('h1[tabindex="-1"]')?.focus({ preventScroll: true });
      }
    } else {
      page.querySelector<HTMLElement>('h1[tabindex="-1"]')?.focus({ preventScroll: true });
    }

    const source = (history.state?.lantaiSource ?? history.state?.lantaiRestore ?? null) as {
      url?: string;
      scrollY?: number;
    } | null;
    let restoreFrame = 0;
    if (source?.url) {
      const sourceUrl = new URL(source.url);
      const sourcePath = sourceUrl.pathname.replace(/\/+$/, '') || '/';
      if (sourcePath === path && sourceUrl.search === route.search && source.scrollY !== undefined) {
        restoreFrame = requestAnimationFrame(() => window.scrollTo({ top: source.scrollY!, behavior: 'instant' }));
      }
    }

    if (collectionTab) {
      const tab = collectionTab.querySelector<HTMLElement>('[aria-selected="true"]')?.dataset.collectionTab;
      collectionTab.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'instant',
      });
      if (tab && Object.keys(COLLECTION_VIEW_NAMES).includes(tab)) {
        history.replaceState(
          {
            ...(history.state ?? {}),
            lantaiCollection: {
              tab: tab as CollectionView,
              member: new URLSearchParams(route.search).get('member') ?? undefined,
              relationMode: new URLSearchParams(route.search).get('relation') === 'list' ? 'list' : 'graph',
              invalid: [],
            } satisfies CollectionViewState,
          },
          '',
          location.href,
        );
      }
    }

    const cleanupControls = wirePageControls(page);
    mountPortraits(page);
    const controller = new AbortController();
    const reload = () => {
      setResult(null);
      setError(null);
      setReloadKey((key) => key + 1);
    };
    page.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!button) return;
        if (button.dataset.retryCollection) {
          retryCollection(button.dataset.retryCollection);
          reload();
        } else if (button.hasAttribute('data-collection-retry')) {
          reload();
        } else if (button.hasAttribute('data-retry')) {
          const key = button.dataset.retry;
          retrySiteData(
            key && ['catalog', 'people', 'history', 'military', 'collections', 'eras'].includes(key)
              ? (key as SiteDataKey)
              : undefined,
          );
          reload();
        }
      },
      { signal: controller.signal },
    );
    page.addEventListener(
      'error',
      (event) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.hasAttribute('data-collection-cover')) return;
        image.remove();
        const fallback = page.querySelector<HTMLElement>('[data-collection-cover-fallback]');
        if (fallback) fallback.hidden = false;
      },
      { capture: true, signal: controller.signal },
    );
    return () => {
      cancelAnimationFrame(restoreFrame);
      controller.abort();
      cleanupControls();
    };
  }, [currentResult, currentError, path, route.search, route.hash]);

  const content = currentError
    ? `<main class="lt-page lt-state-page" id="main-content"><h1 tabindex="-1">暂时无法加载页面</h1><p>${escapeHtml(currentError.message)}</p><button class="lt-button" type="button" data-retry>重试</button><a class="lt-button lt-button-secondary" href="/" data-site-link>返回首页</a></main>`
    : (currentResult?.content ?? LOADING_CONTENT);

  return (
    <>
      <SiteHeader
        section={currentResult?.section ?? siteSectionFor(path)}
        query={currentResult?.query ?? new URLSearchParams(route.search).get('q') ?? ''}
      />
      <div
        ref={pageRef}
        id="site-page"
        aria-busy={!currentResult && !currentError}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </>
  );
}
