---
name: people-batch-workflow
description: 使用 run_workflow 多 Agent 编排自动完成已登记历史人物的批量详表升档或勘误（init → 并行原典起草与单人机器自检 → 并行独立会话审核与自动返修 → 组装准入、合并关系与构建验证）。当用户要求直接按批生产、升级或编排一组已登记人物时使用。
metadata:
  short-description: Orchestrate parallel drafting, independent review, and admission for person batches
---

# 人物批次多 Agent 自动编排入口

先读取 `docs/内容工作流.md`、`pipeline/PLAYBOOK.md`、`../people-production/SKILL.md`、`../people-review/SKILL.md` 以及宿主内置 `run-workflow` Skill。

本入口利用 `run_workflow` 调度相互隔离的起草 Agent 与独立审核 Agent，在一个任务内自动完成「分片建批 → 原典起草与逐字机器自检 → 独立会话审核与返修闭环 → 批次组装、准入应用与关系合并」，同时严格满足 `docs/内容工作流.md` 的单一准入门槛与「起草者不能自审」原则。

## 适用范围与前置边界

- **适用对象**：已在 `content/<topic>/<id>.md` 登记的人物批量升详表（`mode: "upgrade"`）或生卒史实勘误（`mode: "errata"`），建议每批 4~15 人（常规每组 10 人）。
- **不适用对象**：
  1. 尚未上轴的新人物（`operation: "publish"`）：`people:batch:*` 仅支持已登记 Markdown 人物修订；新人物上轴须先补 `candidates.json` 台账并按 `people-production` 路径 B 执行。
  2. 仍在 `pipeline/registry/people/*.json` 的 44 位存量人物。
- **文件隔离原则**：在 `run_workflow` 并行阶段内，每位起草 Agent 只写 `items/<id>.md` 与 `items/<id>.json`（及自检生成的 `check/<id>.json`），每位独立审核 Agent 只写 `reviews/<id>.json`。任何子 Agent 均不得直接修改 `content/`、`pipeline/topics/<topic>/topic.json`、`public/data/` 或 `batch.json`。

## 标准五步编排流程

### 1. 确定范围并初始化分片批次

确认目标专题 `<topic>` 与人物列表 `<id1,id2,...>`（若用户未指定具体人选，可先运行 `npm run people:audit -- --topic <topic> --list` 按优先级选取待升级人物）。生成唯一 `<batch-id>`（如 `people-song-batch27-20261127`），在主会话运行：

```bash
npm run people:batch:init -- --id <batch-id> --description "<批次说明>" --author "workflow-drafter" --topic <topic> --ids <id1,id2,...> --mode upgrade
```

### 2. 启动 `run_workflow` 并行起草与独立审核闭环

调用 `run_workflow` 工具，传入本 Skill 自带的编排脚本 `.agents/skills/people-batch-workflow/scripts/upgrade_batch.py` 与 `Args`：

```json
{
  "ScriptPath": "/Users/liuyj/project/sites/history-timeline/.agents/skills/people-batch-workflow/scripts/upgrade_batch.py",
  "Description": "并行起草并独立审核人物详表批次",
  "Args": {
    "batch_id": "<batch-id>",
    "topic": "<topic>",
    "person_ids": ["<id1>", "<id2>"],
    "mode": "upgrade",
    "max_rounds": 2,
    "concurrency": 10
  }
}
```

脚本内部对每位人物执行以下闭环：
1. **起草与机器自检（Drafter Agent）**：检索并连续整读本地 `raw/` 正史与《资治通鉴》本传（`npm run sources:search -- ... --chars 8000`），查询 `people:suggest-events` 与 `relations:candidates`，编写 `items/<id>.md` 与 `items/<id>.json`，运行 `npm run people:batch:check -- --id <batch-id> --person <id> --json` 直至 `ok: true` 并返回 16 位 `proposalHash`。
2. **独立会话审核（Reviewer Agent）**：启动全新的独立 Agent 会话（不共享起草者上下文），回查 `raw/` 原典逐项核对生卒精度、引语逐字一致、`polity`、经历事件继承、作品题名真实性及关系边方向与 `note`，写入 `reviews/<id>.json`（绑定 `proposalHash`）。
3. **自动返修（最多 `max_rounds` 轮）**：若审核结论为 `needs-revision` 或 `needs-evidence`，脚本将审核意见交回该人物起草 Agent 修正并重跑 `people:batch:check` 获取新指纹，随后启动新一轮独立审核 Agent 复核；若为 `needs-decision` 或 `reject`（史料本身存疑需人工裁决），保留原结论不强行改写。

调用 `run_workflow` 后结束当前回合，等待系统完成通知。

### 3. 组装权威批次并执行准入检查

`run_workflow` 完成后，主会话运行组装与准入检查：

```bash
npm run people:batch:assemble -- --id <batch-id>
npm run people:publish:check -- --batch workspace/content/raw/<batch-id>/batch.json --json
```

检查 `assembled.json` 与 `publish:check` 输出，确认通过项为 `ready`、未决项原因清晰。

### 4. 应用正式文件与合并专题关系

在主会话执行统一准入应用与关系合并（若沙箱限制跨目录原子覆盖 `public/data/`，按仓库终端规则对 `apply` / `content` 使用相应权限）：

```bash
npm run people:production:apply -- --batch workspace/content/raw/<batch-id>/batch.json
npm run people:batch:relations -- --id <batch-id> --apply
```

若 `people:batch:relations -- --apply` 新增或更新了 `pipeline/topics/<topic>/topic.json` 中的关系边，立即运行编译与全量验证，使关系数据写入 `public/data/`：

```bash
npm run content && npm run content:check && npm test && npm run build
```

### 5. 汇报结果与处理未决项

向用户清晰报告：
1. 本批已准入应用的人物清单（传记段数与字数、经历条数、作品、新增关系条数）及 `verification` 状态。
2. 留在 `workspace/content/pending/<batch-id>/` 的未通过人物及具体原因（尤其是 `needs-decision` 的史料取舍问题）。
3. 只有在用户明确要求提交或预览验证时，再执行浏览器实机巡检或 `git commit`。
