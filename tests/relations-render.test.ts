import assert from 'node:assert/strict';
import test from 'node:test';
import { getFocusIds, getRelationTheme, getRelatedPeopleMap, RELATION_THEMES } from '../src/app/render';
import { setState } from '../src/app/runtime';
import type { Topic } from '../src/types';

test('关系主题配色覆盖标准五种关系且色彩饱和鲜明', () => {
  const types = ['ruler-subject', 'mentor', 'kin', 'peer', 'rival'] as const;
  for (const type of types) {
    const theme = getRelationTheme(type);
    assert.ok(theme.stroke.startsWith('#'), `${type} 应有合法色值`);
    assert.ok(theme.labelBg.startsWith('#'), `${type} 应有合法背景色`);
    assert.ok(theme.text.startsWith('#'), `${type} 应有合法文字色`);
    assert.equal(theme.stroke, RELATION_THEMES[type].stroke);
  }

  // 验证君臣与同僚不再是发灰低对比颜色
  assert.notEqual(getRelationTheme('ruler-subject').stroke, '#8a8f98');
  assert.notEqual(getRelationTheme('peer').stroke, '#9b7cbf');

  // 未知自定义关系回退安全色
  const custom = getRelationTheme('custom-alliance', '#ff6600');
  assert.equal(custom.stroke, '#ff6600');
});

test('getRelatedPeopleMap 正确检索选中人物的关联对象及关系属性', () => {
  const mockTopic: Partial<Topic> = {
    relationTypes: [
      { id: 'peer', name: '同僚', color: '#9b7cbf', dash: '2 3', directed: false },
      { id: 'ruler-subject', name: '君臣', color: '#8a8f98', dash: null, directed: true },
    ],
    relations: [
      { source: 'li-bai', target: 'du-fu', type: 'peer', note: '李杜并称' },
      { source: 'li-long-ji', target: 'li-bai', type: 'ruler-subject', note: '供奉翰林' },
      { source: 'li-shimin', target: 'wei-zheng', type: 'ruler-subject', note: '从谏如流' },
    ],
  };

  setState({
    topic: mockTopic as Topic,
    line: 'people',
    selected: { kind: 'person', id: 'li-bai' },
  } as any);

  // 选中李白：应检索到杜甫（peer）和唐玄宗（ruler-subject）
  const liBaiMap = getRelatedPeopleMap('li-bai');
  assert.equal(liBaiMap.size, 2);
  assert.ok(liBaiMap.has('du-fu'));
  assert.ok(liBaiMap.has('li-long-ji'));

  const duFuRel = liBaiMap.get('du-fu')!;
  assert.equal(duFuRel.relation.type, 'peer');
  assert.equal(duFuRel.type?.name, '同僚');
  assert.equal(duFuRel.theme.stroke, RELATION_THEMES['peer'].stroke);

  const xuanzongRel = liBaiMap.get('li-long-ji')!;
  assert.equal(xuanzongRel.relation.type, 'ruler-subject');
  assert.equal(xuanzongRel.type?.name, '君臣');
  assert.equal(xuanzongRel.theme.stroke, RELATION_THEMES['ruler-subject'].stroke);

  // 孤立人物：无关系时返回空 Map
  const nobodyMap = getRelatedPeopleMap('su-shi');
  assert.equal(nobodyMap.size, 0);
});

test('getFocusIds 正确收集当前人物及所有一度关联人物 ID', () => {
  const mockTopic: Partial<Topic> = {
    relations: [
      { source: 'su-shi', target: 'su-zhe', type: 'kin' },
      { source: 'su-shi', target: 'huang-tingjian', type: 'peer' },
      { source: 'wang-anshi', target: 'su-shi', type: 'rival' },
      { source: 'li-bai', target: 'du-fu', type: 'peer' },
    ],
  };

  const focusIds = getFocusIds(mockTopic as Topic, 'su-shi');
  assert.equal(focusIds.size, 4);
  assert.ok(focusIds.has('su-shi'));
  assert.ok(focusIds.has('su-zhe'));
  assert.ok(focusIds.has('huang-tingjian'));
  assert.ok(focusIds.has('wang-anshi'));
  assert.ok(!focusIds.has('li-bai'));

  // 孤立人物仅包含自身
  const solitaryIds = getFocusIds(mockTopic as Topic, 'nobody');
  assert.equal(solitaryIds.size, 1);
  assert.ok(solitaryIds.has('nobody'));
});

test('getFocusIds 在对比模式下支持仅保留对比目标或包含关联人物', () => {
  const mockTopic: Partial<Topic> = {
    relations: [
      { source: 'su-shi', target: 'su-zhe', type: 'kin' },
      { source: 'su-shi', target: 'huang-tingjian', type: 'peer' },
    ],
  };

  const compared = new Set(['liu-yong']);

  // 对比且不含关联网：仅苏轼与柳永
  const targetOnlyIds = getFocusIds(mockTopic as Topic, 'su-shi', compared, false);
  assert.equal(targetOnlyIds.size, 2);
  assert.ok(targetOnlyIds.has('su-shi'));
  assert.ok(targetOnlyIds.has('liu-yong'));
  assert.ok(!targetOnlyIds.has('su-zhe'));

  // 对比且包含关联网：苏轼 + 亲属同僚 + 柳永
  const withRelationsIds = getFocusIds(mockTopic as Topic, 'su-shi', compared, true);
  assert.equal(withRelationsIds.size, 4);
  assert.ok(withRelationsIds.has('su-shi'));
  assert.ok(withRelationsIds.has('su-zhe'));
  assert.ok(withRelationsIds.has('huang-tingjian'));
  assert.ok(withRelationsIds.has('liu-yong'));
});
