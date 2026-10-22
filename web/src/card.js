import { readClient, EXPLORER } from "./wallet.js";
import { cardView, validAddress, checksum } from "./record.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const q = new URLSearchParams(location.search);
const address = checksum(q.get("address") || "");
const cfg = window.MO_CONFIG || {};
const factory = (q.get("factory") || cfg.FACTORY || "").trim();
const short = a => a ? a.slice(0, 8) + "…" + a.slice(-4) : "";
const utc = t => t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "-";
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
const fail = (html, err = true) => { $("card").innerHTML = `<div class="notice${err ? " err" : ""}">${html}</div>`; };

async function main() {
  if (!validAddress(address)) return fail("Open this page with <code>?address=0x…</code> of a milestone contract.", false);
  const reader = readClient();
  const call = (fn, args = [], to = address) => reader.readContract({ address: to, functionName: fn, args });
  let state, att, hist = [];
  try {
    state = parse(await call("get_state_json"));
    att = await call("get_attestation");
    for (let i = 0; i < Math.min(Number(state?.history_count) || 0, 30); i++) hist.push(parse(await call("get_history_json", [i])));
  } catch (e) { return fail("Could not read the milestone: " + esc(e.message || e)); }
  const v = cardView(state, att);
  if (!v) return fail("The contract returned something this page cannot read.");
  const last = hist.filter(Boolean).pop();
  let recorded = "";
  if (validAddress(factory) && v.stamp) {
    try {
      const mine = await call("is_factory_milestone", [address], factory);
      recorded = mine ? ((await call("get_record", [address], factory)) !== "NONE" ? "yes" : "no") : "not-factory";
    } catch { recorded = ""; }
  }
  const recLine = { yes: `On the delivery record. <a href="builder.html?builder=${esc(v.builder)}&factory=${esc(factory)}">See the builder's record</a>.`,
    no: "Not on the delivery record yet.", "not-factory": "Created outside the factory, so it cannot be on the delivery record." }[recorded] || "";
  const rows = v.checks.map(c => `<div class="row"><span>${esc(c.id)}</span><span class="small">${esc(c.kind)}</span><span class="tag ${esc(c.result || "NONE")}">${esc(c.result || "not checked")}</span></div>`).join("");
  document.title = (v.stamp ? v.stamp + ": " : "") + v.title + " | Milestone Oracle";
  $("card").innerHTML = `<figure class="slip" style="margin:0;transform:none">
    ${v.stamp ? `<span class="stamp ${esc(v.stamp)}">${esc(v.stamp)}</span>` : ""}
    <h3 style="padding-right:${v.stamp ? 130 : 0}px">${esc(v.title)}</h3>
    <div class="meta">Deadline: end of ${esc(v.deadline)} (UTC)</div>
    ${rows}
    <div class="row"><span>Builder</span><span></span><code>${esc(short(v.builder))}</code></div>
    <div class="row"><span>Funder</span><span></span><code>${esc(short(v.funder))}</code></div>
    <div class="row"><span>Round</span><span></span><span>${v.round}</span></div>
    <div class="row"><span>Amendments used</span><span></span><span>${v.amendments} of 3</span></div>
    ${last ? `<div class="row"><span>Last event</span><span class="small">${esc(last.action)}</span><time>${esc(utc(last.timestamp))}</time></div>` : ""}
    <p class="meta" style="margin:12px 0 0">${esc(v.note)}${recLine ? " " + recLine : ""}</p>
  </figure>
  <p class="notice" style="margin-top:16px">A verdict says the stated public checks held (MET) or did not (NOT_MET). It does not say the work is good. A file check reads the file as it is now, not as of the deadline.</p>
  <div class="btns"><a class="btn alt" href="app.html?address=${esc(address)}${validAddress(factory) ? "&factory=" + esc(factory) : ""}">Open the full history</a>${EXPLORER ? `<a class="btn alt" href="${esc(EXPLORER)}/address/${esc(address)}">View on the explorer</a>` : ""}<button class="btn" id="copy" type="button">Copy this link</button></div>
  <div class="small" id="copied" aria-live="polite" style="margin-top:8px"></div>`;
  $("copy").onclick = async () => {
    const link = location.origin + location.pathname + "?address=" + address + (q.get("factory") ? "&factory=" + factory : "");
    try { await navigator.clipboard.writeText(link); $("copied").textContent = "Link copied."; } catch { $("copied").textContent = link; }
  };
}
main();
