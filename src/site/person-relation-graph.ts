import { escapeHtml } from './escape';
import type { PersonDetail } from '../types';
import type { SiteLibrary } from './data';

export const RELATION_TYPE_NAMES: Record<string, string> = {
  'ruler-subject': '君臣',
  kin: '亲族',
  peer: '同僚',
  rival: '敌对',
  mentor: '师承',
};

export const RELATION_COLORS: Record<string, { stroke: string; bg: string; text: string }> = {
  'ruler-subject': { stroke: '#24527a', bg: '#eaf2f8', text: '#1b3e64' },
  mentor: { stroke: '#0d766e', bg: '#e6f7f5', text: '#08504a' },
  kin: { stroke: '#2e7d32', bg: '#edf7ed', text: '#1b5e20' },
  peer: { stroke: '#5e4b8b', bg: '#f3effa', text: '#43347c' },
  rival: { stroke: '#b91c1c', bg: '#fef2f2', text: '#991b1b' },
};

export interface LocalGraphNode {
  id: string;
  name: string;
  display: string;
  isCenter: boolean;
  tier: 0 | 1 | 2; // 0=中心, 1=内圈(核心/亲族), 2=外圈(辐射)
  types: string[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface LocalGraphEdge {
  source: string;
  target: string;
  type: string;
  directed: boolean;
  notes: string[];
}

/**
 * 局部力导向物理模拟 (Force Simulation)。
 * 支持单圈紧凑模式与高密度内外同心圆轨道模式 (Tiered Orbit Layout)。
 */
export function simulateLocalGraphLayout(
  nodes: LocalGraphNode[],
  edges: LocalGraphEdge[],
  width = 760,
  height = 480,
  iterations = 180,
): void {
  const nodeMap = new Map<string, LocalGraphNode>(nodes.map((n) => [n.id, n]));
  const cx = width / 2;
  const cy = height / 2;

  // 中心人物固定在几何中心
  const centerNode = nodes.find((n) => n.isCenter);
  if (centerNode) {
    centerNode.x = cx;
    centerNode.y = cy;
  }

  const otherNodes = nodes.filter((n) => !n.isCenter);
  const isDense = otherNodes.length > 8;

  if (!isDense) {
    // 少量节点（如李白）：单圈均匀排布，留足弹簧拉力
    otherNodes.forEach((node, i) => {
      const angle = (i / Math.max(1, otherNodes.length)) * Math.PI * 2 - Math.PI / 2;
      const dist = Math.min(width * 0.35, height * 0.35);
      node.x = cx + Math.cos(angle) * dist;
      node.y = cy + Math.sin(angle) * dist;
      node.vx = 0;
      node.vy = 0;
    });
  } else {
    // 高密度节点（如李隆基）：按内外圈分层轨道初始化
    const innerNodes = otherNodes.filter((n) => n.tier === 1);
    const outerNodes = otherNodes.filter((n) => n.tier === 2);

    const rInner = Math.min(width * 0.24, height * 0.25);
    const rOuter = Math.min(width * 0.42, height * 0.44);

    innerNodes.forEach((node, i) => {
      const angle = (i / Math.max(1, innerNodes.length)) * Math.PI * 2 - Math.PI / 2;
      node.x = cx + Math.cos(angle) * rInner;
      node.y = cy + Math.sin(angle) * rInner;
      node.vx = 0;
      node.vy = 0;
    });

    outerNodes.forEach((node, i) => {
      // 外圈角度微调交错，避免与内圈连线完全重合
      const offset = innerNodes.length > 0 ? Math.PI / Math.max(1, outerNodes.length) : 0;
      const angle = (i / Math.max(1, outerNodes.length)) * Math.PI * 2 - Math.PI / 2 + offset;
      node.x = cx + Math.cos(angle) * rOuter;
      node.y = cy + Math.sin(angle) * rOuter;
      node.vx = 0;
      node.vy = 0;
    });
  }

  const kRepulse = isDense ? 5600 : 4200;
  const idealLength = isDense ? 140 : 130;
  const kSpring = isDense ? 0.05 : 0.045;
  const kCenter = 0.015;

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = Math.max(0.03, 1 - iter / iterations);

    // 1. 节点间库仑斥力
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy + 4;
        const dist = Math.sqrt(distSq);
        const force = (kRepulse / distSq) * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!a.isCenter) {
          a.vx -= fx;
          a.vy -= fy;
        }
        if (!b.isCenter) {
          b.vx += fx;
          b.vy += fy;
        }
      }
    }

    // 2. 关系边弹簧拉力
    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const delta = dist - idealLength;
      const force = delta * kSpring * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!source.isCenter) {
        source.vx += fx;
        source.vy += fy;
      }
      if (!target.isCenter) {
        target.vx -= fx;
        target.vy -= fy;
      }
    }

    // 3. 向心力与位置积分
    const damping = 0.78;
    for (const node of nodes) {
      if (node.isCenter) {
        node.x = cx;
        node.y = cy;
        continue;
      }

      // 如果是分圈模式，对外圈增加微弱的向外轨道偏置，保持圈层清晰
      if (isDense && node.tier === 2) {
        const distFromCenter = Math.hypot(node.x - cx, node.y - cy) || 1;
        const targetRadius = Math.min(width * 0.42, height * 0.44);
        const radialDelta = targetRadius - distFromCenter;
        node.vx += ((node.x - cx) / distFromCenter) * radialDelta * 0.02 * alpha;
        node.vy += ((node.y - cy) / distFromCenter) * radialDelta * 0.02 * alpha;
      }

      node.vx += (cx - node.x) * kCenter * alpha;
      node.vy += (cy - node.y) * kCenter * alpha;
      node.vx *= damping;
      node.vy *= damping;

      const speed = Math.hypot(node.vx, node.vy);
      if (speed > 25) {
        node.vx = (node.vx / speed) * 25;
        node.vy = (node.vy / speed) * 25;
      }

      node.x += node.vx;
      node.y += node.vy;

      const pad = node.radius + 18;
      node.x = Math.max(pad, Math.min(width - pad, node.x));
      node.y = Math.max(pad, Math.min(height - pad, node.y));
    }
  }
}

/**
 * 提取局部图谱的节点与关联边，并根据叙事核心程度分级 (Tier)
 */
export function extractLocalGraph(
  person: PersonDetail,
  library: SiteLibrary,
): {
  nodes: LocalGraphNode[];
  edges: LocalGraphEdge[];
} {
  const centerId = person.id;
  const nodesMap = new Map<string, LocalGraphNode>();

  nodesMap.set(centerId, {
    id: centerId,
    name: person.name,
    display: person.display,
    isCenter: true,
    tier: 0,
    types: [],
    x: 380,
    y: 240,
    vx: 0,
    vy: 0,
    radius: 28,
  });

  const rawEdges: LocalGraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const totalRelations = person.relations.length;
  const isDense = totalRelations > 8;

  for (const rel of person.relations) {
    const otherId = rel.source === centerId ? rel.target : rel.source;
    if (!nodesMap.has(otherId)) {
      const other = library.people.find((p) => p.id === otherId && p.kind !== 'event');

      // 分层判断：如果是密集模式，亲族(kin)或特定核心类型分配在内圈(tier 1)，其余在外圈(tier 2)
      let tier: 1 | 2 = 1;
      if (isDense) {
        if (rel.type === 'kin') {
          tier = 1;
        } else if (rel.type === 'ruler-subject') {
          tier = 2;
        } else {
          tier = 1;
        }
      }

      nodesMap.set(otherId, {
        id: otherId,
        name: other?.name || otherId,
        display: other?.display || other?.name || otherId,
        isCenter: false,
        tier,
        types: [rel.type],
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: isDense ? (tier === 1 ? 21 : 18) : 24,
      });
    } else {
      const existing = nodesMap.get(otherId)!;
      if (!existing.types.includes(rel.type)) existing.types.push(rel.type);
    }

    const key = `${rel.source}\0${rel.target}\0${rel.type}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      rawEdges.push({
        source: rel.source,
        target: rel.target,
        type: rel.type,
        directed: rel.directed,
        notes: rel.notes ?? [],
      });
    }
  }

  // 保证中心人物记录了所有涉及的关系类型
  const centerNode = nodesMap.get(centerId)!;
  centerNode.types = Array.from(new Set(rawEdges.map((e) => e.type)));

  const nodes = Array.from(nodesMap.values());
  simulateLocalGraphLayout(nodes, rawEdges, 760, 480);

  return { nodes, edges: rawEdges };
}

/**
 * 渲染人物局部关系图谱（带分类筛选药丸、图例、交互导引与全景展开按钮）
 */
export function renderPersonLocalGraph(person: PersonDetail, library: SiteLibrary): string {
  if (!person.relations || person.relations.length === 0) {
    return `<div class="lt-empty-results"><p>该人物暂无显式收录的人物关系。</p></div>`;
  }

  const { nodes, edges } = extractLocalGraph(person, library);
  const nodeMap = new Map<string, LocalGraphNode>(nodes.map((n) => [n.id, n]));

  // 定义各种关系对应的箭头 marker
  const markers = Object.entries(RELATION_COLORS)
    .map(
      ([type, color]) =>
        `<marker id="local-graph-arrow-${type}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="${color.stroke}"></path></marker>`,
    )
    .join('');

  // 统计各类型数量
  const typeCounts = new Map<string, number>();
  for (const edge of edges) {
    typeCounts.set(edge.type, (typeCounts.get(edge.type) ?? 0) + 1);
  }

  // 渲染分类筛选药丸 (Filter Pills)
  let filterPills = '';
  if (typeCounts.size > 1) {
    const pills = [
      `<button type="button" class="lt-graph-filter-pill is-active" data-graph-filter="all">全部 <span class="lt-pill-count">${edges.length}</span></button>`,
      ...Array.from(typeCounts.entries()).map(([type, count]) => {
        const color = RELATION_COLORS[type]?.stroke ?? '#5e4b8b';
        const label = RELATION_TYPE_NAMES[type] ?? type;
        return `<button type="button" class="lt-graph-filter-pill" data-graph-filter="${escapeHtml(type)}"><span class="lt-pill-dot" style="background-color: ${color}"></span>${escapeHtml(label)} <span class="lt-pill-count">${count}</span></button>`;
      }),
    ];
    filterPills = `<div class="lt-graph-filters" role="group" aria-label="关系分类筛选">${pills.join('')}</div>`;
  }

  // 渲染连线
  const renderedEdges = edges
    .map((edge) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return '';

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const len = Math.hypot(dx, dy) || 1;
      const x1 = source.x + (dx / len) * (source.radius + 1);
      const y1 = source.y + (dy / len) * (source.radius + 1);
      const x2 = target.x - (dx / len) * (target.radius + 5);
      const y2 = target.y - (dy / len) * (target.radius + 5);

      const color = RELATION_COLORS[edge.type]?.stroke ?? '#5e4b8b';
      const marker = edge.directed ? ` marker-end="url(#local-graph-arrow-${edge.type})"` : '';
      const typeLabel = RELATION_TYPE_NAMES[edge.type] ?? edge.type;
      const noteText = edge.notes.filter(Boolean).join('；');

      return `<g class="lt-local-graph-edge" data-source="${escapeHtml(edge.source)}" data-target="${escapeHtml(edge.target)}" data-edge-type="${escapeHtml(edge.type)}"><line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="2" stroke-linecap="round"${marker}></line><title>${escapeHtml(typeLabel)}：${escapeHtml(noteText)}</title></g>`;
    })
    .join('');

  // 渲染节点
  const isDense = nodes.length > 9;
  const renderedNodes = nodes
    .map((node) => {
      const { x, y, radius, isCenter, display, id, types } = node;
      const initial = display.slice(0, 1);
      const circleClass = isCenter ? 'lt-graph-node-circle is-center' : 'lt-graph-node-circle';
      const initialSize = isCenter ? (isDense ? '17px' : '18px') : isDense ? '13px' : '15px';
      const nameSize = isCenter ? '14px' : isDense ? '12px' : '13px';

      const nodeContent = `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" class="${circleClass}"></circle>${isCenter ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius + 4}" class="lt-graph-node-halo"></circle>` : ''}<text x="${x.toFixed(1)}" y="${(y + (isCenter ? 6 : 5)).toFixed(1)}" class="lt-graph-node-initial" style="font-size:${initialSize}" text-anchor="middle">${escapeHtml(initial)}</text><text x="${x.toFixed(1)}" y="${(y + radius + 14).toFixed(1)}" class="lt-graph-node-name" style="font-size:${nameSize}" text-anchor="middle">${escapeHtml(display)}</text>`;

      const typesAttr = types.join(' ');
      if (isCenter) {
        return `<g class="lt-local-graph-node is-center" data-node-id="${escapeHtml(id)}" data-node-types="${escapeHtml(typesAttr)}">${nodeContent}</g>`;
      }
      return `<g class="lt-local-graph-node" data-node-id="${escapeHtml(id)}" data-node-types="${escapeHtml(typesAttr)}"><a href="/people/${encodeURIComponent(id)}" data-site-link title="${escapeHtml(display)}">${nodeContent}</a></g>`;
    })
    .join('');

  return `<div class="lt-local-relation-graph-wrapper"><div class="lt-local-graph-header"><div class="lt-graph-header-top"><span class="lt-graph-stat">包含 <strong>${nodes.length - 1}</strong> 位直接关联人物，<strong>${edges.length}</strong> 条叙事连线</span><button type="button" class="lt-btn-expand-graph" data-graph-action="expand-modal" title="全屏查看图谱">⛶ 展开大图</button></div>${filterPills}</div><div class="lt-local-graph-svg-box"><svg viewBox="0 0 760 480" class="lt-local-graph-svg" role="img" aria-label="${escapeHtml(person.display)}的人物关系图谱"><defs>${markers}</defs><g class="lt-local-graph-content"><g class="lt-edges-group">${renderedEdges}</g><g class="lt-nodes-group">${renderedNodes}</g></g></svg></div><p class="lt-graph-hint">💡 鼠标按住节点可拖拽拉扯，悬停连线可查看叙事，点击可穿梭进入其列传。</p></div>`;
}
