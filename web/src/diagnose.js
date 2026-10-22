// Read-only diagnosis page: what the network says about an account's latest transactions and about the factory.
import { readClient, readOutcome } from "./wallet.js";
import { checksum } from "./record.js";
import { studionet } from "genlayer-js/chains";

const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const cfg = window.MO_CONFIG || {};
const factory = (q.get("factory") || cfg.FACTORY || "").trim();
const account = (q.get("account") || "").trim();
const isAddr = s => /^0x[0-9a-fA-F]{40}$/.test(s);
const safe = (o, n = 1500) => { try { return JSON.stringify(o, (k, v) => typeof v === "bigint" ? v.toString() : v).slice(0, n); } catch { return String(o).slice(0, n); } };
const lines = [];
const out = t => { lines.push(t); $("out").textContent = lines.join("\n"); };
const reader = readClient();
const RPC_URL = studionet.rpcUrls.default.http[0];
const rawRpc = async (method, params) => {
  const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message || safe(j.error)); return j.result;
};
// the node's accepted parameter shape differs between versions, so try the known ones and say which worked
async function listTxs(acc) {
  const tries = [[acc, "from"], [acc], [{ address: acc }], [{ address: acc, filter: "from" }]];
  const errs = [];
  for (const params of tries) {
    try { const res = await rawRpc("sim_getTransactionsForAddress", params); if (Array.isArray(res)) { out("(listing worked with " + safe(params.map(x => typeof x === "string" && x.startsWith("0x") ? "<addr>" : x), 120) + ")"); return res; } errs.push("non-array reply"); }
    catch (e) { errs.push(String(e.message || e).slice(0, 80)); }
  }
  throw new Error(errs.join(" | "));
}

async function txLine(hash, depth = 0) {
  const pad = "  ".repeat(depth);
  try {
    const tx = await reader.getTransaction({ hash });
    const trig = tx.triggered_transactions || tx.triggeredTransactions || tx.triggered || [];
    const o = readOutcome(tx);
    out(`${pad}tx ${hash}\n${pad}  status=${o.status} exec=${o.exec} vote=${o.vote} to=${tx.recipient ?? tx.to_address ?? tx.to ?? ""}\n${pad}  triggered=${safe(trig, 400)}`);
    if (depth >= 1 || q.get("trace") === "1") {
      try { out(`${pad}  trace: ${safe(await rawRpc("gen_dbg_traceTransaction", [{ txID: hash, round: 0 }]), 2500)}`); }
      catch (e) { out(`${pad}  trace unavailable: ${String(e.message || e).slice(0, 200)}`); }
    }
    if (depth < 2 && Array.isArray(trig)) for (const t of trig.slice(0, 4)) { const h = typeof t === "string" ? t : t?.hash || t?.tx_id; if (h) await txLine(h, depth + 1); }
  } catch (e) { out(`${pad}tx ${hash}: could not read (${e.message || e})`); }
}

async function run() {
  out("Reading from the network...");
  if (isAddr(factory)) {
    out("\n== Factory " + factory);
    try {
      out("info: " + await reader.readContract({ address: factory, functionName: "get_factory_info", args: [] }));
      const page = JSON.parse(await reader.readContract({ address: factory, functionName: "get_milestones_page", args: [0, 5] }));
      out("milestones listed: " + page.total);
      for (const it of page.items) {
        let st;
        try { const s = JSON.parse(await reader.readContract({ address: checksum(it.milestone), functionName: "get_state_json", args: [] })); st = "readable, phase " + s.phase; }
        catch (e) { st = "NOT readable: " + String(e.message || e).split("\n")[0].slice(0, 120); }
        out(`  #${it.index} ${it.milestone} "${it.title}" -> ${st}`);
      }
    } catch (e) { out("could not read the factory: " + (e.message || e)); }
  } else out("\n(no factory set)");
  if (isAddr(account)) {
    out("\n== Latest transactions sent by " + account);
    try {
      const rows = await listTxs(account);
      rows.sort((a, b) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0));
      out("found " + rows.length + " (newest first, showing 4)");
      for (const r of rows.slice(0, 4)) await txLine(r.hash || r.tx_id || r.id);
    } catch (e) { out("could not list transactions: " + (e.message || e)); }
  } else out("\n(open this page with ?account=0x... to list that account's latest transactions)");
  const one = (q.get("tx") || "").trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(one)) { out("\n== Transaction " + one); await txLine(one); }
  out("\nDone.");
}
$("copy").onclick = async () => { try { await navigator.clipboard.writeText($("out").textContent); $("copied").textContent = "Copied."; } catch { $("copied").textContent = "Select the text above and copy it."; } };
run();
