export interface BrowserLocation {
  pathname: string;
  search: string;
  hash: string;
}

export function readBrowserLocation(): BrowserLocation {
  return { pathname: location.pathname, search: location.search, hash: location.hash };
}

export function isTimelinePage(route: BrowserLocation): boolean {
  return (
    (route.pathname === '/' && Boolean(route.hash)) ||
    route.pathname.endsWith('/index.html') ||
    route.pathname === '/timeline' ||
    route.pathname === '/timeline.html' ||
    route.pathname === '/legacy.html'
  );
}
