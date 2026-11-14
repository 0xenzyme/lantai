import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { wireEntityLinks, wireReturnLinks, wireSiteLinks } from '../site/context';
import { isTimelinePage, readBrowserLocation, type BrowserLocation } from './location';
import { SITE_ROUTE_EVENT, TIMELINE_ROUTE_EVENT } from './navigation-events';
import { SitePage } from './SitePage';
import { TimelinePage } from './TimelinePage';

export function App() {
  const [route, setRoute] = useState<BrowserLocation>(readBrowserLocation);
  const timeline = isTimelinePage(route);

  useEffect(() => {
    const update = () => flushSync(() => setRoute(readBrowserLocation()));
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    window.addEventListener(SITE_ROUTE_EVENT, update);
    window.addEventListener(TIMELINE_ROUTE_EVENT, update);
    const cleanups = [wireEntityLinks(), wireReturnLinks(), wireSiteLinks()];
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
      window.removeEventListener(SITE_ROUTE_EVENT, update);
      window.removeEventListener(TIMELINE_ROUTE_EVENT, update);
      cleanups.forEach((cleanup) => cleanup());
      history.scrollRestoration = previousRestoration;
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle(
      'timeline-legacy',
      timeline && (route.pathname !== '/timeline' || Boolean(route.hash)),
    );
    if (timeline) {
      document.title = '年表 · 兰台';
    } else {
      document.title = '正在加载 · 兰台';
      document.body.classList.remove('skin-deepspace');
      document.body.classList.add('skin-voyage');
    }
  }, [timeline, route.pathname, route.hash]);

  return timeline ? <TimelinePage /> : <SitePage route={route} />;
}
