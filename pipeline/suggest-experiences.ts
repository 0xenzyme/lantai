import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPipeline } from './load';
import type { PipelineData, RegistryEvent, RegistryPerson, SourceRef } from './types';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface EventSuggestion {
  eventId: string;
  eventName: string;
  year: number;
  type: string;
  isDirect: boolean;
  role: 'people' | 'commander' | 'mention';
  alreadyLinked: boolean;
  event: RegistryEvent;
  suggestedExperienceId: string;
  suggestedLabel: string;
  suggestedNote: string;
  suggestedSources: SourceRef[];
  coActors: Array<{ id: string; name?: string }>;
}

export function suggestExperiencesForPerson(
  data: PipelineData,
  personId: string,
): {
  person: RegistryPerson;
  alreadyLinked: EventSuggestion[];
  directSuggestions: EventSuggestion[];
  mentionSuggestions: EventSuggestion[];
} {
  const person = data.people.get(personId);
  if (!person) {
    throw new Error(`未找到人物 ID: "${personId}"`);
  }

  const existingLinkedEventIds = new Set(
    (person.experiences ?? []).map((e) => e.event).filter((ev): ev is string => Boolean(ev)),
  );

  const existingExpIds = new Set((person.experiences ?? []).map((e) => e.id));

  const allSuggestions: EventSuggestion[] = [];

  for (const [eventId, ev] of data.events.entries()) {
    let role: 'people' | 'commander' | 'mention' | null = null;
    let isDirect = false;

    if (ev.commanders?.some((c) => c.id === personId)) {
      role = 'commander';
      isDirect = true;
    } else if (ev.people?.includes(personId)) {
      role = 'people';
      isDirect = true;
    } else if (
      (ev.desc && ev.desc.includes(person.name)) ||
      (ev.name && ev.name.includes(person.name)) ||
      (ev.result && ev.result.includes(person.name))
    ) {
      role = 'mention';
      isDirect = false;
    }

    if (!role) continue;

    // 生成不重复的 experience id
    let baseExpId = eventId;
    if (existingExpIds.has(baseExpId)) {
      baseExpId = `${personId}-${eventId}`;
    }

    // 提炼建议注记
    let note = ev.desc ? ev.desc.split(/[。；]/)[0] + '。' : `${ev.name}。`;
    if (ev.result) {
      note = `${note.replace(/。$/, '')}；${ev.result.split(/[。；]/)[0]}。`;
    }

    // 提取共同行动者/敌对者
    const coActors: Array<{ id: string; name?: string }> = [];
    if (ev.people) {
      for (const pId of ev.people) {
        if (pId !== personId) {
          const p = data.people.get(pId);
          coActors.push({ id: pId, name: p?.name });
        }
      }
    }
    if (ev.commanders) {
      for (const c of ev.commanders) {
        if (c.id && c.id !== personId) {
          const p = data.people.get(c.id);
          coActors.push({ id: c.id, name: p?.name });
        }
      }
    }

    allSuggestions.push({
      eventId,
      eventName: ev.name,
      year: ev.year,
      type: ev.type,
      isDirect,
      role,
      alreadyLinked: existingLinkedEventIds.has(eventId),
      event: ev,
      suggestedExperienceId: baseExpId,
      suggestedLabel: ev.name,
      suggestedNote: note,
      suggestedSources: ev.sources ?? person.sources,
      coActors,
    });
  }

  // 按年份升序排序
  allSuggestions.sort((a, b) => a.year - b.year || a.eventId.localeCompare(b.eventId));

  const alreadyLinked = allSuggestions.filter((s) => s.alreadyLinked);
  const directSuggestions = allSuggestions.filter((s) => s.isDirect && !s.alreadyLinked);
  const mentionSuggestions = allSuggestions.filter((s) => !s.isDirect && !s.alreadyLinked);

  return {
    person,
    alreadyLinked,
    directSuggestions,
    mentionSuggestions,
  };
}

export function formatSuggestionOutput(res: ReturnType<typeof suggestExperiencesForPerson>): string {
  const { person, alreadyLinked, directSuggestions, mentionSuggestions } = res;
  const lines: string[] = [];

  lines.push(`========================================================================`);
  lines.push(`🎯 公共事件智能联想报告：${person.name} (${person.id})`);
  lines.push(`========================================================================`);
  lines.push(
    `当前生卒: ${person.birth ?? '?'} 至 ${person.death ?? '?'} ｜ 身份: ${person.primary ?? '-'} ｜ 既有经历: ${
      person.experiences?.length ?? 0
    } 条 (已挂载事件: ${alreadyLinked.length} 条)`,
  );
  lines.push(``);

  if (alreadyLinked.length > 0) {
    lines.push(`✅ 已挂载的公共事件 (${alreadyLinked.length} 条):`);
    for (const item of alreadyLinked) {
      lines.push(`  - [${item.year} 年] ${item.eventName} (${item.eventId})`);
    }
    lines.push(``);
  }

  if (directSuggestions.length > 0) {
    lines.push(`------------------------------------------------------------------------`);
    lines.push(`⭐ 推荐直接挂载的公共事件 (${directSuggestions.length} 条 - 实体库已包含该人物):`);
    lines.push(`------------------------------------------------------------------------`);

    for (const item of directSuggestions) {
      lines.push(`📌 事件: ${item.eventName} (${item.eventId}) ｜ 年份: ${item.year} ｜ 类型: ${item.type}`);
      lines.push(`   推荐经历 ID: ${item.suggestedExperienceId}`);
      lines.push(`   推荐标签: ${item.suggestedLabel}`);
      lines.push(`   建议注记: ${item.suggestedNote}`);
      if (item.coActors.length > 0) {
        const coList = item.coActors
          .slice(0, 5)
          .map((c) => (c.name ? `${c.name}(${c.id})` : c.id))
          .join('、');
        lines.push(`   同场关联人物 (可作关系线参考): ${coList}`);
      }
      lines.push(``);
    }

    lines.push(`📋 即用型 YAML 片段 (可直接贴入 content/<topic>/${person.id}.md 的 experiences 字段):`);
    lines.push(`------------------------------------------------------------------------`);
    lines.push(`experiences:`);
    for (const item of directSuggestions) {
      lines.push(`  - id: ${item.suggestedExperienceId}`);
      lines.push(`    label: ${item.suggestedLabel}`);
      lines.push(`    yearAccuracy: unknown`);
      lines.push(`    event: ${item.eventId}`);
      lines.push(`    note: ${item.suggestedNote}`);
      lines.push(`    sources:`);
      const src = item.suggestedSources[0] ?? person.sources[0];
      lines.push(`      - work: ${src.work}`);
      if (src.part) lines.push(`        part: ${src.part}`);
      lines.push(`        kind: ${src.kind}`);
    }
    lines.push(``);
  } else {
    lines.push(`ℹ️ 未找到更多直接包含该人物的公共事件。`);
    lines.push(``);
  }

  if (mentionSuggestions.length > 0) {
    lines.push(`------------------------------------------------------------------------`);
    lines.push(`🔍 文本提及但尚未正式列入 people 的公共事件 (${mentionSuggestions.length} 条):`);
    lines.push(`(如需使用 event 引用，须先将 ${person.id} 追加至该事件文件的 people 字段)`);
    lines.push(`------------------------------------------------------------------------`);
    for (const item of mentionSuggestions) {
      lines.push(`  - [${item.year} 年] ${item.eventName} (${item.eventId}): ${item.suggestedNote}`);
    }
    lines.push(``);
  }

  lines.push(`========================================================================`);
  return lines.join('\n');
}

// CLI 执行入口
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const personId = args.find((a) => !a.startsWith('-'));

  if (!personId) {
    console.error(`用法: npx tsx pipeline/suggest-experiences.ts <person-id> [--json]`);
    process.exit(1);
  }

  const jsonMode = args.includes('--json');
  const data = loadPipeline(join(repoRoot, 'pipeline'));

  try {
    const result = suggestExperiencesForPerson(data, personId);
    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatSuggestionOutput(result));
    }
  } catch (err: any) {
    console.error(`错误: ${err.message}`);
    process.exit(1);
  }
}
