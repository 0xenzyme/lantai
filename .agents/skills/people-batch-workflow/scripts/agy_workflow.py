"""Antigravity (`run_workflow`) adapter for people-batch-workflow.

Reads shared host-neutral prompt templates from `../references/prompts.json`
and schedules isolated Drafter and Independent Reviewer agents using AGY's
`phase`, `parallel`, and `agent` primitives.
"""

import json
import os

VALID_DECISIONS = {"pass", "needs-evidence", "needs-revision", "needs-decision", "reject"}

DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "personId": {"type": "string"},
        "ok": {"type": "boolean"},
        "proposalHash": {"type": "string"},
        "summary": {"type": "string"},
        "unresolved": {"type": "string"},
    },
    "required": ["personId", "ok", "proposalHash", "summary", "unresolved"],
}

REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "personId": {"type": "string"},
        "decision": {
            "type": "string",
            "enum": ["pass", "needs-evidence", "needs-revision", "needs-decision", "reject"],
        },
        "proposalHash": {"type": "string"},
        "wroteReviewFile": {"type": "boolean"},
        "reason": {"type": "string"},
    },
    "required": ["personId", "decision", "proposalHash", "wroteReviewFile", "reason"],
}

prompts_path = os.path.join(".agents", "skills", "people-batch-workflow", "references", "prompts.json")
with open(prompts_path, "r", encoding="utf-8") as pfh:
    PROMPTS = json.load(pfh)

batch_id = str(args.get("batch_id", "")).strip()
topic = str(args.get("topic", "")).strip()
person_ids = [str(x).strip() for x in args.get("person_ids", []) if str(x).strip()]
mode = str(args.get("mode", "upgrade")).strip() or "upgrade"
max_rounds = int(args.get("max_rounds", 2))
concurrency = max(1, int(args.get("concurrency", 10)))
drafter_model = str(args.get("drafter_model", "inherit")).strip() or "inherit"
reviewer_model = str(args.get("reviewer_model", "inherit")).strip() or "inherit"

if not batch_id or not topic or not person_ids:
    raise ValueError("Args must include non-empty 'batch_id', 'topic', and 'person_ids'.")

raw_dir = os.path.join("workspace", "content", "raw", batch_id)
scope_path = os.path.join(raw_dir, "scope.json")
if not os.path.isfile(scope_path):
    raise FileNotFoundError(
        f"Missing {scope_path}. Run `npm run people:batch:init` before starting agy_workflow.py."
    )

with open(scope_path, "r", encoding="utf-8") as sfh:
    scope_data = json.load(sfh)

drafter_author = str(scope_data.get("author", "workflow-drafter"))
for pid in person_ids:
    md_path = os.path.join(raw_dir, "items", f"{pid}.md")
    sidecar_path = os.path.join(raw_dir, "items", f"{pid}.json")
    if not os.path.isfile(md_path) or not os.path.isfile(sidecar_path):
        raise FileNotFoundError(f"Missing initialized draft files for '{pid}' in {raw_dir}/items/.")


def verify_review_file(pid, expected_hash):
    review_path = os.path.join(raw_dir, "reviews", f"{pid}.json")
    if not os.path.isfile(review_path):
        return False, f"Missing {review_path}"
    try:
        with open(review_path, "r", encoding="utf-8") as rfh:
            data = json.load(rfh)
    except Exception as exc:
        return False, f"Invalid JSON in {review_path}: {exc}"
    reviewer = str(data.get("reviewer", "")).strip()
    decision = str(data.get("decision", "")).strip()
    file_hash = str(data.get("proposalHash", "")).strip()
    reason = str(data.get("reason", "")).strip()
    if not reviewer or reviewer == drafter_author:
        return False, f"Invalid or non-independent reviewer '{reviewer}'"
    if decision not in VALID_DECISIONS:
        return False, f"Invalid decision '{decision}'"
    if file_hash != expected_hash:
        return False, f"Hash mismatch in {review_path}: expected {expected_hash}, got {file_hash}"
    if not reason:
        return False, "Empty review reason"
    return True, decision


async def process_person(pid):
    drafter = agent(
        PROMPTS["draft_system"].format(batch_id=batch_id, pid=pid),
        schema=DRAFT_SCHEMA,
        role=f"Drafter {pid}",
        type_name="self",
        workspace="inherit",
        model=drafter_model,
    )
    try:
        init_prompt = (
            PROMPTS["draft_initial"].format(batch_id=batch_id, topic=topic, pid=pid, mode=mode)
            + "\n5. 调用 `finish` 返回结构化结果（`proposalHash` 填 `check` 输出的 `hash`，未通过时 `ok` 填 `false` 并在 `unresolved` 写原因）。"
        )
        draft = await drafter(init_prompt, DRAFT_SCHEMA)
        for round_idx in range(1, max_rounds + 1):
            proposal_hash = str(draft.get("proposalHash", "")).strip()
            if not draft.get("ok") or not proposal_hash:
                reason = draft.get("unresolved") or "Drafter self-check did not pass"
                log(f"[INCOMPLETE] {pid} (round {round_idx}): {reason}")
                return {
                    "personId": pid,
                    "status": "draft-incomplete",
                    "rounds": round_idx,
                    "reason": reason,
                }

            reviewer_id = f"independent-reviewer-{pid}-r{round_idx}"
            rev_prompt = (
                PROMPTS["review"].format(
                    batch_id=batch_id,
                    topic=topic,
                    pid=pid,
                    mode=mode,
                    round_idx=round_idx,
                    proposal_hash=proposal_hash,
                    reviewer_id=reviewer_id,
                )
                + "\n5. 调用 `finish` 返回审核结论。"
            )
            review = await agent(
                rev_prompt,
                schema=REVIEW_SCHEMA,
                role=f"Reviewer {pid} R{round_idx}",
                type_name="self",
                workspace="inherit",
                model=reviewer_model,
            )
            valid_file, check_msg = verify_review_file(pid, proposal_hash)
            if not valid_file:
                log(f"[REVIEW-FILE-ERROR] {pid} (round {round_idx}): {check_msg}")
                return {
                    "personId": pid,
                    "status": "review-file-error",
                    "proposalHash": proposal_hash,
                    "rounds": round_idx,
                    "reason": check_msg,
                }

            decision = review["decision"]
            if decision == "pass":
                log(f"[PASS] {pid} (hash={proposal_hash}, rounds={round_idx})")
                return {
                    "personId": pid,
                    "status": "pass",
                    "proposalHash": proposal_hash,
                    "rounds": round_idx,
                    "summary": draft.get("summary", ""),
                }

            if decision in ("needs-decision", "reject") or round_idx >= max_rounds:
                log(f"[PENDING:{decision}] {pid} (rounds={round_idx})")
                return {
                    "personId": pid,
                    "status": decision,
                    "proposalHash": proposal_hash,
                    "rounds": round_idx,
                    "reason": review.get("reason", ""),
                }

            log(f"[REVISE] {pid} round {round_idx} -> {round_idx + 1} ({decision})")
            fix_prompt = (
                PROMPTS["draft_revision"].format(
                    batch_id=batch_id,
                    topic=topic,
                    pid=pid,
                    prev_round=round_idx,
                    round_idx=round_idx + 1,
                    review_reason=review.get("reason", ""),
                )
                + "\n4. 调用 `finish` 返回更新后的 `proposalHash` 与修改摘要。"
            )
            draft = await drafter(fix_prompt, DRAFT_SCHEMA)

        return {"personId": pid, "status": "exhausted", "rounds": max_rounds}
    finally:
        del drafter


all_outcomes = []
chunks = [person_ids[i : i + concurrency] for i in range(0, len(person_ids), concurrency)]
for idx, chunk in enumerate(chunks, start=1):
    phase(f"Wave {idx}/{len(chunks)} ({len(chunk)} people): {', '.join(chunk)}")
    wave_results = await parallel(chunk, process_person)
    all_outcomes.extend(wave_results)

passed_ids = [item["personId"] for item in all_outcomes if item.get("status") == "pass"]
pending_items = [item for item in all_outcomes if item.get("status") != "pass"]

summary_report = {
    "batchId": batch_id,
    "topic": topic,
    "mode": mode,
    "total": len(all_outcomes),
    "passedCount": len(passed_ids),
    "passedIds": passed_ids,
    "pendingCount": len(pending_items),
    "pending": pending_items,
}
log(f"Done {batch_id}: {len(passed_ids)}/{len(all_outcomes)} passed.")
print(json.dumps(summary_report, ensure_ascii=False, indent=2))
