export const SITE_ROUTE_EVENT = 'lantai:route';
export const TIMELINE_ROUTE_EVENT = 'lantai:timeline';

export function dispatchSiteRoute(): void {
  window.dispatchEvent(new Event(SITE_ROUTE_EVENT));
}

export function dispatchTimelineRoute(): void {
  window.dispatchEvent(new Event(TIMELINE_ROUTE_EVENT));
}
