# Milestone Oracle: instructions for agents

Network: GenLayer Studionet (a test network). The contract holds no funds. Use a Studio test account, never an account that holds real value.

## What it does
A funder lists up to four public checks for a delivery. Validators re-check the facts, the reading is provisional during a challenge window, and after the window anyone can finalize it. Finalized verdicts can be added to a public per-builder record.

## Read a milestone (no account needed)
Call these view methods on the milestone contract address:
- `get_state_json()` returns JSON: title, funder, builder, deadline_date, checks, phase, round, candidate, latest_verdict, latest_results, window_end, amendments, history_count.
- `get_attestation()` returns the final verdict (`MET`, `NOT_MET`) or `NONE`.
- `get_history_json(i)` returns history row `i` (0 to history_count-1).

Phases: IDLE, OPEN, PROVISIONAL, NEEDS_EVIDENCE, FINALIZED. Check results: PASS, FAIL, LATE, ERROR. ERROR means a source could not be read; never report it as a failed delivery.

## Act on a milestone (needs the funder's or builder's account)
1. `start_round()` (funder or builder), phase must be IDLE or NEEDS_EVIDENCE.
2. `assess()` (funder or builder), phase must be OPEN. Validators read the sources.
3. `amend(check_id, new_target, note)` (builder only, at most 3 times). Moves only WHERE a failing check looks.
4. `finalize()` (anyone), only after the challenge window has passed.
A transaction is done only when its status is FINALIZED and the call itself returned without error. ACCEPTED is not done.

## Create a milestone through the factory
`create_milestone(builder_address, title, deadline_date, checks_json, challenge_window_seconds)` on the MilestoneFactory. The caller becomes the funder and must differ from the builder. Check kinds: `GITHUB_RELEASE {repo, tag}`, `REPO_FILE {repo, ref, path, phrase}`, `LIVE_PAGE {url, phrase}`, `DELIVERABLE {url, claim}`.

## Delivery record (factory)
- `record(milestone_address)` (anyone) after a milestone is FINALIZED with MET or NOT_MET. Only factory-created milestones are accepted; the factory reads the result back itself.
- `get_builder_summary(builder_address)` returns counts and the recorded milestones.
- `export_feedback(milestone_address)` returns an ERC-8004-SHAPED signal (value 100 for MET, 0 for NOT_MET). It reuses field names only. Nothing is written to any ERC-8004 registry.

## Report like this
Verdict, each check with its result, the milestone address, and the Explorer link. If anything is ERROR or the round is not final, say so instead of calling it delivered or failed.

## Limits you must state
MET means the stated public checks hold, not that the work is good. A file check reads the file as it is now, not as of the deadline. A record covers only milestones made through this factory. One person can control several addresses.
