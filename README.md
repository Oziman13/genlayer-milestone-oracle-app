# Milestone Oracle: web client

Wallet-based web client for the Milestone Oracle Intelligent Contract. The contract, its 153 tests and its
mutation evidence live in https://github.com/Oziman13/genlayer-milestone-oracle ; `contracts/milestone_oracle.py`
here is the same file, kept so the page can deploy a new milestone from its own repository.

Page: https://oziman13.github.io/genlayer-milestone-oracle-app/web/ (open with `?address=0x...` for a deployed instance).

## What the contract does (short)

A funder names a builder, a deadline and up to four public checks (GitHub release, repo file, live page,
model-read deliverable). Validators re-check the facts, the reading is provisional for a challenge window, the
builder may amend only WHERE a failing check is looked up, and anyone can finalize after the window. It holds no
funds; a finalized verdict is an attestation readable with `get_attestation()`.

## What this client does


`web/index.html` (landing), `web/app.html` + `web/app.js` (the wallet app), `web/builder.html` + `web/builder.js` (read-only delivery record for a builder; `?builder=0x..&factory=0x..`, `&badge=1` for an embeddable view), `web/card.html` + `web/card.js` (shareable verdict card, `?address=0x..`; only a FINALIZED MET/NOT_MET gets a stamp), `web/deploy-factory.html` (one-time page that deploys the factory from the wallet and checks its code hash against the shown source), `web/skill.md` (agent instructions), `web/config.js` (factory address; empty until a factory is deployed, and pages then say so instead of showing sample data). Old `?address=` links on `index.html` redirect to `app.html`. The wallet app is (bundled from `web/src/*.js` with genlayer-js 1.1.8). Reads are account-less.
Every write is signed by the user's own browser wallet (MetaMask or any EIP-1193 wallet). The page never
creates, asks for or stores a private key.

* **Wallet**: connect, add/switch to the GenLayer Studio network (chain 61999), react to account and network changes.
* **Roles**: funder / builder / viewer is read from the contract state. Each button is enabled only when that
  account may do it in the current phase and time, and a line under it says why not (`web/src/logic.js`).
* **Transaction lifecycle**: a transaction counts as done only when the network status is FINALIZED and the
  contract call's execution result is a success. ACCEPTED is shown as "in progress". FINALIZED with an error
  result is reported as "the contract refused it", UNDETERMINED/CANCELED/timeouts as "not applied". If the wallet
  errors but the account's transaction count moved (or cannot be read), the transaction is treated as possibly
  sent. A user rejection is reported as "nothing was sent".
* **Ambiguous sends and reload recovery** (`web/src/wallet.js`, `web/src/recovery.js`): a pending record (account,
  chain, contract, action and arguments, account nonce before, a snapshot of the contract state) is written BEFORE
  the wallet is asked to sign and kept until the outcome is known (stage `signing`, `ambiguous` or `sent`). While a
  record is unresolved every send, including a new deployment, is locked and the "Unfinished transaction" card
  shows what is known. After a reload, or on "Check again", the page asks the Studio node for the account's
  transactions and matches them by account, contract, nonce and time. Exactly one match is followed to FINALIZED;
  several matches are listed and none is guessed; "not sent" is concluded only when the account's nonce did not
  move. If the node cannot list transactions the nonce decides, and an unresolved case stays blocked until it is
  checked ("I checked: it was not sent" releases it manually). Reload recovery loads the contract recorded in the
  transaction, and a deployed address is adopted only from a FINALIZED + successful receipt.
* **Setup workflow**: "Create a new milestone" validates the form (builder differs from the funder, date, window,
  1 to 4 uniquely named checks), fetches `contracts/milestone_oracle.py` from this repository, sends the deploy
  through the wallet, and only after FINALIZED + success adopts the new contract address and shows a share link.
* **Remembers the last milestone**: the address you loaded is kept in localStorage, so reloading the page keeps it
  (an address in the link always wins). Storage that is blocked is ignored.
* **Tests**: `tests/browser/wallet_flow.test.mjs` runs the page in Chromium against a mock EIP-1193 wallet and a
  mock Studio RPC (107 checks, output in `evidence/browser-tests-v0.3.txt`; `evidence/browser-tests.txt` is the earlier 80-check run): wallet connect, roles, the start_round, assess,
  amend and finalize paths, the transaction lifecycle, the ambiguous-send and reload-recovery cases above, deploy
  adoption and remembered address. They prove the page's logic, not real MetaMask or real Studionet behaviour.
  Mutations of the lifecycle and of the recovery lock are caught by them.
* **Run the tests** (Node 20+): `npm ci`, then `npx playwright-core install chromium`, then `npm test`
  (set `CHROMIUM_PATH` to use an existing Chromium). `npm run build` rebuilds `web/app.js` from `web/src`.

## Live run of the factory and the delivery record (Studionet, 2026-10-22)

* Factory `0x123352e162Fa441Ba1C4252662A7d00EC05fb737` (v0.1.1, deployed from the page, code hash verified by the page).
* A milestone created through it, `0xDf63AB2C788c452e5E0088E6767Fe78e6e93ce30`, was run start, assess (3 of 3 checks PASS),
  finalize (MET) and then recorded; the builder page shows 1 on the record, 1 MET. Details and timestamps:
  `evidence/factory-live-run-studionet.txt`. Two Studio test accounts of one person (funder and builder), so this shows the
  mechanics, not an independent attestation.
* Why v0.1.1: v0.1.0 read the milestone with the "latest final" state, which did not answer on Studionet (the record
  transaction ended LEADER_TIMEOUT twice). A small probe contract showed the default and non-final reads answer in about
  1.5 s while the final read timed out; v0.1.1 uses the default read. See `evidence/read-probe-studionet.txt`.
  Because it trusts the milestone's own FINALIZED phase, not the network's finality of the state read, a record is only as
  final as the network's accepted state.
* Addresses: Studionet looks a contract up by its EIP-55 (mixed-case) address, the factory stores lower-case ones, so the
  pages convert every address before reading or linking. A lower-case address typed by hand is converted too.

## Limits

* Tests use a mock wallet and mock Studio RPC; they do not prove real MetaMask or Studionet behaviour.
* A real Studionet run through this page (deploy, start, assess, finalize with MetaMask) is recorded in the contract
  repository: https://github.com/Oziman13/genlayer-milestone-oracle/blob/main/evidence/live-run-1.txt
  Demo instance: https://oziman13.github.io/genlayer-milestone-oracle-app/web/?address=0xDf63AB2C788c452e5E0088E6767Fe78e6e93ce30
  (two Studio test accounts of one person, so it shows the mechanics, not an independent attestation).
* The recovery paths (ambiguous send, reload while signing, several matching transactions) were exercised with mocks
  only. The shape of the node's per-account transaction listing (`sim_getTransactionsForAddress`) was not verified
  live; the page normalises it defensively and falls back to the nonce check.
* Not exercised live: builder amendment, NOT_MET and INCONCLUSIVE verdicts (covered by the contract's direct tests).
* A milestone verdict says the stated public checks hold, not that the work is good (see the contract's limitations).

## Tests

`npm test` runs `tests/browser/wallet_flow.test.mjs` (107 checks, wallet app incl. factory create, record and factory deploy flows) and `tests/browser/pages.test.mjs` (42 checks: landing, builder, verdict card pages and record helpers) against a mock wallet and a mock Studio RPC. They do not prove real MetaMask or real Studionet behaviour. Build with `npm run build`.

Contract tests (Python, `genlayer-test`): `python3 -m pytest tests/direct` runs 159 direct-mode tests for the Milestone Oracle v0.2.0 contract and for the factory's funder argument (`evidence/contract-direct-tests.txt`), and `python3 -m pytest tests/glsim` runs 21 integration tests of `MilestoneFactory` and `record()` on a local 5-validator network (`evidence/contract-glsim-tests.txt`). The Studionet evidence is in `evidence/factory-deploy-studionet.txt`, `evidence/factory-live-run-studionet.txt` and `evidence/read-probe-studionet.txt` (why v0.1.1 reads with the default view).
