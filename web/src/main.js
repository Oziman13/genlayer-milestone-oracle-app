import {
  walletProvider, refreshWalletProvider, hasWallet, readClient, writeClient, connectWallet, ensureNetwork, currentNetworkOk, watchWallet,
  sendAndConfirm, watchTx, loadPending, clearPending, savePending, readNonce, listAccountTxs, CHAIN_ID_HEX, EXPLORER,
} from "./wallet.js";
import { computeActions, validateSetup, roleOf, snapshotOf, effectSeen } from "./logic.js";
import { nextStep } from "./recovery.js";
import { validAddress, recordState, checksum } from "./record.js";

import { validReadState, validHistoryRow } from "./read-validation.js";
import { showProvenance } from "./provenance.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const utc = t => t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 19) : "-";
const short = a => a ? String(a).slice(0, 8) + "..." + String(a).slice(-4) : "";
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
const badge = (el, v) => { el.textContent = v; el.className = "badge " + v; };
const nowSec = () => Math.floor(Date.now() / 1000);

const cfg = window.MO_CONFIG || {};
const factory = checksum((new URLSearchParams(location.search).get("factory") || cfg.FACTORY || "").trim());
showProvenance(factory);
const useFactory = validAddress(factory);   // with a factory, new milestones are created (and recorded) through it

$("setup-explanation").textContent = useFactory
  ? `Creates a milestone through Factory ${factory}, which deploys its stored Oracle source. Your wallet signs the Factory call; the connected account becomes the funder and the builder must differ. Consult the Factory provenance warning before using a custom address.`
  : "Deploys a new contract using Oracle source fetched from this repository. Your wallet signs the deployment; the connected account becomes the funder and the builder must differ.";

const POLL = Number(new URLSearchParams(location.search).get("poll")) || undefined; // test hook: faster polling
const reader = readClient();
let accountRevision = 0;
let address = null;      // connected wallet
let wallet = null;       // write client for that wallet
let state = null;
let busy = false;
let loadGeneration = 0, loadedAddress = null, loading = false, recordCanRecord = false;

const LAST = "mo_last_address";   // remembered so a page reload keeps the milestone you were looking at
const lastAddr = () => { try { return localStorage.getItem(LAST) || ""; } catch { return ""; } };
$("addr").value = new URLSearchParams(location.search).get("address") || lastAddr();
if (cfg.LIVE_EXAMPLE) $("examplelink").href = "app.html?address=" + cfg.LIVE_EXAMPLE + (useFactory ? "&factory=" + factory : "");

function say(text, err = false) { const m = $("txmsg"); m.className = "msg" + (err ? " err" : ""); m.textContent = text; }
const txLink = h => EXPLORER ? `\nExplorer: ${EXPLORER}/tx/${h}` : "";

// ---------- wallet ----------
function renderWallet() {
  const pill = $("rolepill");
  $("walletbar").classList.toggle("on", !!address);
  if (!address) {
    $("wstatus").textContent = hasWallet() ? "Not connected." : "No browser wallet found.";
    $("connect").textContent = "Connect wallet"; pill.hidden = true;
  } else {
    $("wstatus").textContent = "Connected: " + address;
    $("connect").textContent = "Reconnect";
    const role = roleOf(state, address);
    if (role === "builder") { const d = document.querySelector("details.amend"); if (d) d.open = true; }   // the builder is the one who may amend
    pill.hidden = false;
    pill.textContent = state ? "role: " + role : "no milestone loaded";
    pill.className = "badge " + (role === "funder" || role === "builder" ? "PASS" : "NONE");
  }
  renderActions();
}

async function doConnect() {
  const w = $("wmsg"); w.className = "msg"; w.textContent = "";
  refreshWalletProvider();
  const p = walletProvider(), revision = accountRevision;
  try {
    const connected = await connectWallet();
    if (walletProvider() !== p || (revision !== accountRevision && address?.toLowerCase() !== connected.toLowerCase())) throw new Error("Wallet account changed; reconnect.");
    address = connected;
    wallet = writeClient(address);
    renderWallet();
  } catch (e) {
    w.className = "msg err"; w.textContent = e.message || String(e);
  }
}
$("connect").onclick = doConnect;
watchWallet({
  onProvider: () => { accountRevision++; address = null; wallet = null; $("wmsg").textContent = ""; renderWallet(); },
  onDisconnect: () => { accountRevision++; address = null; wallet = null; $("wmsg").className = "msg err"; $("wmsg").textContent = "Wallet disconnected. Reconnect before sending."; renderWallet(); },
  onAccounts: a => { accountRevision++; address = Array.isArray(a) && validAddress(a[0]) ? a[0] : null; wallet = address ? writeClient(address) : null; renderWallet(); },
  onChain: c => { const ok = String(c).toLowerCase() === CHAIN_ID_HEX; $("wmsg").className = ok ? "msg" : "msg err"; $("wmsg").textContent = ok ? "" : "Wrong network: switch the wallet to GenLayer Studio before sending."; },
});

// ---------- rendering ----------
function target(c) {
  if (c.kind === "GITHUB_RELEASE") return `${c.repo} release ${c.tag}`;
  if (c.kind === "REPO_FILE") return `${c.repo}@${c.ref}: ${c.path} contains "${c.phrase}"`;
  if (c.kind === "LIVE_PAGE") return `${c.url} answers 200 and contains "${c.phrase}"`;
  return `${c.url} shows: ${c.claim}`;
}

// An unfinished transaction (no final outcome yet) blocks every send until it is reconciled, so a
// second copy of a possibly-broadcast transaction cannot be sent by mistake.
function blockedReason() {
  const p = loadPending();
  if (!p) return "";
  if (p.stage === "created-unresolved") return "Creation succeeded; child identity is unresolved. Save the transaction before unlocking sending.";
  if (p.stage === "sent") return `Waiting for the earlier ${p.label} transaction to finish.`;
  return `An earlier ${p.label} may have been sent. Reconcile it in "Unfinished transaction" first.`;
}
function renderActions() {
  const sel = $("acheck").value;
  const a = computeActions(hasLoadedSelection() ? state : null, address, nowSec(), sel);
  const block = blockedReason();
  const map = { start: "b_start", assess: "b_assess", finalize: "b_fin", amend: "b_amend" };
  for (const k of Object.keys(map)) {
    const okNow = a[k].ok && !block;
    $(map[k]).disabled = busy || !okNow;
    $("r_" + k).textContent = okNow ? "" : (a[k].ok ? block : a[k].reason);
  }
  $("s_deploy").disabled = busy || !!block;
  if ($("b_record")) $("b_record").disabled = busy || !!block || !address || !hasLoadedSelection() || !recordCanRecord;
  renderRecovery();
}
function renderRecovery() {
  const p = loadPending();
  const show = !!p && !busy;
  $("recovery").hidden = !show;
  if (!show) return;
  $("recdismiss").hidden = !!p.hash && p.stage !== "created-unresolved";
  $("recdismiss").textContent = p.stage === "created-unresolved" ? "I saved the creation transaction; unlock sending" : "I checked: it was not sent";
  if (!$("recmsg").dataset.keep) $("recmsg").textContent = describePending(p);
}
function describePending(p) {
  if (p.stage === "created-unresolved") return `Creation succeeded. Child address is not verified.\nFactory: ${p.address}\nTx ${p.hash}\nDo not repeat this creation. Inspect the transaction in the explorer; acknowledge only after saving its identity.`;
  return `Action: ${p.label}${p.args && p.args.length ? " (" + p.args.join(", ") + ")" : ""}\nAccount: ${p.account}\nNetwork: chain ${p.chainId}\nContract: ${p.address || "(new deployment)"}\nAccount transaction count before sending: ${p.nonceBefore ?? "unknown"}\n` +
    (p.stage === "signing" ? "The page closed or reloaded while the wallet was being asked to sign. The transaction may or may not have been broadcast."
      : p.stage === "sent" ? `The transaction was sent (Tx ${p.hash}) but its final outcome is not known yet.`
      : "The wallet reported an error after the account's transaction count moved, so it may have been broadcast.");
}
$("acheck").onchange = renderActions;

function hasLoadedSelection() {
  return !!state && !loading && !!loadedAddress && validAddress($("addr").value) &&
    checksum($("addr").value).toLowerCase() === loadedAddress.toLowerCase();
}
function clearLoadedContract() {
  state = null; loadedAddress = null; recordCanRecord = false;
  $("app").hidden = true; $("recordbox").hidden = true;
  document.body.classList.remove("loaded"); $("emptyhint").hidden = false;
  $("txtop").appendChild($("txsheet"));
}
function selectedContext() {
  if (!hasLoadedSelection()) return null;
  const a = loadedAddress, generation = loadGeneration, st = state;
  return { address: a, valid: () => hasLoadedSelection() && loadGeneration === generation && state === st && loadedAddress === a };
}
$("addr").addEventListener("input", () => {
  loadGeneration++; loading = false; clearLoadedContract(); renderWallet();
  $("loadmsg").className = "small"; $("loadmsg").textContent = "Load the selected contract before acting.";
});
async function view(fn, args = [], to = loadedAddress) {
  return await reader.readContract({ address: to, functionName: fn, args });
}
async function load() {
  const generation = ++loadGeneration;
  const msg = $("loadmsg"), rawAddress = $("addr").value.trim();
  loading = false; clearLoadedContract(); renderWallet();
  if (!validAddress(rawAddress)) { msg.className = "small err"; msg.textContent = "Enter a valid contract address: 0x followed by 40 hex characters."; return false; }
  const requested = checksum(rawAddress);
  const current = () => generation === loadGeneration && $("addr").value.trim().toLowerCase() === requested.toLowerCase();
  loading = true; msg.className = "small"; msg.textContent = "Loading...";
  try {
    const st = parse(await view("get_state_json", [], requested));
    if (!current()) return false;
    if (!validReadState(st)) throw new Error("Unexpected or malformed milestone state.");
    const attestation = await view("get_attestation", [], requested);
    if (!current()) return false;
    if (typeof attestation !== "string") throw new Error("Malformed milestone attestation.");
    const history = [];
    for (let i = 0; i < st.history_count; i++) {
      const row = parse(await view("get_history_json", [i], requested));
      if (!current()) return false;
      if (!validHistoryRow(row)) throw new Error("Malformed milestone history row.");
      history.push(row);
    }
    // Commit completed reads only while their address/generation still wins.
    if (!current()) return false;
    state = st; loadedAddress = requested; loading = false;
    $("setup").hidden = true;
    $("app").hidden = false;
    $("title").textContent = st.title;
    $("cardlink").href = "card.html?address=" + requested + (useFactory ? "&factory=" + factory : "");
    $("deadline").textContent = `Deadline: end of ${st.deadline_date} (UTC)`;
    badge($("verdict"), st.latest_verdict || "NONE");
    $("att").textContent = attestation || "NONE";
    $("checks").innerHTML = st.checks.map(c => {
      const r = (st.latest_results || {})[c.id];
      return `<div class="crow"><b>${esc(c.id)}</b><span class="chip">${esc(c.kind)}</span><span class="what">${esc(target(c))}</span>${r ? `<span class="badge ${esc(r)}">${esc(r)}</span>` : '<span class="small">not read yet</span>'}</div>`;
    }).join("");
    const prev = $("acheck").value;
    $("acheck").innerHTML = st.checks.map(c => `<option value="${esc(c.id)}">${esc(c.id)} (${esc(c.kind)})</option>`).join("");
    if (prev && st.checks.some(c => c.id === prev)) $("acheck").value = prev;
    $("round").textContent = st.round;
    badge($("phase"), st.phase);
    $("cand").textContent = st.candidate || "NONE";
    const left = st.window_end ? st.window_end - nowSec() : 0;
    $("window").textContent = st.window_end
      ? utc(st.window_end) + (st.phase === "PROVISIONAL" ? (left > 0 ? ` (in ${Math.ceil(left / 60)} min)` : " (passed, can be finalized)") : "")
      : "-";
    $("amends").textContent = `${st.amendments} of 3`;
    $("funder").textContent = st.funder;
    $("builder").textContent = st.builder;
    const rows = [];
    for (let i = 0; i < history.length; i++) {
      const r = history[i];
      rows.push(r
        ? `<li${r.action === "FINALIZE" ? ' class="final"' : ""}><span class="tdot"></span><b>${esc(r.action)}</b> <span class="badge ${esc(r.verdict)}">${esc(r.verdict)}</span><div class="when">${esc(utc(r.timestamp))} UTC · ${esc(short(r.caller))}</div>${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}</li>`
        : `<li><span class="tdot"></span>Row ${i}: unreadable</li>`);
    }
    $("hist").innerHTML = rows.join("") || '<li class="empty">No history yet</li>';
    document.body.classList.add("loaded"); $("emptyhint").hidden = true; $("txside").appendChild($("txsheet"));
    msg.textContent = "Loaded.";
    try { localStorage.setItem(LAST, rawAddress); } catch { /* storage may be blocked */ }
    renderWallet();
    await refreshRecordBox(generation, requested, st);
    return current();
  } catch (e) {
    if (!current()) return false;
    loading = false; clearLoadedContract(); renderWallet();
    msg.textContent = "Could not read the contract: " + (e.message || e);
    msg.className = "small err";
    return false;
  }
}
// ---------- delivery record ----------
async function refreshRecordBox(generation = loadGeneration, a = loadedAddress, st = state) {
  const box = $("recordbox");
  const current = () => generation === loadGeneration && state === st && loadedAddress === a && hasLoadedSelection();
  if (!useFactory || !current()) return;
  let made = false, rec = "NONE";
  try {
    made = await reader.readContract({ address: factory, functionName: "is_factory_milestone", args: [a] });
    if (!current()) return;
    if (typeof made !== "boolean") throw new Error("Malformed factory membership response.");
    if (made) rec = await reader.readContract({ address: factory, functionName: "get_record", args: [a] });
    if (!current()) return;
    if (typeof rec !== "string") throw new Error("Malformed delivery record response.");
  } catch {
    if (!current()) return;
    recordCanRecord = false; box.hidden = false;
    $("recmsg2").textContent = "Could not read the delivery record right now.";
    $("b_record").hidden = true; $("recordlink").hidden = true;
    return;
  }
  const v = recordState(made, st, rec);
  recordCanRecord = v.canRecord;
  box.hidden = false; $("recmsg2").textContent = v.text;
  $("b_record").hidden = !v.canRecord;
  const link = $("recordlink"); link.hidden = !v.recorded;
  link.href = `builder.html?builder=${st.builder}&factory=${factory}`;
  renderActions();
}
$("b_record").onclick = async () => {
  const context = selectedContext();
  if (!context || !recordCanRecord) return;
  const a = context.address;
  const o = await guard("record", w => w.writeContract({ address: factory, functionName: "record", args: [a], value: 0n }), { fn: "record", args: [a], address: factory }, context);
  if (o && context.valid() && ["APPLIED", "REJECTED_BY_CONTRACT", "NOT_APPLIED", "UNCLEAR"].includes(o.kind)) await refreshRecordBox();
};

$("load").onclick = load;
$("refresh").onclick = load;

// ---------- sending ----------
function describe(o, fn, hash) {
  const t = hash ? txLink(hash) : "";
  switch (o.kind) {
    case "APPLIED": return { text: `${fn} was applied: the transaction is FINALIZED and the contract call succeeded.${t}`, err: false };
    case "REJECTED_BY_CONTRACT": return { text: `${fn} was FINALIZED but the contract refused it (wrong caller, wrong phase, or window still open). State was not changed.${t}`, err: true };
    case "NOT_APPLIED": return { text: `${fn} was not applied (network status ${o.status}${o.vote ? ", vote " + o.vote : ""}). State was not changed.${t}`, err: true };
    case "UNCLEAR": return { text: `${fn} is FINALIZED but its execution result is unreadable (${o.exec || "empty"}). Check the explorer before repeating it.${t}`, err: true };
    case "STILL_PENDING": return { text: `${fn} is still not final after waiting. It may yet apply. Reload this page to keep watching, and do not resend yet.${t}`, err: true };
    case "REJECTED_BY_USER": return { text: o.message, err: false };
    case "AMBIGUOUS": return { text: o.message, err: true };
    case "NOT_SENT": return { text: o.message, err: true };
    default: return { text: `${fn}: ${o.kind}`, err: true };
  }
}

function progress(fn) {
  return u => {
    if (u.stage === "submitted") say(`${fn} sent. Tx ${u.hash}\nWaiting for the network to finalize it (can take several minutes)...${txLink(u.hash)}`);
    else if (u.stage === "status") say(`${fn}: network status ${u.status || "pending"}${u.exec ? ", execution " + u.exec : ""}.\nTx ${u.hash}`);
    else if (u.stage === "network-hiccup") say(`${fn}: lost contact with the network (${u.failures}x), still trying.\nTx ${u.hash}`);
  };
}

async function guard(fn, build, remember, context = null) {
  if (busy || blockedReason() || (context && !context.valid())) return null;
  if (!wallet || !address) { say("Connect a wallet first.", true); return null; }
  const sendingAccount = address, sendingWallet = wallet;
  busy = true; renderActions();
  try {
    await ensureNetwork();
    if (address !== sendingAccount || wallet !== sendingWallet) throw new Error("Wallet account changed; reconnect before sending.");
    if (context && !context.valid()) throw new Error("The selected contract changed; load it before acting.");
    say(`Confirm ${fn} in your wallet...`);
    const o = await sendAndConfirm({ client: sendingWallet, address: sendingAccount, build: async () => {
      if (!await currentNetworkOk() || address !== sendingAccount || wallet !== sendingWallet) throw new Error("Wallet changed before signing; reconnect.");
      if (context && !context.valid()) throw new Error("The selected contract changed before signing.");
      return build(sendingWallet);
    }, onUpdate: progress(fn), label: fn, remember, pollMs: POLL });
    const d = describe(o, fn, o.hash);
    say(d.text, d.err);
    return o;
  } catch (e) {
    say(`${fn} did not start: ` + (e.message || e), true);
    return null;
  } finally {
    busy = false;
    renderActions();
  }
}

async function sendCall(fn, args) {
  const context = selectedContext();
  if (!context) { say("Load the selected contract before acting.", true); return; }
  const action = { start_round: "start", assess: "assess", finalize: "finalize", amend: "amend" }[fn];
  const eligibility = computeActions(state, address, nowSec(), $("acheck").value)[action];
  if (!eligibility?.ok) { say(eligibility?.reason || "Action unavailable.", true); return; }
  const addr = context.address;
  const o = await guard(fn, w => w.writeContract({ address: addr, functionName: fn, args, value: 0n }), { fn, args, address: addr, snapshot: snapshotOf(state) }, context);
  if (o && ["APPLIED", "REJECTED_BY_CONTRACT", "NOT_APPLIED", "UNCLEAR"].includes(o.kind)) await load();
  renderActions();
}

$("b_start").onclick = () => sendCall("start_round", []);
$("b_assess").onclick = () => sendCall("assess", []);
$("b_fin").onclick = () => sendCall("finalize", []);
$("b_amend").onclick = () => {
  const id = $("acheck").value, t = $("atarget").value.trim(), n = $("anote").value.trim();
  if (!id || !t || n.length < 3) { say("Pick a check, give a new target and a short note.", true); return; }
  sendCall("amend", [id, t, n]);
};

// ---------- setup / deploy ----------
const FIELDS = {
  GITHUB_RELEASE: [["repo", "owner/repo"], ["tag", "release tag, e.g. v0.1.0"]],
  REPO_FILE: [["repo", "owner/repo"], ["ref", "branch or tag, e.g. main"], ["path", "file path, e.g. README.md"], ["phrase", "phrase the file must contain"]],
  LIVE_PAGE: [["url", "https:// page URL"], ["phrase", "phrase the page must contain"]],
  DELIVERABLE: [["url", "https:// page URL"], ["claim", "claim the page must support (20+ characters)"]],
};
function addCheckRow(kind = "GITHUB_RELEASE") {
  const box = document.createElement("div"); box.className = "chk";
  const idx = $("s_checks").children.length + 1;
  box.innerHTML = `<input class="c_id" value="c${idx}" aria-label="Check id"><select class="c_kind" aria-label="Check kind">${Object.keys(FIELDS).map(k => `<option ${k === kind ? "selected" : ""}>${k}</option>`).join("")}</select><div class="c_f"></div><button class="ghost c_rm" type="button">Remove</button>`;
  const fill = () => { box.querySelector(".c_f").innerHTML = FIELDS[box.querySelector(".c_kind").value].map(([k, p]) => `<input data-k="${k}" placeholder="${p}" aria-label="${p}">`).join(""); };
  box.querySelector(".c_kind").onchange = fill; fill();
  box.querySelector(".c_rm").onclick = () => box.remove();
  $("s_checks").appendChild(box);
}
function readChecks() {
  return [...$("s_checks").children].map(b => {
    const o = { id: b.querySelector(".c_id").value.trim(), kind: b.querySelector(".c_kind").value };
    b.querySelectorAll("[data-k]").forEach(i => { o[i.dataset.k] = i.value.trim(); });
    return o;
  });
}
$("newms").onclick = () => { $("setup").hidden = false; if (!$("s_checks").children.length) addCheckRow(); renderWallet(); };
$("s_add").onclick = () => { if ($("s_checks").children.length < 4) addCheckRow(); };

function findAddress(tx) {
  const c = [tx?.txDataDecoded?.contractAddress, tx?.data?.contract_address, tx?.recipient, tx?.to_address];
  return c.find(x => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x)) || null;
}

$("s_deploy").onclick = async () => {
  const form = { builder: $("s_builder").value.trim(), title: $("s_title").value, deadline: $("s_deadline").value.trim(), window: Number($("s_window").value), checks: readChecks() };
  const errs = validateSetup(form, address);
  if (!address) errs.unshift("Connect a wallet first (the connected account becomes the funder).");
  $("s_errs").textContent = errs.join("\n");
  if (errs.length) return;
  if (useFactory) {
    const args = [form.builder.toLowerCase(), form.title.trim(), form.deadline, JSON.stringify(form.checks), form.window];
    const o = await guard("create_milestone", w => w.writeContract({ address: factory, functionName: "create_milestone", args, value: 0n }),
      { fn: "create_milestone", args: [form.builder, form.title.trim(), form.deadline], address: factory, meta: { builder: form.builder.toLowerCase(), title: form.title.trim() } });
    if (o && o.kind === "APPLIED") await adoptCreated(loadPending());
    renderActions();
    return;
  }
  let code;
  try {
    const r = await fetch("../contracts/milestone_oracle.py", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    code = await r.text();
    if (!code.includes("class MilestoneOracle")) throw new Error("unexpected file content");
  } catch (e) { $("s_errs").textContent = "Could not fetch the contract source: " + (e.message || e); return; }
  const args = [form.builder, form.title.trim(), form.deadline, JSON.stringify(form.checks), form.window];
  const o = await guard("deploy", w => w.deployContract({ code, args, leaderOnly: false }), { fn: "deploy", args: [form.title.trim()] });
  if (o && o.kind === "APPLIED") await adoptDeployed(o);
  renderActions();
};

// No verified transaction-specific child-return schema is established for Studionet.
// Never infer identity from a list, recency, title, or the current URL's factory.
async function adoptCreated(p) {
  if (!p?.hash) return;
  savePending({ ...p, stage: "created-unresolved" });
  loadGeneration++; loading = false; loadedAddress = null; recordCanRecord = false;
  state = null; $("addr").value = ""; $("app").hidden = true; $("recordbox").hidden = true;
  document.body.classList.remove("loaded"); $("emptyhint").hidden = false;
  $("txtop").appendChild($("txsheet"));
  say(`The milestone was created, but its child address cannot be verified from transaction-specific information supported by this page. No address was adopted.
Factory: ${p.address}
Tx ${p.hash}${txLink(p.hash)}
Do not repeat creation. Inspect this transaction in the explorer, save its identity, and manually load the child only after verifying its provenance. Factory list matches are not proof.`, true);
  renderActions();
}

// A deployment's address is adopted only from a FINALIZED, successful transaction.
async function adoptDeployed(o) {
  const a = findAddress(o.tx);
  if (a) { $("addr").value = a; await load(); say(`Milestone deployed at ${a}.\nShare this link: ${location.origin}${location.pathname}?address=${a}`); }
  else say("Deployment finalized, but the page could not read the new contract address from the receipt. Find it in the Studio explorer under this transaction and paste it into the Contract box.", true);
}

// ---------- resume / reconcile an interrupted transaction ----------
const explorerAccount = acc => EXPLORER ? `\nAccount history: ${EXPLORER}/address/${acc}` : "";

async function finishWatch(p, hash) {
  const o = await watchTx(reader, hash, { onUpdate: progress(p.label), pollMs: POLL });
  if (!["STILL_PENDING", "UNCLEAR"].includes(o.kind) && !(p.fn === "create_milestone" && o.kind === "APPLIED")) clearPending();
  const d = describe(o, p.label, hash);
  say(d.text, d.err);
  if (p.fn === "deploy" && o.kind === "APPLIED") await adoptDeployed(o);
  else if (p.fn === "create_milestone" && o.kind === "APPLIED" && p.meta) await adoptCreated({ ...p, hash });
  else if (p.fn === "record" && $("addr").value) { await load(); }
  else if ($("addr").value && p.fn !== "create_milestone") await load();
  return o;
}

async function reconcile(p) {
  const rm = $("recmsg"); rm.dataset.keep = "1";
  rm.textContent = describePending(p) + "\n\nLooking for the transaction...";
  let listing = null;
  try { listing = await listAccountTxs(p.account, "from"); } catch { listing = null; }
  const nonceNow = await readNonce(reader, p.account);
  const step = nextStep(p, { listing, nonceNow });
  if (step.kind === "WATCH") {
    rm.textContent = describePending(p) + `\n\nFound it: ${step.hash}. Watching it now...`;
    savePending({ ...p, stage: "sent", hash: step.hash });
    delete rm.dataset.keep; renderActions();
    return await finishWatch(p, step.hash);
  }
  if (step.kind === "NOT_SENT") {
    clearPending(); delete rm.dataset.keep;
    say(`The earlier ${p.label} was not sent: the account's transaction count did not move (${nonceNow}). It is safe to try again.`);
    renderActions();
    return { kind: "NOT_SENT" };
  }
  // unresolved: say exactly why, show what to check, keep sends blocked
  let hint = "";
  if (state && p.snapshot && p.address && p.address.toLowerCase() === $("addr").value.trim().toLowerCase()) {
    const seen = effectSeen(p.fn, p.args || [], p.snapshot, snapshotOf(state));
    if (seen === true) hint = `\nThe contract's current state already shows the effect of ${p.label}, so it probably went through.`;
    if (seen === false) hint = `\nThe contract's current state does not show the effect of ${p.label} yet.`;
  }
  const why = { SEVERAL: "Several transactions from this account could match:\n" + (step.hashes || []).map(h => `${h}${EXPLORER ? "  " + EXPLORER + "/tx/" + h : ""}`).join("\n"),
    NO_NONCE: "The account's transaction count could not be read.",
    NONCE_MOVED_NO_MATCH: `The account's transaction count moved (${p.nonceBefore} to ${nonceNow}) but no matching transaction is listed (yet).`,
    NONCE_MOVED_NO_LIST: `The account's transaction count moved (${p.nonceBefore} to ${nonceNow}) and the node could not list the account's transactions.` }[step.reason];
  rm.textContent = describePending(p) + `\n\nNot resolved: ${why}${hint}${explorerAccount(p.account)}\nIt stays blocked from being repeated. Press "Check again" later, or if you checked the explorer and it is not there, press "I checked: it was not sent".`;
  say(`The earlier ${p.label} is not resolved yet; sending is blocked until it is.`, true);
  renderActions();
  return { kind: "UNRESOLVED" };
}

async function resume() {
  const p = loadPending();
  if (!p) return;
  // reload recovery works on the contract the transaction was sent to, not whatever the box held
  if (p.fn !== "create_milestone" && p.fn !== "record" && p.address && $("addr").value.trim().toLowerCase() !== p.address.toLowerCase()) { $("addr").value = p.address; await load(); }
  if (p.account && address && address.toLowerCase() !== p.account.toLowerCase()) say(`Note: this transaction was sent from ${p.account}, but the connected account is ${address}.`);
  busy = true; renderActions();
  try {
    if (p.hash) {
      say(`Found an earlier transaction (${p.label}) that was still open when this page closed.\nTx ${p.hash}\nWatching it now...`);
      await finishWatch(p, p.hash);
    } else {
      await reconcile(p);
    }
  } finally { busy = false; renderActions(); }
}
$("recheck").onclick = async () => { const p = loadPending(); if (!p || busy) return; busy = true; renderActions(); try { if (p.hash) await finishWatch(p, p.hash); else await reconcile(p); } finally { busy = false; renderActions(); } };
$("recdismiss").onclick = () => {
  const p = loadPending(); if (!p) return;
  clearPending(); delete $("recmsg").dataset.keep;
  if (p.stage === "created-unresolved") { say(`Creation transaction ${p.hash} acknowledged. No child address has been verified; do not repeat this creation.`); renderActions(); return; }
  say(`Marked the earlier ${p.label} as not sent. Sending is possible again; make sure it really is not in the explorer.`);
  renderActions();
};

setInterval(() => { if (state && !busy) renderActions(); }, 5000); // deadlines pass without any click
renderWallet();
if (!hasWallet()) { $("wmsg").className = "msg err"; $("wmsg").textContent = "No browser wallet detected. You can still read any milestone; to act you need MetaMask or another EIP-1193 wallet."; }
(async () => { if ($("addr").value) await load(); await resume(); })();
