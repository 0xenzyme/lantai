#!/usr/bin/env python3
"""Host-neutral CLI orchestrator for Lantai person batches.

Runs in standard Python 3.9+ (zero third-party dependencies) from the repo root.
Spawns isolated stateless CLI agent processes (Codex CLI, Claude Code CLI, or any
custom command accepting a prompt on stdin) for parallel drafting, self-checking,
and independent review, using on-disk files + `people:batch:check --json` as the
single source of truth.

Examples:
  # Draft and review with Codex CLI (parallel 5 workers):
  python3 .agents/skills/people-batch-workflow/scripts/cli_workflow.py \
    --batch-id people-song-batch27-1 --topic song \
    --ids wang-pu,wei-renpu,shen-yilun --runner codex --concurrency 5

  # Cross-agent: draft with Claude Code CLI, review independently with Codex CLI:
  python3 .agents/skills/people-batch-workflow/scripts/cli_workflow.py \
    --batch-id people-song-batch27-1 --topic song \
    --ids wang-pu,wei-renpu --drafter-runner claude --reviewer-runner codex
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shlex
import sys
from pathlib import Path
from typing import Any

VALID_DECISIONS = {"pass", "needs-evidence", "needs-revision", "needs-decision", "reject"}


def build_runner_argv(runner: str, model: str | None, custom_cmd: str | None, repo_root: Path) -> list[str]:
    if custom_cmd:
        return shlex.split(custom_cmd)
    if runner == "codex":
        argv = ["codex", "exec", "-C", str(repo_root), "-s", "workspace-write", "--ephemeral"]
        if model:
            argv.extend(["-m", model])
        argv.append("-")
        return argv
    if runner == "claude":
        argv = ["claude", "-p", "--permission-mode", "acceptEdits"]
        if model:
            argv.extend(["--model", model])
        return argv
    raise ValueError(f"Unsupported runner '{runner}'. Use 'codex', 'claude', or pass --drafter-cmd / --reviewer-cmd.")


async def run_subprocess(argv: list[str], cwd: Path, stdin_text: str | None = None) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=str(cwd),
        stdin=asyncio.subprocess.PIPE if stdin_text is not None else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out_bytes, err_bytes = await proc.communicate(
        input=stdin_text.encode("utf-8") if stdin_text is not None else None
    )
    return (
        proc.returncode or 0,
        out_bytes.decode("utf-8", errors="replace"),
        err_bytes.decode("utf-8", errors="replace"),
    )


async def run_batch_check(repo_root: Path, batch_id: str, pid: str) -> dict[str, Any]:
    argv = [
        "npx",
        "tsx",
        "pipeline/people-batch-assemble.ts",
        "check",
        "--id",
        batch_id,
        "--person",
        pid,
        "--json",
    ]
    _, stdout, stderr = await run_subprocess(argv, cwd=repo_root)
    try:
        return json.loads(stdout)
    except Exception as exc:
        return {"ok": False, "problems": [f"Failed to parse check JSON ({exc}): {stderr or stdout}"]}


def verify_review_file(raw_dir: Path, pid: str, expected_hash: str, drafter_author: str) -> tuple[bool, dict[str, Any] | str]:
    review_path = raw_dir / "reviews" / f"{pid}.json"
    if not review_path.is_file():
        return False, f"Missing {review_path}"
    try:
        data = json.loads(review_path.read_text(encoding="utf-8"))
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
    return True, data


async def process_person(
    pid: str,
    *,
    repo_root: Path,
    raw_dir: Path,
    prompts: dict[str, str],
    batch_id: str,
    topic: str,
    mode: str,
    max_rounds: int,
    drafter_author: str,
    drafter_argv: list[str],
    reviewer_argv: list[str],
    sem: asyncio.Semaphore,
) -> dict[str, Any]:
    async with sem:
        print(f"[START] {pid}: round 1 drafting...", file=sys.stderr, flush=True)
        init_prompt = prompts["draft_initial"].format(
            batch_id=batch_id, topic=topic, pid=pid, mode=mode
        )
        code, _, err = await run_subprocess(drafter_argv, cwd=repo_root, stdin_text=init_prompt)
        if code != 0:
            print(f"[WARN] {pid}: drafter exited with code {code}: {err[:240]}", file=sys.stderr, flush=True)

        for round_idx in range(1, max_rounds + 1):
            check_res = await run_batch_check(repo_root, batch_id, pid)
            proposal_hash = str(check_res.get("hash") or "").strip()
            if not check_res.get("ok") or not proposal_hash:
                problems = "; ".join(check_res.get("problems") or ["Self-check did not pass"])
                print(f"[INCOMPLETE] {pid} (round {round_idx}): {problems}", file=sys.stderr, flush=True)
                return {
                    "personId": pid,
                    "status": "draft-incomplete",
                    "rounds": round_idx,
                    "reason": problems,
                }

            reviewer_id = f"cli-independent-reviewer-{pid}-r{round_idx}"
            print(f"[REVIEW] {pid}: round {round_idx} (hash={proposal_hash})...", file=sys.stderr, flush=True)
            rev_prompt = prompts["review"].format(
                batch_id=batch_id,
                topic=topic,
                pid=pid,
                mode=mode,
                round_idx=round_idx,
                proposal_hash=proposal_hash,
                reviewer_id=reviewer_id,
            )
            await run_subprocess(reviewer_argv, cwd=repo_root, stdin_text=rev_prompt)

            valid, rev_or_err = verify_review_file(raw_dir, pid, proposal_hash, drafter_author)
            if not valid or not isinstance(rev_or_err, dict):
                print(f"[REVIEW-FILE-ERROR] {pid} (round {round_idx}): {rev_or_err}", file=sys.stderr, flush=True)
                return {
                    "personId": pid,
                    "status": "review-file-error",
                    "proposalHash": proposal_hash,
                    "rounds": round_idx,
                    "reason": str(rev_or_err),
                }

            decision = str(rev_or_err["decision"])
            reason = str(rev_or_err["reason"])
            if decision == "pass":
                print(f"[PASS] {pid} (hash={proposal_hash}, rounds={round_idx})", file=sys.stderr, flush=True)
                return {
                    "personId": pid,
                    "status": "pass",
                    "proposalHash": proposal_hash,
                    "rounds": round_idx,
                }

            if decision in ("needs-decision", "reject") or round_idx >= max_rounds:
                print(f"[PENDING:{decision}] {pid} (rounds={round_idx})", file=sys.stderr, flush=True)
                return {
                    "personId": pid,
                    "status": decision,
                    "proposalHash": proposal_hash,
                    "rounds": round_idx,
                    "reason": reason,
                }

            print(f"[REVISE] {pid}: round {round_idx} -> {round_idx + 1} ({decision})", file=sys.stderr, flush=True)
            fix_prompt = prompts["draft_revision"].format(
                batch_id=batch_id,
                topic=topic,
                pid=pid,
                prev_round=round_idx,
                round_idx=round_idx + 1,
                review_reason=reason,
            )
            await run_subprocess(drafter_argv, cwd=repo_root, stdin_text=fix_prompt)

        return {"personId": pid, "status": "exhausted", "rounds": max_rounds}


async def async_main() -> int:
    parser = argparse.ArgumentParser(description="Host-neutral multi-agent CLI runner for Lantai person batches.")
    parser.add_argument("--batch-id", required=True, help="Initialized batch id under workspace/content/raw/<id>")
    parser.add_argument("--topic", required=True, help="Topic id, e.g. song")
    parser.add_argument("--ids", required=True, help="Comma-separated person ids")
    parser.add_argument("--mode", default="upgrade", choices=["upgrade", "errata"])
    parser.add_argument("--max-rounds", type=int, default=2)
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument("--runner", default="codex", choices=["codex", "claude"], help="Default CLI runner")
    parser.add_argument("--drafter-runner", choices=["codex", "claude"], help="Override CLI runner for drafters")
    parser.add_argument("--reviewer-runner", choices=["codex", "claude"], help="Override CLI runner for reviewers")
    parser.add_argument("--drafter-model", help="Optional model name passed to drafter CLI")
    parser.add_argument("--reviewer-model", help="Optional model name passed to reviewer CLI")
    parser.add_argument("--drafter-cmd", help="Custom command reading prompt on stdin for drafters")
    parser.add_argument("--reviewer-cmd", help="Custom command reading prompt on stdin for reviewers")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parents[3]
    prompts_path = script_dir.parent / "references" / "prompts.json"
    prompts = json.loads(prompts_path.read_text(encoding="utf-8"))

    raw_dir = repo_root / "workspace" / "content" / "raw" / args.batch_id
    scope_path = raw_dir / "scope.json"
    if not scope_path.is_file():
        raise FileNotFoundError(f"Missing {scope_path}. Run `npm run people:batch:init` first.")

    scope_data = json.loads(scope_path.read_text(encoding="utf-8"))
    drafter_author = str(scope_data.get("author", "workflow-drafter"))
    person_ids = [x.strip() for x in args.ids.split(",") if x.strip()]
    if not person_ids:
        raise ValueError("--ids must list at least one person id.")

    for pid in person_ids:
        if not (raw_dir / "items" / f"{pid}.md").is_file() or not (raw_dir / "items" / f"{pid}.json").is_file():
            raise FileNotFoundError(f"Missing initialized draft files for '{pid}' in {raw_dir / 'items'}.")

    drafter_argv = build_runner_argv(
        args.drafter_runner or args.runner, args.drafter_model, args.drafter_cmd, repo_root
    )
    reviewer_argv = build_runner_argv(
        args.reviewer_runner or args.runner, args.reviewer_model, args.reviewer_cmd, repo_root
    )

    sem = asyncio.Semaphore(max(1, args.concurrency))
    outcomes = await asyncio.gather(
        *(
            process_person(
                pid,
                repo_root=repo_root,
                raw_dir=raw_dir,
                prompts=prompts,
                batch_id=args.batch_id,
                topic=args.topic,
                mode=args.mode,
                max_rounds=max(1, args.max_rounds),
                drafter_author=drafter_author,
                drafter_argv=drafter_argv,
                reviewer_argv=reviewer_argv,
                sem=sem,
            )
            for pid in person_ids
        )
    )

    passed_ids = [item["personId"] for item in outcomes if item.get("status") == "pass"]
    pending = [item for item in outcomes if item.get("status") != "pass"]
    report = {
        "batchId": args.batch_id,
        "topic": args.topic,
        "mode": args.mode,
        "total": len(outcomes),
        "passedCount": len(passed_ids),
        "passedIds": passed_ids,
        "pendingCount": len(pending),
        "pending": pending,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(async_main()))
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
