# Milestone Oracle

A public, challengeable checklist for **one delivery milestone**, written as a GenLayer
Intelligent Contract (`contracts/milestone_oracle.py`, v0.1.0) (this repository). A separate repository holds its web client.

## The trust problem

Grants, bounties and milestone-based payments today depend on someone saying "yes, they delivered".
That person can be slow, biased, or simply unreachable, and the builder has no way to show that a
public, checkable promise was kept. Milestone Oracle turns the promise into a short checklist of
public facts that independent validators re-check themselves, with a challenge window before the
reading becomes final. It holds **no funds**: a finalized verdict is an attestation that a person or
another contract can read with `get_attestation()`.

## How it works

A **funder** (the deployer) names a **builder** (a different address), a deadline date and up to four
checks. Everything is fixed at deployment.

| Check kind | What validators verify | Model involved? |
|---|---|---|
| `GITHUB_RELEASE` | `api.github.com/repos/<repo>/releases/tags/<tag>` answers 200, `tag_name` matches, not a draft, not a prerelease, `published_at` is on or before the deadline | no |
| `REPO_FILE` | `raw.githubusercontent.com/<repo>/<ref>/<path>` answers 200 and contains a fixed phrase (case and spacing folded) | no |
| `LIVE_PAGE` | the URL answers HTTP 200 and contains a fixed phrase | no |
| `DELIVERABLE` | a page demonstrates a stated claim; the model must quote the page verbatim, an unanchored answer counts as `ERROR` | yes |

Each check ends as `PASS`, `FAIL`, `LATE` (release published after the deadline) or `ERROR` (a source
could not be read: rate limit, outage, bad JSON). `ERROR` is never counted as a failure of the work.
Validators must reach the **identical per-check result**; the deterministic kinds need no model at all,
so they do not depend on a model's wording.

| Verdict | When |
|---|---|
| `MET` | every check passes |
| `NOT_MET` | a check failed after the deadline day ended, or a release was published late |
| `NOT_YET` | a check fails but the deadline day (UTC, to 23:59:59) has not ended |
| `INCONCLUSIVE` | nothing failed, but at least one source could not be read |

Flow: `start_round` (funder or builder) → `assess` (funder or builder) → a `MET` or `NOT_MET` reading is
**provisional** for the challenge window → `finalize` (anyone) re-reads every check; it finalizes only if
the new reading equals the provisional one. Evidence that disappears during the window cannot be
finalized. `NOT_YET` and `INCONCLUSIVE` go to `NEEDS_EVIDENCE` and allow a new round.

**Amendment (the challenge).** During the window of a provisional `NOT_MET`, or in `NEEDS_EVIDENCE`, the
builder may call `amend(check_id, new_target, note)` for a failing check: a different release tag, a
different file path, or a different URL **on the same site**. Criteria (phrases, claims, repo, deadline)
never change. At most three amendments in total, each recorded in the history with the builder's note.

## What is different from EventWitness

EventWitness decides what one event's status is by voting across three sites. Milestone Oracle has
two named roles, a deadline, a checklist of heterogeneous checks, plain HTTP facts instead of model
readings wherever possible, and an amendment that moves where evidence is looked up but not what
is demanded. They share the provisional → window → re-read pattern, nothing else.

## Known limitations

* `MET` says the stated public checks hold. It does not say the work is good.
* `REPO_FILE` and `LIVE_PAGE` read the content **as it is now**, not as of the deadline. Only
  `GITHUB_RELEASE` carries a timestamp.
* Unauthenticated `api.github.com` is rate limited per IP. A limited validator reports `ERROR`, which
  leads to `INCONCLUSIVE` and a new round, never to a false failure.
* A release tag can be moved or a release deleted by its maintainer; a finalized verdict records the
  reading at finalization time only.
* Funder and builder being different addresses does not prove they are different people.
* `DELIVERABLE` is the only subjective kind. It was tested with mocked model answers only.
* "Same site" for amended URLs is a registrable-domain heuristic; on shared hosts (github.io, vercel.app, netlify.app and a few more) the whole host must match.
* The URL grammar is narrow (https, no ports, no userinfo, no fragments) but this is not a DNS or
  redirect sandbox.
* The consensus clock comes from the transaction timestamp; the contract has no other clock.

## Tests and evidence

* `tests/direct/test_milestone_oracle.py`: **153 tests** in genlayer-test direct mode (in-memory, web and
  model mocked): deployment validation, access control, every check kind and failure mode, verdict
  mapping and deadline boundaries, challenge window, finalization, amendments, history, validator
  behaviour. Output: `evidence/direct-tests.txt`.
* `evidence/mutation-checks.txt`: 26 deliberate breakages of the contract, each applied alone. 25 are
  caught by the suite; the one survivor is an equivalent mutant (a redundant defensive check).
* `evidence/live-run-1.txt`: the Studionet run (see the demo section below; added after the live run).
* Not exercised in the sandbox: a real Studionet run, the real GitHub API, real validator model
  disagreement.

## Web client

The contract has a separate wallet-based web client, kept in its own repository so that each submission
stays self-contained: https://github.com/Oziman13/genlayer-milestone-oracle-app
(page: https://oziman13.github.io/genlayer-milestone-oracle-app/web/). It is not part of this repository.

## Deploy

Constructor: `(builder_address, title, deadline_date, checks_json, challenge_window_seconds)`.

Demo checklist used in the Studionet run:

```json
[{"id":"release","kind":"GITHUB_RELEASE","repo":"Oziman13/genlayer-milestone-oracle","tag":"v0.1.0"},
 {"id":"readme","kind":"REPO_FILE","repo":"Oziman13/genlayer-milestone-oracle","ref":"main","path":"README.md","phrase":"Known limitations"},
 {"id":"live","kind":"LIVE_PAGE","url":"https://oziman13.github.io/genlayer-milestone-oracle-app/web/","phrase":"Milestone Oracle"}]
```

## Demo instance

The demo milestone is this repository plus its web client: "ship v0.1.0 with a Known limitations section and a live page" (the live page is the client's page).
It was run with two Studio test accounts controlled by the same person, so it demonstrates the mechanics,
not an independent attestation.

* Contract (Studionet): `0xb222ae7ee55C8E71f11A6d97c49932DEA1177786`
* Shareable view: https://oziman13.github.io/genlayer-milestone-oracle-app/web/?address=0xb222ae7ee55C8E71f11A6d97c49932DEA1177786
* Result: round 1 finalized as MET (all three checks PASS); transcript in `evidence/live-run-1.txt`
* Page: https://oziman13.github.io/genlayer-milestone-oracle-app/web/
