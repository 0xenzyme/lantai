import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

import { mergeTopicRelations } from './lint';
import { loadPipeline } from './load';
import type { PipelineData } from './types';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface PersonAuditMetric {
  id: string;
  name: string;
  display: string;
  primary?: string;
  profile: 'brief' | 'full';
  topics: string[];
  bioChars: number;
  bioParagraphs: number;
  bioTier: 'empty' | 'thin' | 'medium' | 'rich';
  relationsCount: number;
  relationsTier: 'isolated' | 'low' | 'medium' | 'rich';
  experiencesCount: number;
  eventsLinkedCount: number;
  worksCount: number;
  matchedPublicEventsCount: number;
  isFeatured: boolean;
  priorityScore: number;
}

export interface TopicAuditSummary {
  topicId: string;
  totalPeople: number;
  briefCount: number;
  fullCount: number;
  bioTiers: { empty: number; thin: number; medium: number; rich: number };
  relationTiers: { isolated: number; low: number; medium: number; rich: number };
  withExperiences: number;
  withWorks: number;
  avgBioChars: number;
  avgRelations: number;
}

export interface AuditReport {
  timestamp: string;
  totalPeople: number;
  overall: {
    briefCount: number;
    fullCount: number;
    bioTiers: { empty: number; thin: number; medium: number; rich: number };
    relationTiers: { isolated: number; low: number; medium: number; rich: number };
    totalExperiences: number;
    peopleWithExperiences: number;
    peopleWithLinkedEvents: number;
    peopleWithWorks: number;
  };
  byTopic: TopicAuditSummary[];
  highPriorityCandidates: PersonAuditMetric[];
}

export function auditPeople(data: PipelineData, filterTopic?: string): AuditReport {
  const mergedRelations = mergeTopicRelations(data.topics).relations;

  // 1. 统计各人物在各专题中的出现
  const personTopics = new Map<string, string[]>();
  for (const topic of data.topics) {
    for (const p of topic.people) {
      const list = personTopics.get(p.id) ?? [];
      list.push(topic.meta.id);
      personTopics.set(p.id, list);
    }
  }

  // 2. 统计各人物的关系数量
  const personRelationsCount = new Map<string, number>();
  for (const rel of mergedRelations) {
    personRelationsCount.set(rel.source, (personRelationsCount.get(rel.source) ?? 0) + 1);
    personRelationsCount.set(rel.target, (personRelationsCount.get(rel.target) ?? 0) + 1);
  }

  // 3. 统计朝代 featuredPeople
  const featuredSet = new Set<string>();
  for (const profile of data.dynastyProfiles.values()) {
    if (profile.featuredPeople) {
      for (const id of profile.featuredPeople) featuredSet.add(id);
    }
  }

  // 4. 统计公共事件反向匹配
  const matchedEventsCount = new Map<string, number>();
  for (const ev of data.events.values()) {
    if (ev.people) {
      for (const id of ev.people) {
        matchedEventsCount.set(id, (matchedEventsCount.get(id) ?? 0) + 1);
      }
    }
    if (ev.commanders) {
      for (const c of ev.commanders) {
        if (c.id) {
          matchedEventsCount.set(c.id, (matchedEventsCount.get(c.id) ?? 0) + 1);
        }
      }
    }
  }

  // 5. 遍历计算每人指标
  const metrics: PersonAuditMetric[] = [];
  for (const [id, person] of data.people.entries()) {
    const topics = personTopics.get(id) ?? [];
    if (filterTopic && !topics.includes(filterTopic)) continue;

    const bio = (person.bio ?? '').trim();
    const bioChars = bio.length;
    const bioParagraphs = bio ? bio.split(/\n\s*\n/).filter(Boolean).length : 0;
    let bioTier: 'empty' | 'thin' | 'medium' | 'rich' = 'empty';
    if (bioChars === 0) bioTier = 'empty';
    else if (bioChars < 150) bioTier = 'thin';
    else if (bioChars < 300) bioTier = 'medium';
    else bioTier = 'rich';

    const relationsCount = personRelationsCount.get(id) ?? 0;
    let relationsTier: 'isolated' | 'low' | 'medium' | 'rich' = 'isolated';
    if (relationsCount === 0) relationsTier = 'isolated';
    else if (relationsCount <= 2) relationsTier = 'low';
    else if (relationsCount <= 5) relationsTier = 'medium';
    else relationsTier = 'rich';

    const experiencesCount = person.experiences?.length ?? 0;
    const eventsLinkedCount = person.experiences?.filter((e) => Boolean(e.event)).length ?? 0;
    const worksCount = person.works?.length ?? 0;
    const matchedPublic = matchedEventsCount.get(id) ?? 0;
    const isFeatured = featuredSet.has(id);

    // 计算升级优先级分数（越是核心人物且当前越单薄，优先级越高）
    let priorityScore = 0;
    if (isFeatured) priorityScore += 50;
    if (matchedPublic > 0) priorityScore += Math.min(matchedPublic * 8, 40);
    if (person.primary === 'monarch' || person.primary === 'chancellor') priorityScore += 25;
    if (person.primary === 'general' || person.primary === 'poetry') priorityScore += 15;
    if (topics.length > 1) priorityScore += 10;

    // 现状扣分：如果已经很丰富（长传记且多关系），则升级优先级下降
    if (bioTier === 'rich' && relationsTier === 'rich') priorityScore -= 80;
    else if (bioTier === 'rich' || relationsTier === 'rich') priorityScore -= 30;

    metrics.push({
      id,
      name: person.name,
      display: person.display,
      primary: person.primary,
      profile: person.profile ?? (person.bio ? 'full' : 'brief'),
      topics,
      bioChars,
      bioParagraphs,
      bioTier,
      relationsCount,
      relationsTier,
      experiencesCount,
      eventsLinkedCount,
      worksCount,
      matchedPublicEventsCount: matchedPublic,
      isFeatured,
      priorityScore,
    });
  }

  // 6. 按专题汇总
  const byTopic: TopicAuditSummary[] = [];
  for (const topic of data.topics) {
    if (filterTopic && topic.meta.id !== filterTopic) continue;

    const topicPeople = topic.people
      .map((p) => metrics.find((m) => m.id === p.id))
      .filter((m): m is PersonAuditMetric => Boolean(m));

    let briefCount = 0;
    let fullCount = 0;
    const bioTiers = { empty: 0, thin: 0, medium: 0, rich: 0 };
    const relationTiers = { isolated: 0, low: 0, medium: 0, rich: 0 };
    let withExperiences = 0;
    let withWorks = 0;
    let totalBioChars = 0;
    let totalRelations = 0;

    for (const m of topicPeople) {
      if (m.profile === 'brief') briefCount++;
      else fullCount++;

      bioTiers[m.bioTier]++;
      relationTiers[m.relationsTier]++;
      if (m.experiencesCount > 0) withExperiences++;
      if (m.worksCount > 0) withWorks++;
      totalBioChars += m.bioChars;
      totalRelations += m.relationsCount;
    }

    byTopic.push({
      topicId: topic.meta.id,
      totalPeople: topicPeople.length,
      briefCount,
      fullCount,
      bioTiers,
      relationTiers,
      withExperiences,
      withWorks,
      avgBioChars: topicPeople.length ? Math.round(totalBioChars / topicPeople.length) : 0,
      avgRelations: topicPeople.length ? Number((totalRelations / topicPeople.length).toFixed(1)) : 0,
    });
  }

  // 7. 全局汇总
  let briefCount = 0;
  let fullCount = 0;
  const bioTiers = { empty: 0, thin: 0, medium: 0, rich: 0 };
  const relationTiers = { isolated: 0, low: 0, medium: 0, rich: 0 };
  let totalExperiences = 0;
  let peopleWithExperiences = 0;
  let peopleWithLinkedEvents = 0;
  let peopleWithWorks = 0;

  for (const m of metrics) {
    if (m.profile === 'brief') briefCount++;
    else fullCount++;

    bioTiers[m.bioTier]++;
    relationTiers[m.relationsTier]++;
    totalExperiences += m.experiencesCount;
    if (m.experiencesCount > 0) peopleWithExperiences++;
    if (m.eventsLinkedCount > 0) peopleWithLinkedEvents++;
    if (m.worksCount > 0) peopleWithWorks++;
  }

  // 8. 排序候选优先级
  const highPriorityCandidates = [...metrics]
    .sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id))
    .slice(0, 30);

  return {
    timestamp: new Date().toISOString(),
    totalPeople: metrics.length,
    overall: {
      briefCount,
      fullCount,
      bioTiers,
      relationTiers,
      totalExperiences,
      peopleWithExperiences,
      peopleWithLinkedEvents,
      peopleWithWorks,
    },
    byTopic,
    highPriorityCandidates,
  };
}

export function formatConsoleReport(report: AuditReport, filterTopic?: string): string {
  const o = report.overall;
  const lines: string[] = [];

  lines.push(`========================================================================`);
  lines.push(`📊 人物数据质量体检看板 ${filterTopic ? `(专题: ${filterTopic})` : `(全站统计)`}`);
  lines.push(`========================================================================`);
  lines.push(`总人数: ${report.totalPeople} 人 ｜ 简表: ${o.briefCount} ｜ 详表: ${o.fullCount}`);
  lines.push(
    `传记深度: 极丰富(≥300字): ${o.bioTiers.rich} ｜ 适中(150-299字): ${o.bioTiers.medium} ｜ 单薄(<150字): ${o.bioTiers.thin} ｜ 缺失: ${o.bioTiers.empty}`,
  );
  lines.push(
    `关系密度: 稠密(≥6条): ${o.relationTiers.rich} ｜ 中等(3-5条): ${o.relationTiers.medium} ｜ 稀疏(1-2条): ${o.relationTiers.low} ｜ 孤立(0条): ${o.relationTiers.isolated}`,
  );
  lines.push(
    `结构化经历: ${o.peopleWithExperiences} 人维护 (共 ${o.totalExperiences} 条，其中 ${o.peopleWithLinkedEvents} 人关联公共事件)`,
  );
  lines.push(`代表作收录: ${o.peopleWithWorks} 人维护`);
  lines.push(``);

  if (!filterTopic) {
    lines.push(`------------------------------------------------------------------------`);
    lines.push(`朝代/专题体检明细（按规模排序）:`);
    lines.push(`专题ID        总人数  详表率   单薄传记  孤立人物  含经历  含作品  平均字数  平均关系`);
    lines.push(`------------------------------------------------------------------------`);
    const sortedTopics = [...report.byTopic].sort((a, b) => b.totalPeople - a.totalPeople);
    for (const t of sortedTopics) {
      const fullRate = `${Math.round((t.fullCount / (t.totalPeople || 1)) * 100)}%`;
      const idCol = t.topicId.padEnd(12);
      const totalCol = String(t.totalPeople).padStart(6);
      const fullCol = fullRate.padStart(7);
      const thinCol = String(t.bioTiers.thin + t.bioTiers.empty).padStart(8);
      const isoCol = String(t.relationTiers.isolated).padStart(8);
      const expCol = String(t.withExperiences).padStart(6);
      const wrkCol = String(t.withWorks).padStart(6);
      const avgCharsCol = String(t.avgBioChars).padStart(8);
      const avgRelCol = String(t.avgRelations).padStart(8);
      lines.push(
        `${idCol} ${totalCol} ${fullCol} ${thinCol} ${isoCol} ${expCol} ${wrkCol} ${avgCharsCol} ${avgRelCol}`,
      );
    }
    lines.push(``);
  }

  lines.push(`------------------------------------------------------------------------`);
  lines.push(`⭐ 待升级核心枢纽优先建议名单（Top 25）:`);
  lines.push(`ID             姓名      专题        身份     当前传记/关系  匹配事件  优先级分`);
  lines.push(`------------------------------------------------------------------------`);
  for (const c of report.highPriorityCandidates.slice(0, 25)) {
    const idCol = c.id.padEnd(14);
    const nameCol = c.name.padEnd(6);
    const topCol = c.topics.slice(0, 2).join(',').padEnd(10);
    const primCol = (c.primary ?? '-').padEnd(8);
    const statusCol = `${c.bioChars}字/${c.relationsCount}边`.padEnd(13);
    const matchCol = `${c.matchedPublicEventsCount}条`.padStart(6);
    const scoreCol = String(c.priorityScore).padStart(8);
    lines.push(`${idCol} ${nameCol} ${topCol} ${primCol} ${statusCol} ${matchCol} ${scoreCol}`);
  }
  lines.push(`========================================================================`);
  return lines.join('\n');
}

// CLI 执行入口
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  let filterTopic: string | undefined;
  let jsonMode = false;
  let outputPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic' && args[i + 1]) {
      filterTopic = args[++i];
    } else if (args[i] === '--json') {
      jsonMode = true;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[++i];
    }
  }

  const data = loadPipeline(join(repoRoot, 'pipeline'));
  const report = auditPeople(data, filterTopic);

  if (jsonMode) {
    const output = JSON.stringify(report, null, 2);
    if (outputPath) writeFileSync(outputPath, output, 'utf8');
    else console.log(output);
  } else {
    const formatted = formatConsoleReport(report, filterTopic);
    if (outputPath) writeFileSync(outputPath, formatted, 'utf8');
    else console.log(formatted);
  }
}
