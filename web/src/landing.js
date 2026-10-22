// Reads the example milestone straight from Studionet (no wallet) and fills the slip on the landing page.
// If the read fails the page keeps the labelled snapshot that is already in the HTML.
import { readClient } from "./wallet.js";
import { validAddress, checksum } from "./record.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
const hhmm = t => new Date(t * 1000).toISOString().slice(11, 19);
const day = t => new Date(t * 1000).toISOString().slice(0, 10);
const LABEL = { START: "Round started", ASSESS: "Checks read by validators", FINALIZE: "Challenge window over, verdict finalized", AMEND: "Builder moved where a check looks" };

async function main() {
  const addr = (window.MO_CONFIG || {}).LIVE_EXAMPLE || "";
  if (!validAddress(addr)) return;
  const a = checksum(addr), reader = readClient();
  const call = (fn, args = []) => reader.readContract({ address: a, functionName: fn, args });
  const st = parse(await call("get_state_json"));
  if (!st || !Array.isArray(st.checks) || !st.checks.length) return;
  const rows = [];
  for (let i = 0; i < Math.min(Number(st.history_count) || 0, 12); i++) { const r = parse(await call("get_history_json", [i])); if (r) rows.push(r); }
  if (!rows.length) return;
  const verdict = st.phase === "FINALIZED" ? st.final_verdict : (st.latest_verdict || "NONE");
  const res = st.latest_results || {};
  const pass = st.checks.filter(c => res[c.id] === "PASS").length;
  const slip = document.getElementById("slip");
  slip.querySelector(".stamp").className = "stamp " + esc(verdict);
  slip.querySelector(".stamp").textContent = verdict === "NONE" ? "OPEN" : verdict;
  document.getElementById("slipmeta").textContent = `Studionet, ${day(rows[0].timestamp)}. Funder and builder were two of our own test accounts.`;
  document.getElementById("sliprows").innerHTML = rows.map(r => {
    const tag = r.action === "ASSESS" ? `${pass} of ${st.checks.length} PASS` : r.action === "FINALIZE" ? "FINAL" : r.action;
    const cls = r.action === "FINALIZE" ? "FINALIZED" : r.action === "ASSESS" ? (r.verdict || "NONE") : "NONE";
    return `<div class="row"><time>${hhmm(r.timestamp)}</time><span>${esc(LABEL[r.action] || r.action)}</span><span class="tag ${esc(cls)}">${esc(tag)}</span></div>`;
  }).join("");
  document.getElementById("slipchecks").innerHTML = st.checks.map(c => `<span class="pill ${esc(res[c.id] || "NONE")}">${esc(c.id)}: ${esc(res[c.id] || "not read")}</span>`).join("");
  document.getElementById("slipaddr").textContent = a.slice(0, 6) + "…" + a.slice(-4);
  const live = document.getElementById("live"); live.classList.add("on"); live.lastChild.textContent = " Read live from Studionet just now";
}
main().catch(() => { /* keep the snapshot */ });
