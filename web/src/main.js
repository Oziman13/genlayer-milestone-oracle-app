import {
  hasWallet, readClient, writeClient, connectWallet, ensureNetwork, currentNetworkOk, watchWallet,
  sendAndConfirm, watchTx, loadPending, clearPending, savePending, readNonce, listAccountTxs, EXPLORER,
} from "./wallet.js";
import { computeActions, validateSetup, roleOf, snapshotOf, effectSeen } from "./logic.js";
import { nextStep } from "./recovery.js";
import { pickCreated, validAddress, recordState, checksum } from "./record.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const utc = t => t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 19) : "-";
const short = a => a ? String(a).slice(0, 8) + "..." + String(a).slice(-4) : "";
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
const badge = (el, v) => { el.textContent = v; el.className = "badge " + v; };
const nowSec = () => Math.floor(Date.now() / 1000);

const cfg = window.MO_CONFIG || {};
const factory = (new URLSearchParams(location.search).get("factory") || cfg.FACTORY || "").trim();
const useFactory = validAddress(factory);   // with a factory, new milestones are created (and recorded) through it

const POLL = Number(new URLSearchParams(location.search).get("poll")) || undefined; // test hook: faster polling
const reader = readClient();
let address = null;      // connected wallet
let wallet = null;       // write client for that wallet
let state = null;
let busy = false;

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
  try {
    address = await connectWallet();
    wallet = writeClient(address);
    renderWallet();
  } catch (e) {
    w.className = "msg err"; w.textContent = e.message || String(e);
  }
}
$("connect").onclick = doConnect;
watchWallet({
  onAccounts: a => { address = a && a[0] ? a[0] : null; wallet = address ? writeClient(address) : null; renderWallet(); },
  onChain: async () => { const ok = await currentNetworkOk(); $("wmsg").className = ok ? "msg" : "msg err"; $("wmsg").textContent = ok ? "" : "Wrong network: switch the wallet to GenLayer Studio before sending."; },
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
  if (p.stage === "sent") return `Waiting for the earlier ${p.label} transaction to finish.`;
  return `An earlier ${p.label} may have been sent. Reconcile it in "Unfinished transaction" first.`;
}
function renderActions() {
  const sel = $("acheck").value;
  const a = computeActions(state, address, nowSec(), sel);
  const block = blockedReason();
  const map = { start: "b_start", assess: "b_assess", finalize: "b_fin", amend: "b_amend" };
  for (const k of Object.keys(map)) {
    const okNow = a[k].ok && !block;
    $(map[k]).disabled = busy || !okNow;
    $("r_" + k).textContent = okNow ? "" : (a[k].ok ? block : a[k].reason);
  }
  $("s_deploy").disabled = busy || !!block;
  if ($("b_record")) $("b_record").disabled = busy || !!block || !address;
  renderRecovery();
}
function renderRecovery() {
  const p = loadPending();
  const show = !!p && !busy;
  $("recovery").hidden = !show;
  if (!show) return;
  $("recdismiss").hidden = !!p.hash;
  if (!$("recmsg").dataset.keep) $("recmsg").textContent = describePending(p);
}
function describePending(p) {
  return `Action: ${p.label}${p.args && p.args.length ? " (" + p.args.join(", ") + ")" : ""}\nAccount: ${p.account}\nNetwork: chain ${p.chainId}\nContract: ${p.address || "(new deployment)"}\nAccount transaction count before sending: ${p.nonceBefore ?? "unknown"}\n` +
    (p.stage === "signing" ? "The page closed or reloaded while the wallet was being asked to sign. The transaction may or may not have been broadcast."
      : p.stage === "sent" ? `The transaction was sent (Tx ${p.hash}) but its final outcome is not known yet.`
      : "The wallet reported an error after the account's transaction count moved, so it may have been broadcast.");
}
$("acheck").onchange = renderActions;

async function view(fn, args = []) {
  return await reader.readContract({ address: checksum($("addr").value), functionName: fn, args });
}

async function load() {
  const msg = $("loadmsg");
  if (!$("addr").value.trim()) { msg.className = "small"; msg.textContent = "Enter a contract address."; return; }
  msg.className = "small"; msg.textContent = "Loading...";
  try {
    const st = parse(await view("get_state_json"));
    if (!st || !Array.isArray(st.checks)) throw new Error("Unexpected response from contract");
    state = st;
    $("setup").hidden = true;
    $("app").hidden = false;
    $("title").textContent = st.title;
    $("cardlink").href = "card.html?address=" + checksum($("addr").value) + (useFactory ? "&factory=" + factory : "");
    $("deadline").textContent = `Deadline: end of ${st.deadline_date} (UTC)`;
    badge($("verdict"), st.latest_verdict || "NONE");
    $("att").textContent = (await view("get_attestation")) || "NONE";
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
    for (let i = 0; i < st.history_count; i++) {
      const r = parse(await view("get_history_json", [i]));
      rows.push(r
        ? `<li${r.action === "FINALIZE" ? ' class="final"' : ""}><span class="tdot"></span><b>${esc(r.action)}</b> <span class="badge ${esc(r.verdict)}">${esc(r.verdict)}</span><div class="when">${esc(utc(r.timestamp))} UTC · ${esc(short(r.caller))}</div>${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}</li>`
        : `<li><span class="tdot"></span>Row ${i}: unreadable</li>`);
    }
    $("hist").innerHTML = rows.join("") || '<li class="empty">No history yet</li>';
    $("emptyhint").hidden = true; $("txside").appendChild($("txsheet"));
    msg.textContent = "Loaded.";
    try { localStorage.setItem(LAST, $("addr").value.trim()); } catch { /* storage may be blocked */ }
    renderWallet();
    await refreshRecordBox();
    return true;
  } catch (e) {
    // never leave the previous milestone on screen under a new address
    state = null; $("app").hidden = true; $("recordbox").hidden = true; $("emptyhint").hidden = false; $("txtop").appendChild($("txsheet")); renderWallet();
    msg.textContent = "Could not read the contract: " + (e.message || e);
    msg.className = "small err";
    return false;
  }
}
// ---------- delivery record ----------
async function refreshRecordBox() {
  const box = $("recordbox");
  if (!useFactory || !state) { box.hidden = true; return; }
  let made = false, rec = "NONE";
  try {
    const a = checksum($("addr").value);
    made = await reader.readContract({ address: factory, functionName: "is_factory_milestone", args: [a] });
    if (made) rec = await reader.readContract({ address: factory, functionName: "get_record", args: [a] });
  } catch { box.hidden = false; $("recmsg2").textContent = "Could not read the delivery record right now."; $("b_record").hidden = true; return; }
  const v = recordState(made, state, rec);
  box.hidden = false;
  $("recmsg2").textContent = v.text;
  $("b_record").hidden = !v.canRecord;
  $("b_record").disabled = busy || !!blockedReason() || !address;
  const link = $("recordlink"); link.hidden = !v.recorded;
  link.href = `builder.html?builder=${state.builder}&factory=${factory}`;
}
$("b_record").onclick = async () => {
  const a = checksum($("addr").value);
  const o = await guard("record", () => wallet.writeContract({ address: factory, functionName: "record", args: [a], value: 0n }), { fn: "record", args: [a], address: factory });
  if (o && ["APPLIED", "REJECTED_BY_CONTRACT", "NOT_APPLIED", "UNCLEAR"].includes(o.kind)) await refreshRecordBox();
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

async function guard(fn, build, remember) {
  if (!wallet || !address) { say("Connect a wallet first.", true); return null; }
  busy = true; renderActions();
  try {
    await ensureNetwork();
    say(`Confirm ${fn} in your wallet...`);
    const o = await sendAndConfirm({ client: wallet, address, build, onUpdate: progress(fn), label: fn, remember, pollMs: POLL });
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
  const addr = checksum($("addr").value);
  const o = await guard(fn, () => wallet.writeContract({ address: addr, functionName: fn, args, value: 0n }), { fn, args, address: addr, snapshot: snapshotOf(state) });
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
    const o = await guard("create_milestone", () => wallet.writeContract({ address: factory, functionName: "create_milestone", args, value: 0n }),
      { fn: "create_milestone", args: [form.builder, form.title.trim(), form.deadline], address: factory, meta: { builder: form.builder.toLowerCase(), title: form.title.trim() } });
    if (o && o.kind === "APPLIED") await adoptCreated({ account: address, meta: { builder: form.builder.toLowerCase(), title: form.title.trim() } });
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
  const o = await guard("deploy", () => wallet.deployContract({ code, args, leaderOnly: false }), { fn: "deploy", args: [form.title.trim()] });
  if (o && o.kind === "APPLIED") await adoptDeployed(o);
  renderActions();
};

// A factory milestone's address is found by reading the factory's own list and matching funder, builder and
// title, newest first. It is adopted only after the create transaction is FINALIZED and successful.
async function adoptCreated(p) {
  try {
    const total = Number(JSON.parse(await reader.readContract({ address: factory, functionName: "get_milestones_page", args: [0, 1] })).total);
    const offset = Math.max(0, total - 50);
    const page = JSON.parse(await reader.readContract({ address: factory, functionName: "get_milestones_page", args: [offset, 50] }));
    const hit = pickCreated(page.items, p.account, p.meta.builder, p.meta.title);
    if (!hit) throw new Error("not listed yet");
    $("addr").value = checksum(hit);
    // a contract deployed by another contract becomes readable a little after the creating transaction: wait for it
    let loaded = false;
    for (let i = 0; i < 18 && !loaded; i++) {
      if (i) { say(`Milestone created at ${hit}. Waiting for the new contract to become readable (${i}/18)...`); await new Promise(r => setTimeout(r, POLL || 5000)); }
      loaded = await load();
    }
    const link = `${location.origin}${location.pathname}?address=${checksum(hit)}${new URLSearchParams(location.search).get("factory") ? "&factory=" + factory : ""}`;
    if (loaded) say(`Milestone created at ${checksum(hit)} through the factory.\nShare this link: ${link}`);
    else say(`Milestone created at ${hit}, but its state is not readable yet, so nothing is shown. Press "Load state" again in a minute.\nLink: ${link}`, true);
  } catch (e) {
    say("The milestone was created, but this page could not find its address in the factory list (" + (e.message || e) + "). Open the factory's milestone list in the explorer and paste the address into the Contract box.", true);
  }
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
  if (o.kind !== "STILL_PENDING") clearPending();
  const d = describe(o, p.label, hash);
  say(d.text, d.err);
  if (p.fn === "deploy" && o.kind === "APPLIED") await adoptDeployed(o);
  else if (p.fn === "create_milestone" && o.kind === "APPLIED" && p.meta) await adoptCreated(p);
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
  say(`Marked the earlier ${p.label} as not sent. Sending is possible again; make sure it really is not in the explorer.`);
  renderActions();
};

setInterval(() => { if (state && !busy) renderActions(); }, 5000); // deadlines pass without any click
renderWallet();
if (!hasWallet()) { $("wmsg").className = "msg err"; $("wmsg").textContent = "No browser wallet detected. You can still read any milestone; to act you need MetaMask or another EIP-1193 wallet."; }
(async () => { if ($("addr").value) await load(); await resume(); })();
