// Diagnostic page: deploys contracts/read_probe.py and tries three ways of reading another contract.
import { hasWallet, readClient, writeClient, connectWallet, ensureNetwork, sendAndConfirm } from "./wallet.js";
import { checksum } from "./record.js";

const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const TARGET = (q.get("target") || "0x42352FD9dB57BD25241C72E18E3E0bf19359e8A0").trim();
let account = null, wallet = null, probe = (q.get("probe") || "").trim(), code = "", busy = false;
const lines = [];
const out = t => { lines.push(t); $("out").textContent = lines.join("\n"); };
const say = (t, err = false) => { $("msg").className = "notice" + (err ? " err" : ""); $("msg").textContent = t; };
const short = e => String(e?.message || e).split("\n")[0].slice(0, 220);
const findAddress = tx => [tx?.txDataDecoded?.contractAddress, tx?.data?.contract_address, tx?.recipient, tx?.to_address].find(x => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x)) || null;
const sync = () => { const on = !!probe && !busy; for (const id of ["views", "wfinal", "wdefault", "wnonfinal"]) $(id).disabled = !on; $("deploy").disabled = busy || !account || !code; };

$("connect").onclick = async () => { try { account = await connectWallet(); wallet = writeClient(account); $("who").textContent = "Connected: " + account; sync(); } catch (e) { say(short(e), true); } };

$("deploy").onclick = async () => {
  busy = true; sync();
  try {
    await ensureNetwork(); say("Confirm the deployment in your wallet…");
    const o = await sendAndConfirm({ client: wallet, address: account, label: "deploy probe", build: () => wallet.deployContract({ code, args: [], leaderOnly: false }),
      onUpdate: u => { if (u.stage === "submitted") say("Sent. Tx " + u.hash + "\nWaiting for the network…"); } });
    if (o.kind !== "APPLIED") { say("Not deployed (" + o.kind + ") " + (o.message || "") + (o.hash ? "\nTx " + o.hash : ""), true); return; }
    probe = checksum(findAddress(o.tx) || ""); say("Probe deployed at " + probe + "\nNow press button 2."); out("probe " + probe);
  } catch (e) { say("Did not start: " + short(e), true); } finally { busy = false; sync(); }
};

$("views").onclick = async () => {
  busy = true; sync(); out("\n== instant reads of " + TARGET);
  const r = readClient();
  for (const mode of ["default", "final", "nonfinal"]) {
    const t0 = Date.now();
    try { const v = await r.readContract({ address: probe, functionName: "read_view", args: [TARGET, mode] }); out(`${mode}: OK in ${Date.now() - t0} ms: ${String(v).slice(0, 90)}`); }
    catch (e) { out(`${mode}: ERROR after ${Date.now() - t0} ms: ${short(e)}`); }
  }
  out("done"); busy = false; sync();
};

for (const mode of ["final", "default", "nonfinal"]) $("w" + mode).onclick = async () => {
  busy = true; sync(); out(`\n== write test (${mode}) started ${new Date().toISOString()}`);
  try {
    await ensureNetwork(); say("Confirm the transaction in your wallet…");
    const o = await sendAndConfirm({ client: wallet, address: account, label: "probe " + mode, timeoutMs: 12 * 60 * 1000,
      build: () => wallet.writeContract({ address: probe, functionName: "read_write", args: [TARGET, mode], value: 0n }),
      onUpdate: u => { if (u.stage === "submitted") say("Sent. Tx " + u.hash + "\nWaiting (up to 12 minutes)…"); } });
    out(`${mode} write: ${o.kind} status=${o.status || ""} exec=${o.exec || ""} ${o.hash || ""}`); say("Write test finished: " + o.kind, o.kind !== "APPLIED");
  } catch (e) { out(`${mode} write: ${short(e)}`); say(short(e), true); } finally { busy = false; sync(); }
};

$("copy").onclick = async () => { try { await navigator.clipboard.writeText($("out").textContent); say("Report copied."); } catch { say("Select the report text and copy it."); } };
if (!hasWallet()) say("No browser wallet found.", true);
fetch("../contracts/read_probe.py", { cache: "no-store" }).then(r => r.text()).then(t => { code = t; sync(); }).catch(e => say("Could not load the probe source: " + short(e), true));
if (probe) out("probe " + probe);
sync();
