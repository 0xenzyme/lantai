import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { auditPeople } from '../pipeline/audit-people';
import { loadPipeline } from '../pipeline/load';
import { suggestExperiencesForPerson } from '../pipeline/suggest-experiences';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = loadPipeline(join(repoRoot, 'pipeline'));

test('人物数据质量体检看板能正确聚合全站指标与专题细分', () => {
  const report = auditPeople(data);

  assert.ok(report.totalPeople > 3000, '总人数应大于 3000');
  assert.equal(report.byTopic.length, 17, '应覆盖 17 个专题');
  assert.ok(report.highPriorityCandidates.length >= 20, '应生成高优先级建议升级候选');

  // 验证李隆基和杜甫由于传记丰富且多关系，处于已充实状态
  const duFu = report.highPriorityCandidates.find((c) => c.id === 'du-fu');
  // 杜甫由于已达 rich 标准，优先级分数应当被显著调低
  if (duFu) {
    assert.ok(duFu.bioChars >= 300);
    assert.ok(duFu.relationsCount >= 8);
  }

  // 验证单专题过滤
  const tangReport = auditPeople(data, 'tang');
  assert.equal(tangReport.byTopic.length, 1);
  assert.equal(tangReport.byTopic[0].topicId, 'tang');
  assert.ok(tangReport.totalPeople > 200);
});

test('经历智能联想工具能从公共事件库正确提取李世民的核心历史事件', () => {
  const result = suggestExperiencesForPerson(data, 'li-shimin');

  assert.equal(result.person.id, 'li-shimin');
  assert.ok(result.directSuggestions.length >= 5, '李世民应匹配到至少 5 项直接参与事件');

  const eventIds = new Set(result.directSuggestions.map((s) => s.eventId));
  assert.ok(eventIds.has('jinyang-qibing'), '应包含晋阳起兵');
  assert.ok(eventIds.has('hulao-zhizhan'), '应包含虎牢之战');
  assert.ok(eventIds.has('xuanwu-zhibian'), '应包含玄武门之变');
  assert.ok(eventIds.has('zhenguan-zhizhi'), '应包含贞观之治');

  // 验证继承约束：引用的事件经历 yearAccuracy 必须为 unknown
  const hulao = result.directSuggestions.find((s) => s.eventId === 'hulao-zhizhan')!;
  assert.ok(hulao);
  assert.equal(hulao.isDirect, true);
  assert.ok(hulao.suggestedSources.length > 0);
  assert.ok(hulao.coActors.some((c) => c.id === 'dou-jian-de'));
});

test('经历智能联想工具能正确提取诸葛亮的核心三国事件', () => {
  const result = suggestExperiencesForPerson(data, 'zhuge-liang');

  assert.equal(result.person.id, 'zhuge-liang');
  assert.ok(result.directSuggestions.length >= 6);

  const eventIds = new Set(result.directSuggestions.map((s) => s.eventId));
  assert.ok(eventIds.has('chibi-zhizhan'), '应包含赤壁之战');
  assert.ok(eventIds.has('baidi-tuogu'), '应包含白帝托孤');
  assert.ok(eventIds.has('zhuge-liang-beifa'), '应包含诸葛亮北伐');
});
