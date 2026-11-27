---
name: people-batch-workflow
description: 多 Agent 并行编排已登记历史人物的批量详表升档或勘误（init → 并行原典起草与单人机器自检 → 并行独立会话审核与自动返修 → 组装准入、合并关系与构建验证）。支持通用原生子代理、终端 CLI 进程池（Codex/Claude）与 Antigravity run_workflow 三种宿主适配。
metadata:
  short-description: Host-neutral multi-agent orchestration for person upgrade and errata batches
---

# 人物批次多 Agent 自动编排入口（跨宿主通用）

先读取 `docs/内容工作流.md`、`pipeline/PLAYBOOK.md`、`../people-production/SKILL.md` 与 `../people-review/SKILL.md`。公共提示词模板位于 [prompts.json](references/prompts.json)。

本入口定义**宿主无关**的五步并行编排协议：通过分片文件隔离（`items/<id>.*`、`check/<id>.json`、`reviews/<id>.json`）将起草会话与独立审核会话严格分离，在任意支持多会话调度的 Coding Agent 或终端中自动完成批量起草、原典逐字核验、独立审校返修与准入应用。

## 适用范围与隔离红线

- **适用对象**：已在 `content/<topic>/<id>.md` 登记的人物批量升详表（`mode: "upgrade"`）或生卒史实勘误（`mode: "errata"`），建议每批 4~15 人（常规每组 10 人）。
- **不适用对象**：尚未上轴的新人物（`publish`，走 `people-production` 路径 B）以及仍在 `pipeline/registry/people/*.json` 的遗留记录（现剩 kuai-zhong 1 人）。
- **隔离红线**：并行阶段内，起草会话只写 `items/<id>.md` 与 `items/<id>.json`，独立审核会话不共享起草上下文、只读核查原典并只写 `reviews/<id>.json`（绑定 16 位 `proposalHash` 且 `reviewer` 不同于 `author`）。任何子会话均不得直接修改 `content/`、`pipeline/topics/`、`public/data/` 或 `batch.json`。

## 标准五步编排协议

### 1. 初始化分片批次（所有宿主相同）

确认目标专题 `<topic>` 与人物列表 `<id1,id2,...>`（未指定人选时先运行 `npm run people:audit -- --topic <topic> --list` 取待升级名单），在仓库根目录运行：

```bash
npm run people:batch:init -- --id <batch-id> --description "<批次说明>" --author "workflow-drafter" --topic <topic> --ids <id1,id2,...> --mode upgrade
```

### 2. 并行起草与独立会话审核闭环（按当前宿主三选一）

每位人物执行相同的状态机（最多 `max_rounds=2` 轮）：
`起草 items/<id>.*` → `运行 people:batch:check 获取 proposalHash` → `全新独立会话核查原典并写 reviews/<id>.json` → `若为 needs-revision / needs-evidence 则回传起草者返修重检并重审；若为 pass / needs-decision / reject 则收敛`。

根据当前运行宿主选择对应调度器（均共用 [prompts.json](references/prompts.json)）：

- **适配 A：原生子代理宿主（Claude Code `Task` / Codex Subagents / Cursor Subagents 等）**
  1. 读取 [prompts.json](references/prompts.json) 中的 `draft_initial` 模板，按人物并行派生独立起草子代理，各自完成草稿并通过 `npm run people:batch:check -- --id <batch-id> --person <id> --json` 取得 `hash`。
  2. 读取 `review` 模板，为每位 `ok: true` 的人物并行派生**全新的**独立审核子代理（仅传入 `<batch-id>`、`<topic>`、`<id>` 与 `proposalHash`，不传入起草对话过程），核查后写入 `reviews/<id>.json`。
  3. 对返回 `needs-revision` 或 `needs-evidence` 的人物，用 `draft_revision` 模板交起草子代理返修重检得到新 `hash`，再派生新审核子代理复核（不超过 2 轮）。

- **适配 B：终端 CLI 进程池（Codex CLI / Claude CLI / 跨模型交叉审校，纯 Python 标准库）**
  在仓库根目录直接运行 [cli_workflow.py](scripts/cli_workflow.py)（支持 `--runner codex|claude`，或用 `--drafter-runner` 与 `--reviewer-runner` 跨模型异构互审）：
  ```bash
  python3 .agents/skills/people-batch-workflow/scripts/cli_workflow.py \
    --batch-id <batch-id> --topic <topic> --ids <id1,id2,...> \
    --mode upgrade --runner codex --concurrency 5 --max-rounds 2
  ```

- **适配 C：Antigravity 宿主（`run_workflow` 工具）**
  先读取内置 `run-workflow` Skill，再调用 `run_workflow` 运行仓库相对路径下的 [agy_workflow.py](scripts/agy_workflow.py)（`ScriptPath` 填 `<当前工作区根目录>/.agents/skills/people-batch-workflow/scripts/agy_workflow.py`）：
  ```json
  {
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

### 3. 组装权威批次与准入检查（所有宿主相同）

并行审校收敛后，在主会话运行：

```bash
npm run people:batch:assemble -- --id <batch-id>
npm run people:evidence:check -- --batch workspace/content/raw/<batch-id>/batch.json
npm run people:publish:check -- --batch workspace/content/raw/<batch-id>/batch.json --json
```

### 4. 应用正式文件、合并关系与构建验证（所有宿主相同）

```bash
npm run people:production:apply -- --batch workspace/content/raw/<batch-id>/batch.json
npm run people:batch:relations -- --id <batch-id> --apply
```

若 `people:batch:relations -- --apply` 新增或修订了 `pipeline/topics/<topic>/topic.json` 中的关系边，紧接着执行二次编译与验证，使新关系写入 `public/data/`：

```bash
npm run content && npm run content:check && npm run build
```

### 5. 汇报结果与处理未决项

报告本批已准入人物明细（生卒精度、传记段数与字数、经历与关联事件、作品、新增关系边数）及留在 `pending/` 的未决项原因。仅在用户要求时执行 `git commit`。
