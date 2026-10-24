# P1/P2 correctness remediation

Branch: `codex/p1-p2-correctness-remediation`.
Baseline: `182b5cffcc27fe1452e56eef42465fb43bb22d77` (the audited mobile frontend).

Scope: confirmed audit findings F01–F07. This change fixes client correctness; it does not redesign the Proof Journey, change contracts, integrate WalletConnect or establish network finality/immutability. The original contract repository is unchanged. The initial remediation was local only. Final publication status is reported separately below. No production change, deployment, real wallet, signature or blockchain transaction was performed.

## Root causes and fixes

| Finding | Root cause | Resulting fix |
| --- | --- | --- |
| F01: stale milestone reads / action context | Each view read the mutable address input; responses and errors had no generation guard; action targets were independent of the displayed state. | Capture one checksum address and generation per load. Read/validate state, attestation and history before publishing the completed read set. Discard superseded results/errors, including pending Factory membership/record reads. Input edits invalidate loaded state immediately. Actions require a successfully loaded matching address and revalidate that context after asynchronous preflight, before the existing wallet build function. No target is guessed or retargeted. |
| F02: hidden custom Factory warnings | Presentation scripts moved provenance into closed details; badge CSS explicitly hid it. | Keep the original full warning outside collapsible content. Normal pages retain the existing source/finality limitations. Badges show a short visible known-demo/custom-unverified distinction, full selected Factory address and network-finality caveat. Decorative badge spacing and labels are compacted to retain the 150px embed. Mobile cards and desktop table remain intact. |
| F03: delayed EIP-1193 initialization | Event subscriptions and mobile help ran once before a provider existed. | Shared idempotent discovery binds one listener set per provider object, on initialization/focus/pageshow or a 500ms property-only fallback. Inactive provider events are ignored. Replacement/loss/disconnect clears the active client/account but preserves pending storage. Connection awaits reject intervening provider/account/disconnect changes. Mobile guidance updates on discovery and viewport changes. Discovery never requests accounts, network switches or signing. |
| F04: stale Builder queries | A delayed summary overwrote a newer request or edited input. | Capture requested builder and generation; ignore late successes/failures, invalidate on edit, and require the returned builder to match the requested address before rendering. |
| F05: malformed structured RPC responses | Date/check formatting happened without validating values and outside a complete async error boundary. | Shared read validators reject invalid check objects/IDs/kinds, unsupported history counts, invalid counters and out-of-range timestamps before controls/renderers use them. Builder rejects an invalid eligible record timestamp and catches its entire render path. Card validates history, rejects malformed checks and catches rendering exceptions. Errors replace loading states instead of leaving an unhandled rejection. |
| F06: narrow-screen horizontal overflow | The decorative hero pseudo-element extended 10% beyond the container; body clipping did not prevent root scrolling. | Contain that decoration with `right:0`. No global content/focus clipping or visual redesign. |
| F07: inaccurate creation explanation | Static wording described direct code deployment even when the app called a Factory using stored source. | Explain the selected Factory stored-source call or direct local-source deployment independently. No request arguments or transaction meaning change. |

## Important behavior boundaries

- Address/generation consistency is a client-side read/action binding. It is **not** a network snapshot/finality proof or a guarantee that separate RPC reads use one protocol state version.
- Existing `computeActions` role/phase rules, pre-send network/account checks, transaction outcome classification, nonce handling, pending record schema, ambiguous-send lock, reload recovery and manual child-address verification remain in place. Input changes can cancel an unsubmitted build; they do not alter the target of an already submitted transaction.
- No Factory/Oracle source, deployed address, source digest or protocol setting changed. Permission checks in the contract remain the authorization boundary; UI eligibility is not on-chain authorization.
- Validation follows the current Oracle model: 1–4 uniquely identified checks, supported check kinds, nonnegative integral counters, at most 64 history entries, and UTC timestamps through year 9999. Canonical existing milestones fit these bounds. Future incompatible contract schemas may need an explicit client validator update rather than being silently rendered.
- `window.ethereum` EIP-1193 injection is still required. There is no WalletConnect or EIP-6963 selection UI. Providers without `.on()` can connect through `.request()` but cannot supply the account/chain events the application subscribes to. Physical mobile-wallet behavior is not claimed verified.

## Regression coverage

The new `tests/browser/correctness.test.mjs` is part of `npm test`. It serves only local files, intercepts RPC, rejects non-read RPC methods and forbids wallet signing methods. It adds **45 test cases**:

- Five distinct delayed read stages: state, attestation, history, membership and stored record. A later address always wins.
- Late success versus latest failure, late failure versus latest success, pending refresh and A–B–A input changes without a successful new load.
- Selected-address change during nonce preflight aborts before any signing request and clears only the unsent attempt through the existing outcome logic.
- Known/custom Factory badges at 360/390/768/1440px: full address and meaningful warning visible; count content fits 150px height.
- Delayed injection with and without an initialization event; one account/chain/disconnect listener each after repeated discovery; account/network events, provider replacement/loss, disconnects and pending-record preservation.
- Disconnect while connecting on both Workspace and Factory deployment pages must not revive an old account.
- Out-of-order Builder successes/failures, latest failed query, malformed JSON, huge timestamps and wrong-builder summaries.
- Null checks, invalid history timestamps and huge history counts in both Workspace and Card; no unhandled page errors or permanently loading state.
- Landing width/scroll checks at 390/768/1440px, with keyboard/reduced-motion stage navigation preserved.
- Accurate Factory versus direct-deployment explanation.
- All 100 records, repeated reload, literal malicious title text, no duplicate mobile cards and selected-Factory evidence links.
- Workspace, desktop ledger, mobile cards, Factory screen, verdict card and diagnostics at mobile/tablet/desktop widths.

Existing tests were not weakened or disabled. In particular, the previously failing `custom factory: warning stays visible in embedded record` assertion is unchanged and now passes.

### Before/after negative controls

The new harness was also pointed at an archived, unmodified `182b5cff` web/contracts tree outside the checkout. Four selected tests failed there as intended: stale state response, custom Factory badge visibility, 768px landing overflow and Factory creation explanation. These are negative controls, not unresolved failures in the final branch. All four pass in the current 45-case suite.

## Completed verification

| Check | Result |
| --- | --- |
| Existing mocked wallet browser checks | **124 passed, 0 failed** |
| Existing page/helper browser checks | **56 passed, 0 failed** |
| New read-only correctness regressions | **45 passed, 0 failed**, no skipped/cancelled tests or signing requests |
| App direct contract + local simulator tests | **199 passed** (168 direct + 31 glsim), one existing plugin rewrite warning |
| Original direct contract tests | **153 passed**, one existing plugin rewrite warning |
| Total suite tests/checks | **577 passed, 0 failed** |
| Frontend build | Seven bundles built; independent output-directory rebuild is **7/7 byte-identical** to checked-in outputs |
| Whitespace check | `git diff --check` passes |
| Visual checks | 22 read-only Chromium screenshots: seven pages at 390/768/1440px plus 360×150 custom Factory embed; representative mobile cards, badge and landing screenshots inspected |

The six changed generated bundles reflect shared client imports; `web/landing.js` rebuilt identically and has no diff. No dependency installation/upgrade or lockfile change was needed. Existing Node/Chromium/Python tooling was reused.

Logs for this instance are under `/workspace/setup/remediation/`: `final-browser.log`, `app-contracts.log`, `original-contracts.log`, `build.log`, `rebuild.log`, `baseline-regressions.log`, `visual.log`, and `screens/`. An initial address-persistence compatibility mismatch was corrected by retaining the user's original input spelling while binding reads/actions by checksum. The final full browser run includes that correction.

## Remaining verification limits and out-of-scope findings

- Real iOS/Android, MetaMask Mobile, remote injection timing and custom-network support still require a device test. Chromium mocks do not prove real wallet behavior.
- Live Pages/Studionet equality or availability was not independently reverified. No actual wallet interaction, signature, blockchain write or contract deployment was performed. Historical demo addresses and source bytes were preserved, not re-deployed.
- No network finality, immutable code, upgrade authority or historical delivery proof is established by this work.
- Current-generation requests are ignored when stale; underlying fetches are not necessarily cancelled. Deliberately repeated reads can consume network resources, but cannot publish superseded state.
- Existing multi-tab pending-state atomicity, malicious/corrupt local storage, provider behavior after a signature begins and replacement transaction intent remain separate operational questions. This patch does not change transaction semantics to speculate around them.
- P3 tablet tag wrapping and duplicate chapter accessible names from the audit are intentionally outside this P1/P2 remediation. No new connection mechanism or visual redesign was added.

## Final independent review against latest main

The fetched `origin/main` remains `182b5cffcc27fe1452e56eef42465fb43bb22d77`. All 26 changed files were reviewed, including source/bundle correspondence and presentation-only changes. Contracts, addresses/configuration and the dependency lockfile remain unchanged. Pending recovery, nonce handling and contract authorization rules retain their existing implementations.

One additional confirmed provider race was fixed: a provider replaced without an initialization event could be used for the network check while the write client still referenced the previous provider during the 500ms discovery interval. Preflight now refreshes provider discovery immediately; the final chain read also refreshes after its await and requires provider identity consistency. The existing account/client guards therefore abort before the wallet build. Two read-only regression cases cover replacement during nonce preflight and inside the final chain read. The nonce case fails against the pre-review bundle and passes after the correction.

Listener review: subscribers are removed by the returned unsubscribe function and the discovery timer/window listeners stop when the last subscriber leaves. Provider event bindings remain one set per provider object; they are intentionally retained and gated by active identity, including for legacy providers without removal APIs. Inactive-provider events cannot update subscribers. This is not a claim that every provider's event listeners are physically detached.

Final validation reruns the full browser suite: 124 wallet checks, 56 existing page checks and 45 correctness tests (225 total). The unchanged Python suites previously passed 199 app and 153 original-contract tests; they are not newly executed by this frontend-only final review. Seven independent bundle rebuilds are byte-identical and whitespace checks pass. Review logs: `/tmp/mo-final-review-all.log`, `/tmp/mo-provider-negative.log`, `/tmp/mo-provider-positive.log`, `/tmp/mo-final-review-build.log`. Real device/live-network limits above continue to apply.

## Proposed PR description

**Title:** Fix stale read/action binding, provider initialization and mobile provenance regressions

**Problem and behavior:** Late milestone and Builder RPC responses could overwrite a newer selection; controls and links could describe another contract. The redesign hid custom Factory warnings in badge embeds, and delayed provider injection missed account/chain listeners. Malformed read responses could leave loading screens stuck, the landing decoration overflowed narrow viewports, and creation text described the wrong source flow.

**Change:** Bind completed reads and action preflight to an address/generation; invalidate on input changes; guard Builder results; validate/catch structured read failures. Add idempotent late-provider discovery with stale-connection/disconnect guards and reactive mobile guidance, while retaining transaction and pending-recovery behavior. Restore compact, always-visible Factory identity/finality warnings; contain the hero decoration and explain Factory/direct creation accurately. Preserve the cards, desktop table, Proof Journey design and current contract addresses.

**Validation:** 577 tests/checks pass (124 wallet, 56 existing pages, 45 new read-only Chromium regressions, 199 app contract/simulator, 153 original contract). All seven rebuilt bundles match sources. Four targeted negative controls fail on the audited baseline and pass after correction. Chromium covers 390/768/1440px plus known/custom 360px embeds. No actual signatures, transactions, deployed contract changes, live Pages updates or network-finality assertions.

**Limits:** Actual mobile wallets/devices and live-network behavior remain unverified. No WalletConnect, contract/protocol changes or unrelated redesign. Review the request-generation guards, provider lifecycle and badge disclosure before merge; deployment requires separate explicit approval.

## Exact files changed

- `README.md`
- `docs/P1-P2-CORRECTNESS-REMEDIATION.md`
- `package.json`
- `tests/browser/correctness.test.mjs`
- `web/app.html`
- `web/app.js`
- `web/builder-ledger-polish.css`
- `web/builder-ledger-polish.js`
- `web/builder-ledger.css`
- `web/builder.js`
- `web/card.js`
- `web/deploy-factory.js`
- `web/diagnose.js`
- `web/mobile-wallet-help.js`
- `web/probe.js`
- `web/proof-journey.css`
- `web/site.css`
- `web/src/builder.js`
- `web/src/card.js`
- `web/src/deployfactory.js`
- `web/src/main.js`
- `web/src/provenance.js`
- `web/src/read-validation.js`
- `web/src/record.js`
- `web/src/wallet.js`
- `web/verification-workspace.js`
