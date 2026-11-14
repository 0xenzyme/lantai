import { openSiteUrl } from './context';

let collectionTabFocusRequest: string | undefined;

export function consumeCollectionTabFocusRequest(): string | undefined {
  const requested = collectionTabFocusRequest;
  collectionTabFocusRequest = undefined;
  return requested;
}

export function wirePageControls(root: HTMLElement): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  root.addEventListener(
    'keydown',
    (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      const tabs = (event.target as HTMLElement).closest<HTMLElement>('[data-collection-tabs]');
      if (!tabs) return;
      const links = [...tabs.querySelectorAll<HTMLAnchorElement>('a[data-collection-tab]')];
      const current = links.indexOf(document.activeElement as HTMLAnchorElement);
      if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? links.length - 1
            : (current + (event.key === 'ArrowLeft' ? -1 : 1) + links.length) % links.length;
      collectionTabFocusRequest = links[next]?.dataset.collectionTab;
      links[next]?.focus();
      links[next]?.click();
    },
    { signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement;
      const viewButton = target.closest<HTMLButtonElement>('[data-collection-view-mode]');
      if (viewButton) {
        event.preventDefault();
        event.stopPropagation();
        const graph = root.querySelector<HTMLElement>('.lt-relation-graph-container');
        if (graph) graph.hidden = viewButton.dataset.collectionViewMode === 'list';
        root.querySelectorAll<HTMLButtonElement>('[data-collection-view-mode]').forEach((item) => {
          item.setAttribute('aria-pressed', String(item === viewButton));
        });
        root.querySelectorAll<HTMLButtonElement>('[data-collection-member-filter]').forEach((item) => {
          const url = new URL(item.dataset.collectionUrl!, location.href);
          url.searchParams.set('relation', viewButton.dataset.collectionViewMode!);
          item.dataset.collectionUrl = `${url.pathname}${url.search}${url.hash}`;
        });
        const url = new URL(location.href);
        url.searchParams.set('relation', viewButton.dataset.collectionViewMode!);
        if (history.state?.lantaiCollection) {
          history.replaceState(
            {
              ...history.state,
              lantaiCollection: {
                ...history.state.lantaiCollection,
                relationMode: viewButton.dataset.collectionViewMode,
              },
            },
            '',
            location.href,
          );
        }
        history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
        return;
      }
      const memberFilter = target.closest<HTMLButtonElement>('[data-collection-member-filter]');
      if (memberFilter?.dataset.collectionUrl) {
        openSiteUrl(memberFilter.dataset.collectionUrl);
        return;
      }
      if (target.closest('[data-filter-open]')) {
        const dialog = root.querySelector<HTMLDialogElement>('[data-filter-dialog]');
        dialog?.showModal();
        dialog?.querySelector<HTMLElement>('select, input, button')?.focus();
        return;
      }
      const close = target.closest<HTMLButtonElement>('[data-filter-close]');
      if (close) {
        close.closest('dialog')?.close();
        root.querySelector<HTMLButtonElement>('[data-filter-open]')?.focus();
        return;
      }
      const dialog = target.closest<HTMLDialogElement>('[data-filter-dialog]');
      if (dialog && event.target === dialog) dialog.close();
    },
    { signal },
  );
  return () => controller.abort();
}
