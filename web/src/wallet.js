// Shared wallet + transaction lifecycle for the GenLayer web clients in this repo.
// No private key is ever generated, stored or typed into a page: every signature comes from an
// injected EIP-1193 wallet (window.ethereum). Reads use an account-less client.
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

export const CHAIN_ID_HEX = "0x" + studionet.id.toString(16);
export const EXPLORER = studionet.blockExplorers?.default?.url || "";

export const walletProvider = () => {
  const p = typeof window !== "undefined" ? window.ethereum : undefined;
  return p && typeof p.request === "function" ? p : undefined;
};
const provider = walletProvider;
export const hasWallet = () => !!provider();

export const readClient = () => createClient({ chain: studionet });
export const writeClient = address => createClient({ chain: studionet, account: address, provider: provider() });

export class WalletError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const isUserRejection = e =>
  !!e && (e.code === 4001 || e.code === "ACTION_REJECTED" || /user (rejected|denied)|rejected the request/i.test(String(e.message || e)));

export async function ensureNetwork(p = refreshWalletProvider()) {
  if (!p) throw new WalletError("NO_WALLET", "No browser wallet found.");
  const current = await p.request({ method: "eth_chainId" });
  if (provider() !== p) throw new WalletError("PROVIDER_CHANGED", "Wallet provider changed; reconnect.");
  if (String(current).toLowerCase() === CHAIN_ID_HEX) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (e) {
    if (isUserRejection(e)) throw new WalletError("USER_REJECTED", "Switching to the GenLayer Studio network was declined.");
    // 4902 = chain not added yet (MetaMask); some wallets only say "unrecognized"
    if (e && (e.code === 4902 || /unrecognized|not added|add.*chain/i.test(String(e.message || e)))) {
      await p.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_ID_HEX,
          chainName: studionet.name,
          rpcUrls: studionet.rpcUrls.default.http,
          nativeCurrency: studionet.nativeCurrency,
          blockExplorerUrls: EXPLORER ? [EXPLORER] : undefined,
        }],
      });
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
    } else {
      throw e;
    }
  }
  const after = await p.request({ method: "eth_chainId" });
  if (provider() !== p) throw new WalletError("PROVIDER_CHANGED", "Wallet provider changed; reconnect.");
  if (String(after).toLowerCase() !== CHAIN_ID_HEX) throw new WalletError("WRONG_NETWORK", "The wallet is still on another network.");
}

export async function connectWallet() {
  if (!hasWallet()) throw new WalletError("NO_WALLET", "No browser wallet found. Install MetaMask (or another EIP-1193 wallet) and reload this page.");
  const p = refreshWalletProvider(), revision = walletRevision;
  let accounts;
  try {
    accounts = await p.request({ method: "eth_requestAccounts" });
  } catch (e) {
    if (isUserRejection(e)) throw new WalletError("USER_REJECTED", "The connection request was declined in the wallet.");
    throw e;
  }
  if (!Array.isArray(accounts) || !accounts.length) throw new WalletError("NO_ACCOUNT", "The wallet returned no account. Unlock it and try again.");
  if (provider() !== p) throw new WalletError("PROVIDER_CHANGED", "Wallet provider changed; reconnect.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(accounts[0])) throw new WalletError("NO_ACCOUNT", "The wallet returned an invalid account.");
  const unchanged = () => {
    if (provider() !== p || (revision !== walletRevision && activeAccounts?.[0]?.toLowerCase() !== accounts[0].toLowerCase()))
      throw new WalletError("PROVIDER_CHANGED", "Wallet changed during connection; reconnect.");
  };
  unchanged();
  await ensureNetwork(p);
  unchanged();
  return accounts[0];
}

export async function currentNetworkOk() {
  try {
    const p = refreshWalletProvider();
    const chain = await p.request({ method: "eth_chainId" });
    refreshWalletProvider();
    return provider() === p && String(chain).toLowerCase() === CHAIN_ID_HEX;
  } catch { return false; }
}

// One binding per provider object. Legacy providers without removeListener are safe:
// their handlers are ignored whenever that provider is no longer active.
const walletSubscribers = new Set();
const providerBindings = new WeakSet();
let activeProvider, providerMonitor;
let walletRevision = 0, activeAccounts = null;
const notifyWallet = (name, ...args) => { for (const s of walletSubscribers) s[name]?.(...args); };
export function refreshWalletProvider() {
  const p = provider();
  if (p === activeProvider) return p;
  activeProvider = p; walletRevision++; activeAccounts = null;
  if (p && typeof p.on === "function" && !providerBindings.has(p)) {
    providerBindings.add(p);
    const listen = (event, callback) => p.on(event, (...args) => { if (activeProvider === p && provider() === p) callback(...args); });
    listen("accountsChanged", a => { walletRevision++; activeAccounts = Array.isArray(a) ? a : null; notifyWallet("onAccounts", a); });
    listen("chainChanged", c => notifyWallet("onChain", c));
    listen("disconnect", e => { walletRevision++; activeAccounts = null; notifyWallet("onDisconnect", e); });
  }
  notifyWallet("onProvider", p);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("mo:providerchange"));
  return p;
}
export function watchWallet(callbacks) {
  walletSubscribers.add(callbacks);
  if (typeof window !== "undefined" && !providerMonitor) {
    window.addEventListener("ethereum#initialized", refreshWalletProvider);
    window.addEventListener("focus", refreshWalletProvider);
    window.addEventListener("pageshow", refreshWalletProvider);
    // Discovery only: never requests accounts, signatures or a chain switch.
    providerMonitor = setInterval(refreshWalletProvider, 500);
  }
  const previous = activeProvider;
  const p = refreshWalletProvider();
  if (previous === p) callbacks.onProvider?.(p);
  return () => {
    walletSubscribers.delete(callbacks);
    if (!walletSubscribers.size && providerMonitor) {
      clearInterval(providerMonitor); providerMonitor = undefined;
      window.removeEventListener("ethereum#initialized", refreshWalletProvider);
      window.removeEventListener("focus", refreshWalletProvider);
      window.removeEventListener("pageshow", refreshWalletProvider);
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Transaction lifecycle. A receipt of "ACCEPTED" is NOT success: validators agreeing on a result
// does not tell whether the contract call itself ran or reverted. We wait for FINALIZED, then read
// the execution result, and we keep the hash so an interrupted page can resume watching.
// ---------------------------------------------------------------------------------------------

const TERMINAL_BAD = ["CANCELED", "UNDETERMINED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"];
const GOOD_RESULT = ["AGREE", "MAJORITY_AGREE"];

export function readOutcome(tx) {
  const status = String(tx?.statusName ?? tx?.status_name ?? tx?.status ?? "");
  const leader = tx?.consensus_data?.leader_receipt;
  const receipt = Array.isArray(leader) ? leader[0] : leader;
  const exec = String(tx?.txExecutionResultName ?? receipt?.execution_result ?? "");
  const vote = String(tx?.resultName ?? "");
  return { status, exec, vote };
}

export function classify(tx) {
  const { status, exec, vote } = readOutcome(tx);
  if (TERMINAL_BAD.includes(status)) return { kind: "NOT_APPLIED", status, exec, vote };
  if (status !== "FINALIZED") return { kind: "PENDING", status, exec, vote };
  const failed = exec === "FINISHED_WITH_ERROR" || exec === "ERROR";
  const ok = exec === "FINISHED_WITH_RETURN" || exec === "SUCCESS";
  if (failed) return { kind: "REJECTED_BY_CONTRACT", status, exec, vote };
  if (ok && (vote === "" || GOOD_RESULT.includes(vote))) return { kind: "APPLIED", status, exec, vote };
  if (ok) return { kind: "NOT_APPLIED", status, exec, vote };
  return { kind: "UNCLEAR", status, exec, vote };
}

const PENDING_KEY = "mo_pending_tx";
let volatilePending = null;
export function savePending(info) {
  volatilePending = info;
  try { const raw = JSON.stringify(info); localStorage.setItem(PENDING_KEY, raw); return localStorage.getItem(PENDING_KEY) === raw; } catch { return false; }
}
export function loadPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "null") || volatilePending; } catch { return volatilePending; } }
export function clearPending() { volatilePending = null; try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } }

export async function watchTx(client, hash, { onUpdate, pollMs = 3000, timeoutMs = 15 * 60 * 1000, sleep } = {}) {
  const wait = sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const started = Date.now();
  let failures = 0;
  for (;;) {
    let tx = null;
    try {
      tx = await client.getTransaction({ hash });
      failures = 0;
    } catch (e) {
      failures += 1;
      onUpdate && onUpdate({ stage: "network-hiccup", hash, failures, error: String(e?.message || e) });
    }
    if (tx) {
      const c = classify(tx);
      onUpdate && onUpdate({ stage: "status", hash, ...c, tx });
      if (c.kind !== "PENDING") return { hash, ...c, tx };
    }
    if (Date.now() - started > timeoutMs) return { hash, kind: "STILL_PENDING", status: "unknown", exec: "", vote: "", tx };
    await wait(pollMs);
  }
}

// A "pending record" is written BEFORE the wallet is asked to sign, and kept until the outcome is
// known. It carries the account, network, contract, action, arguments and the account nonce at that
// moment, so a send that may have been broadcast (wallet error, closed tab, crash) can be located and
// reconciled after a reload before anything is sent again. stage: signing | ambiguous | sent.
const finite = n => Number.isFinite(n) ? n : null;

export async function readNonce(client, address) {
  try { return finite(Number(await client.getCurrentNonce({ address }))); } catch { return null; }
}

export async function sendAndConfirm({ client, address, build, onUpdate, label, pollMs, timeoutMs, sleep, remember }) {
  if (loadPending()) return { kind: "NOT_SENT", message: "An unfinished transaction blocks sending. Check it in the wallet app first." };
  const nonceBefore = await readNonce(client, address);
  const base = { label, ...remember, account: address, chainId: CHAIN_ID_HEX, nonceBefore, at: Date.now() };
  if (remember && !savePending({ ...base, stage: "signing" })) {
    clearPending();
    return { kind: "NOT_SENT", message: "The transaction was not sent: recovery storage is unavailable. Enable local storage before signing." };
  }
  let hash;
  try {
    hash = await build();
  } catch (e) {
    if (isUserRejection(e)) { clearPending(); return { kind: "REJECTED_BY_USER", message: "You declined the request in the wallet. Nothing was sent." }; }
    const nonceAfter = await readNonce(client, address);
    if (nonceBefore === null || nonceAfter === null) {
      remember && savePending({ ...base, stage: "ambiguous", nonceAfter });
      return { kind: "AMBIGUOUS", message: "The wallet reported an error and the account's transaction count could not be read, so the transaction may have been sent. It is blocked from being repeated until it is reconciled below.", error: String(e?.message || e) };
    }
    if (nonceAfter > nonceBefore) {
      remember && savePending({ ...base, stage: "ambiguous", nonceAfter });
      return { kind: "AMBIGUOUS", message: "The wallet reported an error, but the account's transaction count went up, so the transaction may have been sent. It is blocked from being repeated until it is reconciled below.", error: String(e?.message || e) };
    }
    clearPending();
    return { kind: "NOT_SENT", message: "The transaction was not sent: " + String(e?.message || e), error: String(e?.message || e) };
  }
  remember && savePending({ ...base, stage: "sent", hash });
  onUpdate && onUpdate({ stage: "submitted", hash });
  const outcome = await watchTx(client, hash, { onUpdate, pollMs, timeoutMs, sleep });
  if (!["STILL_PENDING", "UNCLEAR"].includes(outcome.kind) && !(remember?.fn === "create_milestone" && outcome.kind === "APPLIED")) clearPending();
  return outcome;
}

// ---- locate a transaction that may have been broadcast without a known hash ----------------------
// Uses the Studio node's per-account listing (sim_getTransactionsForAddress). The response shape is
// normalised defensively; if the node cannot answer, the caller falls back to the nonce check.
const RPC_URL = studionet.rpcUrls.default.http[0];
export async function listAccountTxs(account, filter = "from") {
  const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sim_getTransactionsForAddress", params: [account, filter] }) });
  const j = await r.json();
  if (j.error || !Array.isArray(j.result)) throw new Error(j.error?.message || "unexpected listing response");
  return j.result;
}
