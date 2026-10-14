import {
  hasWallet, readClient, writeClient, connectWallet, ensureNetwork, currentNetworkOk, watchWallet,
  sendAndConfirm, watchTx, loadPending, clearPending, savePending, EXPLORER,
} from "./wallet.js";
import { computeActions, validateSetup, roleOf } from "./logic.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const utc = t => t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 19) : "-";
const short = a => a ? String(a).slice(0, 8) + "..." + String(a).slice(-4) : "";
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
const badge = (el, v) => { el.textContent = v; el.className = "badge " + v; };
const nowSec = () => Math.floor(Date.now() / 1000);

const POLL = Number(new URLSearchParams(location.search).get("poll")) || undefined; // test hook: faster polling
const reader = readClient();
let address = null;      // connected wallet
let wallet = null;       // write client for that wallet
let state = null;
let busy = false;

$("addr").value = new URLSearchParams(location.search).get("address") || "";

function say(text, err = false) { const m = $("txmsg"); m.className = "msg" + (err ? " err" : ""); m.textContent = text; }
const txLink = h => EXPLORER ? `\nExplorer: ${EXPLORER}/tx/${h}` : "";

// ---------- wallet ----------
function renderWallet() {
  const pill = $("rolepill");
  if (!address) {
    $("wstatus").textContent = hasWallet() ? "Not connected." : "No browser wallet found.";
    $("connect").textContent = "Connect wallet"; pill.hidden = true;
  } else {
    $("wstatus").textContent = "Connected: " + address;
    $("connect").textContent = "Reconnect";
    const role = roleOf(state, address);
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

function renderActions() {
  const sel = $("acheck").value;
  const a = computeActions(state, address, nowSec(), sel);
  const map = { start: "b_start", assess: "b_assess", finalize: "b_fin", amend: "b_amend" };
  for (const k of Object.keys(map)) {
    $(map[k]).disabled = busy || !a[k].ok;
    $("r_" + k).textContent = a[k].ok ? "" : a[k].reason;
  }
}
$("acheck").onchange = renderActions;

async function view(fn, args = []) {
  return await reader.readContract({ address: $("addr").value.trim(), functionName: fn, args });
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
    $("deadline").textContent = `Deadline: end of ${st.deadline_date} (UTC)`;
    badge($("verdict"), st.latest_verdict || "NONE");
    $("att").textContent = (await view("get_attestation")) || "NONE";
    $("checks").innerHTML = st.checks.map(c => {
      const r = (st.latest_results || {})[c.id];
      return `<tr><td>${esc(c.id)}</td><td>${esc(c.kind)}</td><td>${esc(target(c))}</td><td>${r ? `<span class="badge ${esc(r)}">${esc(r)}</span>` : "-"}</td></tr>`;
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
        ? `<tr><td>${i}</td><td>${esc(utc(r.timestamp))}</td><td>${esc(r.action)}</td><td>${esc(r.verdict)}</td><td>${esc(r.note || "")}</td><td>${esc(short(r.caller))}</td></tr>`
        : `<tr><td>${i}</td><td colspan="5">unreadable row</td></tr>`);
    }
    $("hist").innerHTML = rows.join("") || '<tr><td colspan="6">No history yet</td></tr>';
    msg.textContent = "Loaded.";
    renderWallet();
  } catch (e) {
    msg.textContent = "Could not read the contract: " + (e.message || e);
    msg.className = "small err";
  }
}
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
  const addr = $("addr").value.trim();
  const o = await guard(fn, () => wallet.writeContract({ address: addr, functionName: fn, args, value: 0n }), { fn, address: addr });
  if (o && ["APPLIED", "REJECTED_BY_CONTRACT", "NOT_APPLIED", "UNCLEAR"].includes(o.kind)) await load();
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
  let code;
  try {
    const r = await fetch("../contracts/milestone_oracle.py", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    code = await r.text();
    if (!code.includes("class MilestoneOracle")) throw new Error("unexpected file content");
  } catch (e) { $("s_errs").textContent = "Could not fetch the contract source: " + (e.message || e); return; }
  const args = [form.builder, form.title.trim(), form.deadline, JSON.stringify(form.checks), form.window];
  const o = await guard("deploy", () => wallet.deployContract({ code, args, leaderOnly: false }), { fn: "deploy" });
  if (o && o.kind === "APPLIED") {
    const a = findAddress(o.tx);
    if (a) { $("addr").value = a; await load(); say(`Milestone deployed at ${a}.\nShare this link: ${location.origin}${location.pathname}?address=${a}`); }
    else say("Deployment finalized, but the page could not read the new contract address from the receipt. Find it in the Studio explorer under this transaction and paste it into the Contract box.", true);
  }
};

// ---------- resume an interrupted transaction ----------
async function resume() {
  const p = loadPending();
  if (!p || !p.hash) return;
  say(`Found an earlier transaction (${p.label}) that was still open when this page closed.\nTx ${p.hash}\nWatching it now...`);
  const o = await watchTx(reader, p.hash, { onUpdate: progress(p.label), pollMs: POLL });
  if (o.kind !== "STILL_PENDING") clearPending();
  const d = describe(o, p.label, p.hash);
  say(d.text, d.err);
  if (p.address && !$("addr").value) $("addr").value = p.address;
  if ($("addr").value) await load();
}

setInterval(() => { if (state && !busy) renderActions(); }, 5000); // deadlines pass without any click
renderWallet();
if (!hasWallet()) { $("wmsg").className = "msg err"; $("wmsg").textContent = "No browser wallet detected. You can still read any milestone; to act you need MetaMask or another EIP-1193 wallet."; }
if ($("addr").value) load();
resume();
