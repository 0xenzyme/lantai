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
      const personRelationMode = target.closest<HTMLButtonElement>('[data-person-relation-mode]');
      if (personRelationMode) {
        event.preventDefault();
        event.stopPropagation();
        const mode = personRelationMode.dataset.personRelationMode;
        const panel = personRelationMode.closest('.lt-person-relations-panel');
        if (panel) {
          const graph = panel.querySelector<HTMLElement>('.lt-person-relation-graph-container');
          const list = panel.querySelector<HTMLElement>('.lt-person-relation-list-container');
          if (graph && list) {
            graph.hidden = mode === 'list';
            list.hidden = mode === 'graph';
          }
          panel.querySelectorAll<HTMLButtonElement>('[data-person-relation-mode]').forEach((btn) => {
            btn.setAttribute('aria-pressed', String(btn === personRelationMode));
          });
        }
        return;
      }
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
  wirePersonGraphInteractions(root, signal);
  return () => controller.abort();
}

function wirePersonGraphInteractions(root: HTMLElement, signal: AbortSignal): void {
  // 1. 分类过滤切换
  root.addEventListener(
    'click',
    (event) => {
      const filterBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-graph-filter]');
      if (!filterBtn) return;
      event.preventDefault();
      event.stopPropagation();
      const filterType = filterBtn.dataset.graphFilter ?? 'all';
      const wrapper = filterBtn.closest('.lt-local-relation-graph-wrapper');
      if (!wrapper) return;

      wrapper.querySelectorAll<HTMLButtonElement>('[data-graph-filter]').forEach((b) => {
        b.classList.toggle('is-active', b === filterBtn);
      });

      const edges = wrapper.querySelectorAll<SVGGElement>('.lt-local-graph-edge');
      const nodes = wrapper.querySelectorAll<SVGGElement>('.lt-local-graph-node');

      if (filterType === 'all') {
        edges.forEach((e) => e.classList.remove('is-hidden'));
        nodes.forEach((n) => n.classList.remove('is-hidden'));
      } else {
        const visibleNodeIds = new Set<string>();
        edges.forEach((e) => {
          const match = e.dataset.edgeType === filterType;
          e.classList.toggle('is-hidden', !match);
          if (match) {
            if (e.dataset.source) visibleNodeIds.add(e.dataset.source);
            if (e.dataset.target) visibleNodeIds.add(e.dataset.target);
          }
        });
        nodes.forEach((n) => {
          const id = n.dataset.nodeId;
          const isCenter = n.classList.contains('is-center');
          const visible = isCenter || (id ? visibleNodeIds.has(id) : false);
          n.classList.toggle('is-hidden', !visible);
        });
      }
    },
    { signal },
  );

  // 2. 展开大图/恢复视窗
  root.addEventListener(
    'click',
    (event) => {
      const expandBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-graph-action="expand-modal"]');
      if (!expandBtn) return;
      event.preventDefault();
      event.stopPropagation();
      const wrapper = expandBtn.closest('.lt-local-relation-graph-wrapper');
      if (!wrapper) return;
      const isExpanded = wrapper.classList.toggle('is-expanded-view');
      expandBtn.textContent = isExpanded ? '✕ 恢复视窗' : '⛶ 展开大图';
      expandBtn.setAttribute('title', isExpanded ? '退出大图模式' : '全屏查看图谱');
    },
    { signal },
  );

  // 3. 类似 Obsidian 的节点物理拖拽互动 (Drag & Tension)
  let activeNode: SVGGElement | null = null;
  let activeSvg: SVGSVGElement | null = null;
  let startPointer = { x: 0, y: 0 };
  let startCenter = { x: 0, y: 0 };
  let nodeId = '';
  let relatedEdges: Array<{ line: SVGLineElement; isSource: boolean }> = [];

  root.addEventListener(
    'pointerdown',
    (event) => {
      const nodeEl = (event.target as HTMLElement).closest<SVGGElement>('.lt-local-graph-node');
      if (!nodeEl) return;
      const svg = nodeEl.closest<SVGSVGElement>('svg.lt-local-graph-svg');
      if (!svg) return;

      const circle = nodeEl.querySelector('circle.lt-graph-node-circle');
      if (!circle) return;

      activeNode = nodeEl;
      activeSvg = svg;
      nodeId = nodeEl.dataset.nodeId ?? '';
      activeNode.classList.add('is-dragging');

      const cx = parseFloat(circle.getAttribute('cx') || '0');
      const cy = parseFloat(circle.getAttribute('cy') || '0');
      startCenter = { x: cx, y: cy };
      startPointer = { x: event.clientX, y: event.clientY };

      relatedEdges = [];
      svg.querySelectorAll<SVGGElement>('.lt-local-graph-edge').forEach((edge) => {
        const line = edge.querySelector('line');
        if (!line) return;
        if (edge.dataset.source === nodeId) {
          relatedEdges.push({ line, isSource: true });
        } else if (edge.dataset.target === nodeId) {
          relatedEdges.push({ line, isSource: false });
        }
      });

      nodeEl.setPointerCapture(event.pointerId);
    },
    { signal },
  );

  root.addEventListener(
    'pointermove',
    (event) => {
      if (!activeNode || !activeSvg) return;

      const rect = activeSvg.getBoundingClientRect();
      const scaleX = 760 / (rect.width || 760);
      const scaleY = 480 / (rect.height || 480);

      const dx = (event.clientX - startPointer.x) * scaleX;
      const dy = (event.clientY - startPointer.y) * scaleY;

      const newX = Math.max(20, Math.min(740, startCenter.x + dx));
      const newY = Math.max(20, Math.min(460, startCenter.y + dy));

      activeNode.querySelectorAll('circle').forEach((c) => {
        c.setAttribute('cx', newX.toFixed(1));
        c.setAttribute('cy', newY.toFixed(1));
      });
      const initialText = activeNode.querySelector('text.lt-graph-node-initial');
      if (initialText) {
        initialText.setAttribute('x', newX.toFixed(1));
        const isCenter = activeNode.classList.contains('is-center');
        initialText.setAttribute('y', (newY + (isCenter ? 6 : 5)).toFixed(1));
      }
      const nameText = activeNode.querySelector('text.lt-graph-node-name');
      if (nameText) {
        nameText.setAttribute('x', newX.toFixed(1));
        const radius = parseFloat(activeNode.querySelector('circle.lt-graph-node-circle')?.getAttribute('r') || '20');
        nameText.setAttribute('y', (newY + radius + 14).toFixed(1));
      }

      relatedEdges.forEach(({ line, isSource }) => {
        if (isSource) {
          line.setAttribute('x1', newX.toFixed(1));
          line.setAttribute('y1', newY.toFixed(1));
        } else {
          line.setAttribute('x2', newX.toFixed(1));
          line.setAttribute('y2', newY.toFixed(1));
        }
      });
    },
    { signal },
  );

  const endDrag = () => {
    if (activeNode) {
      activeNode.classList.remove('is-dragging');
      activeNode = null;
      activeSvg = null;
      relatedEdges = [];
    }
  };

  root.addEventListener('pointerup', endDrag, { signal });
  root.addEventListener('pointercancel', endDrag, { signal });
}
