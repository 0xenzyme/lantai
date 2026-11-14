export const SITE_ROUTE_EVENT = 'lantai:route';
export const TIMELINE_ROUTE_EVENT = 'lantai:timeline';
export const SKIN_CHANGE_EVENT = 'lantai:skin-change';

export function dispatchSiteRoute(): void {
  window.dispatchEvent(new Event(SITE_ROUTE_EVENT));
}

export function dispatchTimelineRoute(): void {
  window.dispatchEvent(new Event(TIMELINE_ROUTE_EVENT));
}

export function selectSkin(skin: 'voyage' | 'deepspace'): void {
  localStorage.setItem('ht-skin', skin);
  window.dispatchEvent(new CustomEvent(SKIN_CHANGE_EVENT, { detail: skin }));
}
