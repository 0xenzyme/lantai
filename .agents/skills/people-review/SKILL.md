---
name: people-review
description: 在独立会话审核已准备的历史人物批次（支持分片目录 items/reviews 与单文件 batch.json），核对原典事实与证据后运行组装、统一准入与关系合并工具，自动应用通过项并保留 pending。
metadata:
  short-description: Independently review and apply person candidates
---

# 人物审核入口

用户将批次路径交给未参与起草的独立会话（或由 `people-batch-workflow` 调度独立审核 Agent）。本入口不调用或配置其他模型。先读取 `docs/内容工作流.md`、`pipeline/PLAYBOOK.md`，以及 `../people-production/references/contracts.md` 和 `../event-production/references/` 下的 `evidence.md`、`roles.md`。

## 核查标准（两类批次通用）

1. **独立性确认**：确认本会话没有起草这些候选。若已参与起草，立即停止并输出交接提示，交由另一独立会话审核；更换 `reviewer` 字符串不构成独立审核。若用户明确只要求只读检查，则只报告发现，不写审核文件、不执行应用。
2. **原典回查工具**：使用本地原典工具核实史料，不轻信候选自述：
   - `npm run sources:search -- <繁体正则> --work <书名> --chars 8000`（配合 `--skip` 续读）：整读本传与相关志传，核对上下文。
   - `npm run people:evidence:check -- --batch <batch.json>`：核对单文件批次摘录是否逐字出自 `raw/`。
3. **实质史实核查重点**（按 `roles.md` 与 `PLAYBOOK.md` 逐项核对）：
   - 生卒年与 `accuracy`、异说 `note`：原典未明载生卒纪年、仅据享年逆推者，`accuracy` 必须为 `approx` 并在 `note` 写明逆推依据，不得标为 `exact`；原稿既有内容不因 `raw/` 未载而无故删除。
   - `polity` 归属口径（遵循 `pipeline/PLAYBOOK.md`《polity 的归属口径》，不按生卒年机械推导）、席位与泳道、`sources[].kind` 与卷篇定位。
   - `bio` 分期叙事：纯段落无标题，引号内引语与原典逐字一致（仅允许繁简字形转换），每段硬事实均有 `claims` 与 `evidence` 支撑。
   - `experiences` 与 `works`：引用公共 `event` 时未重复填 `year`/`endYear`/`place` 且 `yearAccuracy: "unknown"`，事件已含本人；`works` 题名确有原典依据，无自拟书名。
   - `relations` 与 `relationFixes`：两端均在目标专题 `people` 内，原典有明确交互依据，有向类型方向正确（`ruler-subject` 为君→臣，`mentor` 为师→弟子），`note` 准确且不超过 30 字（工具上限 50 字）。
   - 全部必需事实得到支持才给 `pass`；否则给出具体 `needs-evidence`、`needs-revision`、`needs-decision` 或 `reject` 原因。审核者不直接修改 `items/`、`proposal` 或正式源文件。

## 审核与应用流程（按批次形态执行）

### 形态 A：分片批次（目录含 `scope.json` 与 `items/<id>.md`、`items/<id>.json`）

1. 读取目标人物的 `items/<id>.md` 与 `items/<id>.json`，确认当前内容指纹 `proposalHash`（可对照 `check/<id>.json` 或单人自检输出；单人审核员不重跑写盘自检覆盖他人状态，可只读核算指纹）。
2. 将审核结论写入 `workspace/content/raw/<batch-id>/reviews/<id>.json`：
   ```json
   {
     "reviewer": "<实际独立审核角色或会话标识>",
     "decision": "pass",
     "reason": "具体核查过的原典卷篇、摘录、生卒、引语与关系结论；若未通过则逐条写清待修改原因",
     "proposalHash": "<16位内容指纹>"
   }
   ```
   *注：若本会话仅受编排工作流委托审核单个 `<id>`，写完 `reviews/<id>.json` 即完成任务并返回结论，不执行下方整批组装与应用。*
3. 整批审核完成后，运行组装、准入检查、正式应用与关系合并：
   ```bash
   npm run people:batch:assemble -- --id <batch-id>
   npm run people:publish:check -- --batch workspace/content/raw/<batch-id>/batch.json --json
   npm run people:production:apply -- --batch workspace/content/raw/<batch-id>/batch.json
   npm run people:batch:relations -- --id <batch-id> --apply
   ```
   即使部分人物未通过，也照常运行 `assemble` 与 `apply`：工具会将未通过结论留档至 `pending/`，并自动应用已 `pass` 的人物与关系。
4. 若第 3 步 `people:batch:relations -- --apply` 实际新增或修订了 `topic.json` 中的关系边，补充运行一次 `npm run content && npm run build`（或 `npm run content:check && npm test`），确保关系图谱编译进 `public/data/` 并通过全量校验。

### 形态 B：单文件批次（仅 `batch.json`，用于新人物 `publish` 或单文件修订）

1. 读取 `raw` 或 `pending` 的 `batch.json` 及正式源文件，确认 `scope.personIds` 授权范围。
2. 只写本次审核项的 `review`，将实际核对过的完整 `proposal` 对象原样保存为 `reviewedProposal`（写入前重读确认 `proposal` 未变化，保留其他项与既有材料）。
3. 运行准入检查与应用：
   ```bash
   npm run people:publish:check -- --batch workspace/content/raw/<batch-id>/batch.json --json
   npm run people:production:apply -- --batch workspace/content/raw/<batch-id>/batch.json
   ```
4. 检查 `result.json` 与正式文件，报告 `appliedIds`、`pending` 原因及 `verification`（只有 `verification=passed` 才表示已完成编译与 `build`）。需要补证时给出同批次路径和 `people-production` 交接提示。

## 恢复与限制

原批次已接受内容（`accepted.json`）不重写审核历史。用户要求复查已接受项时只做只读检查；发现需要改动则新建修订批次交给执行者。原应用中断时重跑原批次 `check` / `apply`（及分片批次的 `people:batch:relations -- --apply`）：文件已写入、台账或 `topic.json` 未补齐的中断由工具幂等补齐，已应用项不会重复写入。

`author` / `reviewer` 是实际角色或会话标识，用于追溯与防自审检查。准入工具负责写 canonical、登记泳道、消耗候选台账、重写受影响专题索引、合并关系、编译和 `build`。此流程不含 `commit`、`push` 或 `deploy`。
