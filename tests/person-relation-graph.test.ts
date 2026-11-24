import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Catalog, PersonDetail } from '../src/types';
import type { SiteLibrary } from '../src/site/data';
import {
  extractLocalGraph,
  renderPersonLocalGraph,
  simulateLocalGraphLayout,
  type LocalGraphNode,
  type LocalGraphEdge,
} from '../src/site/person-relation-graph';

const liBai = JSON.parse(readFileSync('public/data/people/li-bai.json', 'utf8')) as PersonDetail;
const liLongJi = JSON.parse(readFileSync('public/data/people/li-long-ji.json', 'utf8')) as PersonDetail;
const duFu = JSON.parse(readFileSync('public/data/people/du-fu.json', 'utf8')) as PersonDetail;

const library: SiteLibrary = {
  catalog: JSON.parse(readFileSync('public/data/index.json', 'utf8')) as Catalog,
  people: JSON.parse(readFileSync('public/data/people.json', 'utf8')),
  events: [],
  collections: [],
  eras: [],
  failures: [],
};

test('力导向布局模拟器能正确收敛并在合法画布区间内排布', () => {
  const nodes: LocalGraphNode[] = [
    {
      id: 'center',
      name: '中心',
      display: '中心人物',
      isCenter: true,
      tier: 0,
      types: [],
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 28,
    },
    {
      id: 'a',
      name: '甲',
      display: '人物甲',
      isCenter: false,
      tier: 1,
      types: ['peer'],
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 22,
    },
    {
      id: 'b',
      name: '乙',
      display: '人物乙',
      isCenter: false,
      tier: 1,
      types: ['peer'],
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 22,
    },
    {
      id: 'c',
      name: '丙',
      display: '人物丙',
      isCenter: false,
      tier: 1,
      types: ['peer'],
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 22,
    },
  ];
  const edges: LocalGraphEdge[] = [
    { source: 'center', target: 'a', type: 'peer', directed: false, notes: [] },
    { source: 'center', target: 'b', type: 'peer', directed: false, notes: [] },
    { source: 'center', target: 'c', type: 'peer', directed: false, notes: [] },
  ];

  simulateLocalGraphLayout(nodes, edges, 760, 480, 180);

  // 验证中心节点在中央
  assert.equal(nodes[0].x, 380);
  assert.equal(nodes[0].y, 240);

  // 验证所有节点坐标合法且在画布边界内
  for (const n of nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `坐标非有限数字: ${n.id}`);
    assert.ok(n.x >= 20 && n.x <= 740, `节点 x 超出边距: ${n.x}`);
    assert.ok(n.y >= 20 && n.y <= 460, `节点 y 超出边距: ${n.y}`);
  }
});

test('李白局部图谱正确提取一度人物与关系连线', () => {
  const { nodes, edges } = extractLocalGraph(liBai, library);

  assert.equal(nodes[0].id, 'li-bai');
  assert.equal(nodes[0].isCenter, true);
  // 李白现在有 6 条显式关系 (杜甫、唐玄宗、高适、永王李璘、孟浩然、王维)
  assert.equal(nodes.length, 7); // 1 中心 + 6 关联
  assert.equal(edges.length, 6);

  const targetIds = new Set(nodes.map((n) => n.id));
  assert.ok(targetIds.has('du-fu'));
  assert.ok(targetIds.has('gao-shi'));
  assert.ok(targetIds.has('li-long-ji'));
  assert.ok(targetIds.has('li-lin-757'));
  assert.ok(targetIds.has('meng-hao-ran'));
  assert.ok(targetIds.has('wang-wei'));
});

test('杜甫局部图谱正确提取盛唐文人圈与政治圈多维关系网络', () => {
  const { nodes, edges } = extractLocalGraph(duFu, library);

  assert.equal(nodes[0].id, 'du-fu');
  assert.equal(nodes[0].isCenter, true);
  // 杜甫包含 10 条显式关联边
  assert.equal(nodes.length, 11); // 1 中心 + 10 关联
  assert.equal(edges.length, 10);

  const targetIds = new Set(nodes.map((n) => n.id));
  assert.ok(targetIds.has('li-bai'));
  assert.ok(targetIds.has('gao-shi'));
  assert.ok(targetIds.has('fang-guan'));
  assert.ok(targetIds.has('li-heng'));
  assert.ok(targetIds.has('wang-wei'));
  assert.ok(targetIds.has('li-long-ji'));
  assert.ok(targetIds.has('meng-hao-ran'));
  assert.ok(targetIds.has('li-lin-fu'));
  assert.ok(targetIds.has('yang-guo-zhong'));
  assert.ok(targetIds.has('guo-zi-yi'));
});

test('李隆基高密度图谱触发内外双圈分层且生成分类过滤药丸', () => {
  const { nodes, edges } = extractLocalGraph(liLongJi, library);

  assert.equal(nodes[0].id, 'li-long-ji');
  assert.equal(nodes.length, 26); // 1 中心 + 25 关联人物
  assert.equal(edges.length, 25);

  // 验证高密度下亲族(kin)被分配在内圈(tier 1)
  const yang = nodes.find((n) => n.id === 'yang-yu-huan');
  assert.ok(yang);
  assert.equal(yang.tier, 1);

  // 验证大臣(ruler-subject)大部分被分配在外圈(tier 2)
  const yao = nodes.find((n) => n.id === 'yao-chong');
  assert.ok(yao);
  assert.equal(yao.tier, 2);

  // 验证 HTML 渲染包含药丸过滤与大图展开按钮
  const html = renderPersonLocalGraph(liLongJi, library);
  assert.ok(html.includes('data-graph-filter="ruler-subject"'));
  assert.ok(html.includes('data-graph-filter="kin"'));
  assert.ok(html.includes('data-graph-action="expand-modal"'));
});

test('局部关系图谱渲染输出合规的 SVG、箭头定义与节点结构', () => {
  const html = renderPersonLocalGraph(liBai, library);

  assert.ok(html.includes('<svg viewBox="0 0 760 480"'));
  assert.ok(html.includes('data-node-id="li-bai"'));
  assert.ok(html.includes('data-node-id="du-fu"'));
  assert.ok(html.includes('data-node-id="gao-shi"'));
  assert.ok(html.includes('local-graph-arrow-ruler-subject'));
  assert.ok(html.includes('天宝初召见金銮殿'));
  assert.ok(html.includes('天宝同游梁宋'));
});
