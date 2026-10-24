# Technical hardening review

## Initial audit (before implementation)

Scope: the two supplied repositories, their source, tests and historical evidence. This is a focused engineering review, not a formal audit. No live transactions, deployment, Pages publication or environment recreation is authorized or needed.

Baseline app main: e77dfbbddc5bff287b7d453440216768efd011d5. The original checkout is unchanged. The app branch starts from freshly fetched main.

| Priority | Classification | Finding and reproduction |
| --- | --- | --- |
| P0 | TRUST-MODEL LIMITATION | REPO_FILE, LIVE_PAGE and DELIVERABLE inspect current content, including after the deadline. MET is not historical delivery proof. Release published_at dates publication, not immutable contents. Existing finalize compares verdict categories, not evidence bytes or per-check results. |
| P1 | CONFIRMED BUG | Landing ASSESS rows all count state.latest_results. Round 1 with one PASS then round 2 with three PASS displays three for both. FINALIZE rows are stamped FINAL even when the recorded phase is NEEDS_EVIDENCE. |
| P1 | CONFIRMED BUG | pickCreated returns the newest funder/builder/title match. Two identical creations deterministically select the later one; even one recent match does not associate it with this transaction. Only the newest 50 rows are inspected. |
| P1 | TRUST-MODEL LIMITATION | Factory constructor accepts any source containing class MilestoneOracle; its hash identifies supplied bytes, not an approved implementation. A different factory can deploy children that fabricate self-consistent history. URL factory overrides are self-selected provenance. |
| P1 | CONFIRMED BUG | Factory deployment page uses sendAndConfirm without remember, so ambiguous/pending deployment can be repeated and reload loses its lock. FINALIZED with unreadable execution clears the shared pending record too. |
| P1 | UNVERIFIED OPERATIONAL RISK | Default child reads in factory v0.1.1 are not proven network-finalized reads. Historical probe reports explicit-final timeouts. This review has not independently established Studionet finality or live transaction-list/return-data schema. |
| P2 | DOCUMENTATION INCONSISTENCY | README says the app contract is the same as the original; it adds an optional explicit funder. config.js describes the factory example as v0.1.0 direct deploy, contrary to the factory live-run transcript. |
| P2 | CONFIRMED BUG | Builder row links omit the selected factory; opening a custom-factory milestone falls back to default provenance. |
| P2 | UNVERIFIED OPERATIONAL RISK | URL grammar is not a DNS/redirect sandbox; shared-host scope is a heuristic, not PSL. Quote anchoring and prompt separation constrain LLM output but do not prove resistance to prompt injection. |

## Contract relationships and compatibility

Original v0.1.0: five arguments, deployer is funder. App v0.2.0: same state transitions and checks, optional sixth funder_address; empty means deployer, factory supplies caller. Explicit funder on an arbitrary direct deployment is attribution, not proof of consent. Factory v0.1.1 embeds constructor source and deploys it with six arguments; membership is local to that factory.

record() checks membership, duplicate prevention, FINALIZED flag/phase, MET/NOT_MET, builder/funder/title matching creation metadata, and last history action/verdict. It does not independently authenticate an arbitrary factory, its source getter, or the truth of arbitrary child metadata. With the supplied immutable child implementation the final history is generated internally; changing that model requires a new version.

Known recorded deployment evidence is historical author evidence, not a fresh independent chain verification. See the version map and final validation sections below (completed after implementation).

## Executive summary and implemented corrections

The review improves historical rendering, fail-closed creation recovery, provenance disclosure and transaction safety. It does **not** make the protocol a historical-delivery oracle or establish production-grade Studionet finality. Existing contract source bytes and addresses are unchanged. The original repository needs no modifications or branch.

- `web/src/landing.js`: each ASSESS counts its own history.results; a FINALIZE event is stamped FINAL only when its own phase is FINALIZED. Rechecks say NEEDS_EVIDENCE. Read up to 64 events rather than truncating the supported multi-round workflow at 12. Escaping remains applied.
- `web/src/main.js`, `record.js`: retire metadata matching for factory child identity. A successful creation retains its hash/factory across reload, clears the old loaded milestone, blocks sends and requests transaction-specific manual verification. Even one metadata match is not proof. An explicit acknowledgement releases the lock without claiming verification or non-submission. Check-again rechecks the retained hash. Legacy records use the same fallback.
- `web/src/wallet.js`, `deployfactory.js`: factory deployment uses the shared durable pending record. Unreadable finalized execution retains its hash/lock. Pending state blocks sends across entry points. An initial recovery-storage write must succeed before signing; an in-memory fallback keeps the current page blocked if storage later fails. Account/client are checked again immediately before signing after asynchronous nonce lookup; the sending client is captured. The deployment page resets connection on wallet/network changes.
- `web/src/recovery.js`: listed transactions must have the expected sender, target and exact known nonce; missing fields or later nonce no longer qualify. A decreased nonce is not proof of non-submission.
- `web/src/provenance.js`, builder/card/main: distinguish the fixed known demo address from arbitrary factory URL overrides. Show the address, default-read finality caveat and current-state limitation, including embedded records. Hash comparison on the deploy page is described as self-reported source consistency, not implementation approval.
- Builder links retain their selected factory and use checksum addresses. README, app/landing/card wording cover all three nonhistorical check kinds; config's incorrect v0.1 direct-deploy description is corrected. Historical transcripts are preserved.
- Regenerated bundles accompany source changes. The probe bundle changes only because it imports the shared wallet module; no new live probing or broadcasting was performed.

## Confirmed defects and severity

| Severity | Confirmed defect | Reproduction / regression |
| --- | --- | --- |
| High (integrity) | A successful create may load a different same-title/same-party milestone. | Old pickCreated returns the newest of two identical metadata matches. Browser cases cover identical/consecutive and concurrent matches, >50 recent creations, indexing delay, unreadable children and reload; none may adopt an address without transaction-specific proof. |
| Medium | Historic ASSESS rows use latest results; failed finalization is labelled final. | Live-landing mock history has round 1: 1/3 PASS, round 2: 3/3 PASS, then an INCONCLUSIVE recheck and final MET. Before fix, first count and recheck label fail. |
| High (duplicate-send risk) | Factory deployment has no durable pending context and can be repeated after an ambiguous send/reload. | Mock wallet `errorButSent` increments nonce then throws. Pending stage must be ambiguous and deploy disabled, including after reload. |
| High (duplicate-send risk) | FINALIZED with unreadable execution clears pending despite unknown effect; failed storage writes are ignored. | Browser tests require hash retention/locked sends on UNCLEAR and no eth_sendTransaction when setItem fails before signing. |
| Medium | Listing recovery accepts missing sender/target/nonce and a different later nonce. | Four helper regressions fail before tightening matching; exact account/target/nonce still works, multiple equal-nonce candidates remain unresolved. |
| Medium | Mutable wallet client can change while network/nonce queries await. | Browser mock emits accountsChanged during nonce lookup for a milestone action and factory deployment; both must abort without signing. |
| Low | Custom factory provenance is lost in builder row links. | Browser assertion requires the selected factory in the link, plus visible custom-factory warning in badge mode. |

These severities describe plausible application integrity/duplicate-action impact, not fund theft: the protocol holds no funds. No malicious live transaction was attempted.

## Trust model and targeted security review

- **Historical evidence (P0 limitation):** all three nonrelease kinds can PASS after the deadline without a publication timestamp. Content can change while keeping a phrase and still finalize. A NOT_MET recheck can finalize with a different failing check if the aggregate verdict is unchanged. These are compatibility guarantees explicitly exercised by tests, not silently changed semantics. Release PASS relies on GitHub's reported publication timestamp and current metadata; mutable notes/assets and tag movement are outside that guarantee.
- **Verdict precedence:** LATE always gives NOT_MET; FAIL gives NOT_YET through the deadline's last UTC second and NOT_MET afterward; ERROR alone gives INCONCLUSIVE. ERROR does not cancel a separate known FAIL. Existing tests cover unavailable sources, deadline boundaries, MET/NOT_MET terminal states, changing or disappearing evidence and consensus disagreement.
- **Authorization/identity:** party-only start/assess, builder-only restricted amendments, permissionless finalization after the window. The optional v0.2 funder is caller-supplied outside a trusted factory, not proof of consent. Separate addresses are not independent people. A third party can create milestones naming a builder; the 100-child builder capacity can be consumed without builder approval (source-reviewed design limitation, not stress-tested here).
- **Factory provenance:** constructor checks only a class-name substring/size and hashes supplied text. The new simulator test supplies a fabricated but self-consistent child implementation: that alternate factory records it. This proves the scope of the trust assumption, not a bypass of membership in the known demo factory. The fixed demo address is identified from project history, not authenticated by a fresh chain-code inspection. A getter/hash can lie on arbitrary implementations.
- **Record consistency:** source-reviewed checks enforce own membership, no duplicates, FINALIZED flag/phase, eligible verdict, creation builder/funder/title, positive history count and last action/verdict. Eight adversarial child cases reject contradictory identity/finality/history. Round, history phase, result-map consistency and arbitrary metadata truth are not independently enforced by v0.1.1. They are safe only under the approved-child-source assumption. Existing source has no setters for creation criteria outside the documented target amendments.
- **Finality:** default proxy.view() reads are used because the supplied historical probe reports explicit-final timeouts. Contract phase FINALIZED is application state; it is not proof of network-finalized state. No equivalence, rollback protection or fresh live finality result is claimed.
- **URLs/model:** HTTPS-only grammar rejects ports, credentials, fragments, numeric IP forms and several local suffixes. It does not resolve DNS or constrain redirects; shared-domain policy is a finite heuristic, not PSL. LLM untrusted-data separation, strict JSON shape and verbatim-quote anchoring are useful constraints, not proof against prompt injection or colluding/equally mistaken models. Consensus compares per-check results, not page bytes or semantic truth. Sizes/checks/rounds/amendments are bounded; network fetch cost is not established by response truncation alone.
- **Frontend:** contract strings remain escaped or textContent; hostile title regression verifies no HTML execution. Changing wallet accounts/network cannot bypass contract authorization. Known pending hashes are polled and UNCLEAR stays blocked; user rejection does not report success. Transaction listing is still a trusted-RPC/SDK assumption: matching sender/target/nonce does not independently authenticate call arguments or replacement-transaction intent. getCurrentNonce in installed genlayer-js 1.1.8 defaults to pending; that runtime behavior was not independently verified live. Cross-tab atomic locking, corrupt/malicious localStorage, RPC spoofing, wallet behavior after signature, and storage removal after broadcast remain operational concerns. The diagnostic probe page is not a production transaction workflow; it is not comprehensively hardened/tested here.

## Contract version and deployment map

Hashes below identify exact local source bytes, not independently retrieved on-chain code.

| Version / authority | Repository and source | Constructor / deployment | Known Studionet address from preserved evidence | SHA-256 | Compatibility / coverage |
| --- | --- | --- | --- | --- | --- |
| Oracle v0.1.0, historical direct workflow | original repo `contracts/milestone_oracle.py` | builder, title, deadline, checks_json, window; deployer=funder; direct deployment | `0xb222ae7ee55C8E71f11A6d97c49932DEA1177786` | `ff27f218698704b58153807fd4fb29974a36019e48d15e713227d6df67ae3baf` | unchanged; 153 original mocked direct tests |
| Oracle v0.2.0, app direct + Factory workflow | app `contracts/milestone_oracle.py` | same five args plus optional funder_address=""; direct five-arg or factory six-arg deployment | `0xDf63AB2C788c452e5E0088E6767Fe78e6e93ce30` through v0.1.1 factory; historical v0.1 factory child `0x42352FD9dB57BD25241C72E18E3E0bf19359e8A0` | `701af4e636c2b0b56aaabf7cb6e396c312eca9767be8f9924edd444ebe1b790a` | unchanged; legacy five-argument tests plus explicit-funder tests and nine guarantee tests |
| Factory v0.1.1, configured demo record | app `contracts/milestone_factory.py` | milestone_code; deploys v0.2 children with six args | `0x123352e162Fa441Ba1C4252662A7d00EC05fb737` | `cebbba8040a40b3778c6fcea6774f2c1056e078af1c23a3dac2870d08bc0b263` | unchanged; local five-validator integration tests |
| Factory v0.1.0, historical timed-out final-read version | no separate authoritative source in this checkout; historical transcript only | milestone_code; explicit-final child reads per evidence | `0x1C9eE0e275D03329a500fc654BD9dF6e90E882d3` | not independently available; do not substitute v0.1.1 hash | historical read timeout evidence only; no new deployment/test |

The v0.2 oracle differs from v0.1 only in version comment, constructor funder handling and explanatory comments. It is authoritative for app/factory compatibility; original v0.1 remains authoritative for its historical workflow. The landing live example is the v0.2 factory-created milestone, not the old direct deployment. Builder and card pages read supplied contracts and therefore cannot grant credibility to arbitrary sources merely by rendering them.

## Before/after validation evidence

The initial added page regressions, run against original bundles/helpers, reported **43 passed / 3 failed**: duplicate matching, historical count and false FINAL label. The first wallet regression run reported **108 passed / 10 failed** (including creation/reload and unknown execution checks); its first ambiguous-deployment fixture used an unsupported mock send mode, so that individual failure is not counted as valid before-fix proof. The fixture was corrected to `errorButSent`, which exercises the old no-remember path reproducibly. Recovery matching later produced four failing cases for missing sender/target/nonce and later nonce. A builder-link assertion was updated intentionally to require retained provenance.

A representative mutation run selected an idle-only attestation test at first; that target alone did not detect leaking nonfinal verdicts. The repeated runner now uses the existing disappearing-evidence test, which does detect it. This is not evidence that all old mutation transcripts were freshly rerun. Four representative mutations on disposable original-repo copies are killed; the historical 26-mutant transcript stays untouched.

## Studionet evidence and network limitations

The preserved 2026-10-21/22 transcripts are the author's historical runs with their own Studio accounts. They are not independent live attestation by this review. Attempts to fetch the supplied public app's config and contract source returned HTTP 403 from this environment; live-page/source matching could not be verified. No network policy was changed. No blockchain transaction, deployment, wallet signature, Pages publication or replacement address occurred.

## Compatibility, remaining work and merge recommendation

Existing contract APIs, constructors, sources, metadata, addresses and finalized meanings stay byte-for-byte unchanged. Manual factory-child recovery is an intentional UX restriction: automatic adoption is unavailable until an actual GenLayer transaction-specific identity/return schema is established. Smaller matching lists, recency, indexing waits or extra metadata do not solve that association problem.

See [the v0.3 historical-verification and future factory proposal](HISTORICAL-VERIFICATION-V0.3-PROPOSAL.md). It describes required trust decisions and unrun acceptance cases; it is not a deployed or implemented protocol. Before production claims: independently authenticate factory/child source and chain identity; resolve network-finalized child reads; establish exact child association and transaction replacement intent; validate real wallet/node recovery; define historical-proof authority/policy; assess DNS/redirect/LLM boundaries and capacity abuse.

**MERGE** the scoped frontend/documentation/test hardening after normal review. **DO NOT MERGE** any claim of historical delivery proof, production readiness, audited arbitrary factories or verified network finality based on these changes. No contract replacement or deployment is proposed for automatic execution.

## Final validation (current local instance)

| Check | Result | Execution model |
| --- | --- | --- |
| App `pytest tests/direct` | **168 passed**, one plugin rewrite warning | in-memory contracts; HTTP/model mocked |
| App `pytest tests/glsim` | **31 passed**, one plugin rewrite warning | local five-validator simulator; external evidence mocked; includes fabricated-child provenance cases |
| App wallet browser script | **124 passed, 0 failed** | Chromium + mock EIP-1193 wallet/RPC; no live signing |
| App pages browser script | **56 passed, 0 failed** | Chromium + mock RPC; includes event-specific history, custom provenance, escaping, strict recovery matching |
| Original `pytest tests/direct` | **153 passed**, one plugin rewrite warning | original source unchanged; mocked HTTP/model |
| Total executed suite tests/checks | **532 passed, 0 failed** | no zero-test substitute, skips or expected-failure claims |
| Representative original mutation checks | **4/4 killed** | disposable copies; not the full historical 26-mutant campaign |
| `npm run build` | **7 bundles built** | regenerated outputs shipped in branch |
| Independent output-directory rebuild | **7/7 byte-identical** | checks generated bundles match current source |
| `git diff --check` | passed | no whitespace errors |

Commands use the existing `/workspace/.venv` with `PYTHONPATH=/workspace/setup/python`, `PYTHONDONTWRITEBYTECODE=1`, pytest `-p no:cacheprovider`, and `CHROMIUM_PATH=/usr/bin/chromium`. No installation/refresh script or environment publication was run during hardening. All historical evidence files and dependency lockfiles remain unchanged. Exact run logs are in `/workspace/setup/hardening-{direct,glsim,browser,original,mutations,build}.log` in this instance; they are not represented as historical chain evidence.

The isolated idle-only attestation mutation pilot is not counted as a passing mutation check. Regressions were investigated and rerun after the appropriate corrections; the final table reports the completed passing runs.

Local HTTP smoke check: current app HTML returns the historical-guarantee wording, and the served contract source is byte-identical to the unchanged app contract. The previous setup server had stopped, so only the static service was restarted; no environment setup was repeated.

## Affected files

- `README.md`
- `docs/HISTORICAL-VERIFICATION-V0.3-PROPOSAL.md`
- `docs/TECHNICAL-HARDENING-REVIEW.md`
- `scripts/check-original-mutations.py`
- `tests/browser/pages.test.mjs`
- `tests/browser/wallet_flow.test.mjs`
- `tests/direct/test_evidence_guarantees.py`
- `tests/glsim/test_factory_record.py`
- `web/app.html`
- `web/app.js`
- `web/builder.js`
- `web/card.js`
- `web/config.js`
- `web/deploy-factory.html`
- `web/deploy-factory.js`
- `web/index.html`
- `web/landing.js`
- `web/probe.js`
- `web/src/builder.js`
- `web/src/card.js`
- `web/src/deployfactory.js`
- `web/src/landing.js`
- `web/src/main.js`
- `web/src/provenance.js`
- `web/src/record.js`
- `web/src/recovery.js`
- `web/src/wallet.js`
