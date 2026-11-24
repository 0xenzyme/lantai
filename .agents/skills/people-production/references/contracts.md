# 人物批次合同 v2

类型定义在 `pipeline/content-batch.ts`，准入实现在 `pipeline/people-production.ts`。与事件批次共用同一 envelope；差异只在 `scope` 与领域闸门。批次保存在 `workspace/content/raw/<batch-id>/batch.json`。执行者准备 proposal，用户手动交给独立审核会话补 review。author/reviewer 填实际角色或会话标识，模型与 Coding Agent 名称只是已知时可附的来源说明，不是准入凭证。应用结果由工具生成，不能手改结果声明通过。

## 批次与候选

```ts
interface ContentBatch {
  schemaVersion: 2;
  id: string; // kebab-case，新的授权范围使用新 id
  scope: { description: string; personIds: string[] }; // 人物批次用 personIds；事件批次用 eventIds
  items: Array<{ proposal: Proposal; review?: Review }>;
}
interface Proposal {
  id: string; // 在 scope.personIds 内，每批次唯一
  operation: 'publish' | 'revise';
  author: string;
  before: string | null; // 当前 canonical 文件完整原文；新人物为 null
  after: string; // 用 formatPersonMarkdown 生成的完整目标原文
  admission: string; // 满足席位与收录闸门的具体理由
  evidence: Array<{ id: string; work: string; locator: string; excerpt: string; url?: string }>;
  claims: Array<{ text: string; fields: string[]; sourceIds: string[] }>;
}
interface Review {
  reviewer: string; // 实际独立审核角色或会话标识，不能与 author 相同
  decision: 'pass' | 'needs-evidence' | 'needs-revision' | 'needs-decision' | 'reject';
  reason: string;
  reviewedProposal: Proposal; // 审核者读取的完整 proposal 快照
}
```

准备 JSON 时，使用文件读取取得 before，使用 `pipeline/person-md.ts` 的 `formatPersonMarkdown` 生成 after，再用 JSON.stringify 序列化；不要手抄多行 Markdown 或自行转义。审核者返回结论后，将其实际读取的 proposal 对象原样保存为 reviewedProposal。

## 人物领域闸门

`publish` 只接受新人物，且必须已在本批范围对应的 `pipeline/topics/<id>/candidates.json` 里记为 `status: "pending"`（席位 seat 是目标专题已有泳道，anchor 与 classic/modern 出处齐备）。apply 通过后，工具自动：写 `content/<topic>/<id>.md`；把 `{ id, lane: seat }` 追加进该专题 `topic.json` 的 `people`；从 `candidates.json` 移除该 pending 条目；重写该专题的 `content/<topic>.md` 索引。这四步是一体的，审核者检查的是 apply 之后的完整状态。

`revise` 只接受已登记的 Markdown 人物（brief 升 full、生卒校订、补 categories/title/tags/bio/works/experiences 等）。legacy registry JSON 里的 44 人不在本工具范围内，保持原规则手工维护。当维护 `experiences` 并声明 `event: <event-id>` 时，必须遵循继承约束：不得填写 `year`、`endYear`、`place`，且 `yearAccuracy` 必须为 `"unknown"`；同时被引用的事件中必须在 `people` 或 `commanders` 包含该人物。

所有已维护事实字段都需要 claim 映射：name、gender、polity、categories、primary、birth/birthAccuracy/birthNote、death/deathAccuracy/deathNote、title、tags、aliases、sources、works、experiences、bio。display 是展示短名，profile 是结构性标记，均不要求独立史实 claim。sources 每条都要能匹配 evidence 的书名与卷篇定位。省略的可选字段无需补写；不造事实填满可选字段。

人物记录自身的 lint（生卒与 accuracy 矛盾、占位符、polity 不在词表、年份只靠 database 出处等）error 全部拦截；warning 同样须清除。全局投影差分把存量 warning 当基线，但「详表尚未写关系」按专题汇总的队列告警被排除在差分之外——它由人在 topic.json 另行收录关系，PLAYBOOK 明确它不拒绝编译。

## 命令

```bash
# 执行者：只读机器预检，不要求 review，不授予准入
npm run people:production:preflight -- --batch workspace/content/raw/<batch-id>/batch.json

# 审核者：写入实际独立审核结论后检查并应用
npm run people:publish:check -- --batch workspace/content/raw/<batch-id>/batch.json --json
npm run people:production:apply -- --batch workspace/content/raw/<batch-id>/batch.json
```

preflight 的 checksPassed 仅指机器检查，admissionGranted 始终为 false。apply 重新检查并自动分流，只重写受影响专题的索引，不格式化无关源文件；随后运行 `npm run content` 与 `npm run build`。pending 子集可合回原批次重跑；扩大授权范围使用新批次 id。

## 批次工作目录

批次目录是 `workspace/content/raw/<batch-id>/`。多人并行时每人只写自己的文件，`batch.json` 只由组装工具生成：

| 文件 | 谁写 | 内容 |
| --- | --- | --- |
| `scope.json` | `people:batch:init` | 范围说明、起草者标识、人物 id 列表。init 之后不再变。 |
| `items/<id>.md` | 起草者 | 候选的目标原文，人物 Markdown，格式与 `content/_template.md` 一致。init 先放下正式原文作起点。 |
| `items/<id>.json` | 起草者 | `admission`、`evidence`、`claims`、`relations`、`relationFixes`、`changes`。 |
| `reviews/<id>.json` | 独立审核者 | `reviewer`、`decision`、`reason`、`proposalHash`、`problems`。 |
| `batch.json` | `people:batch:assemble` | 权威批次。只收录带审核结论的候选；未通过的结论一并留档。 |
| `assembled.json` | 同上 | 每个人的状态与内容指纹。 |
| `relations.proposed.json` | 同上 | 已通过审核的关系提案与关系 note 修订。 |
| `relations.applied.json` | `people:batch:relations` | 关系合并结果。 |

`items/<id>.json` 的形状：

```json
{
  "id": "yao-chong",
  "admission": "为什么这样修订或升级",
  "evidence": [
    { "id": "e1", "work": "旧唐书", "locator": "卷96·列传第四十六 姚崇", "excerpt": "元崇爲孝敬挽郎，應下筆成章舉，授濮州司倉" }
  ],
  "claims": [
    { "text": "bio 第1段：出身陕州硖石、以挽郎起家、任濮州司仓", "fields": ["bio"], "sourceIds": ["e1"] }
  ],
  "relations": [
    { "topic": "tang", "source": "yao-chong", "target": "song-jing", "type": "peer", "note": "开元初相继为相，史称姚宋" }
  ],
  "relationFixes": [],
  "changes": ["勘误批逐条记录：原文 → 改后，依据 e1"]
}
```

- `claims[].fields` 覆盖全部已维护的事实字段。每条顶层 `sources[]` 至少对应一条同 `work` 的 evidence，且 evidence 的 `locator` 包含该条的 `part`。
- `excerpt` 是 `raw/` 原典的逐字摘录，保留繁体；不相邻的句子用「……」连接。`people:batch:check` 会逐条核对它是否出现在该书正文里。
- 关系方向：`ruler-subject` 的 source 是君，target 是臣；`mentor` 的 source 是师，target 是弟子；`kin`、`peer`、`rival` 不分方向。`topic` 必须同时收录两端。
- 审核结论绑定内容指纹（目标原文、理由、摘录、claim、关系提案的摘要）。起草者改动草稿后旧审核失效，须重新审核。

## 关系候选报告

`npm run relations:candidates -- <topic> <person-id>` 列出专题内与目标人物生卒重叠的轴上人物（标出已有关系与尚无关系），供详表升档时选择关系对象。报告只读，不写文件；同时代候选不得直接写成 relations，须人工判断叙事意义，写进批次 `items/<id>.json` 的 `relations` 并带 note。
