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


`web/index.html` + `web/app.js` (bundled from `web/src/*.js` with genlayer-js 1.1.8). Reads are account-less.
Every write is signed by the user's own browser wallet (MetaMask or any EIP-1193 wallet). The page never
creates, asks for or stores a private key.

* **Wallet**: connect, add/switch to the GenLayer Studio network (chain 61999), react to account and network changes.
* **Roles**: funder / builder / viewer is read from the contract state. Each button is enabled only when that
  account may do it in the current phase and time, and a line under it says why not (`web/src/logic.js`).
* **Transaction lifecycle**: a transaction counts as done only when the network status is FINALIZED and the
  contract call's execution result is a success. ACCEPTED is shown as "in progress". FINALIZED with an error
  result is reported as "the contract refused it", UNDETERMINED/CANCELED/timeouts as "not applied". If the wallet
  errors but the account's transaction count moved, the page says the transaction may have been sent and
  discourages a blind resend. The hash of an open transaction is kept in localStorage, so reloading the page
  resumes watching it. A user rejection is reported as "nothing was sent".
* **Setup workflow**: "Create a new milestone" validates the form (builder differs from the funder, date, window,
  1 to 4 uniquely named checks), fetches `contracts/milestone_oracle.py` from this repository, sends the deploy
  through the wallet, and only after FINALIZED + success adopts the new contract address and shows a share link.
* **Tests**: `tests/browser/wallet_flow.test.mjs` runs the page in Chromium against a mock EIP-1193 wallet and a
  mock Studio RPC (44 checks, output in `evidence/browser-tests.txt`). They prove the page's logic, not real
  MetaMask or real Studionet behaviour. One lifecycle mutation (treating ACCEPTED as final) is caught by them.



## Limits

* Tests use a mock wallet and mock Studio RPC; they do not prove real MetaMask or Studionet behaviour. A live run
  is recorded in `evidence/` once done.
* A milestone verdict says the stated public checks hold, not that the work is good (see the contract's limitations).
