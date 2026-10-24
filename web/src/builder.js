import { readClient, EXPLORER } from "./wallet.js";
import { summaryView, validAddress, checksum } from "./record.js";

import { showProvenance } from "./provenance.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const q = new URLSearchParams(location.search);
const cfg = window.MO_CONFIG || {};
const factory = checksum((q.get("factory") || cfg.FACTORY || "").trim());
const badgeMode = q.get("badge") === "1";
if (badgeMode) document.body.classList.add("badge");
$("builder").value = q.get("builder") || "";

const utc = t => t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "-";
showProvenance(factory);
const short = a => a ? a.slice(0, 8) + "…" + a.slice(-4) : "";

let lookupGeneration = 0;
$("builder").addEventListener("input", () => { lookupGeneration++; show("Enter a builder address and inspect its record."); });

function show(html, cls = "notice") { $("out").innerHTML = `<div class="${cls}">${html}</div>`; }

async function lookup() {
  const generation = ++lookupGeneration;
  const b = $("builder").value.trim();
  const current = () => generation === lookupGeneration && $("builder").value.trim().toLowerCase() === b.toLowerCase();
  if (!validAddress(b)) return show("Enter the builder's address: 0x followed by 40 hex characters.", "notice err");
  if (!validAddress(factory)) return show("No factory is set for this page yet, so there is no record to read. Add <code>?factory=0x…</code> to the link, or wait for the deployed factory to be added to the page settings.");
  show("Reading the record…");
  try {
    const raw = await readClient().readContract({ address: factory, functionName: "get_builder_summary", args: [b.toLowerCase()] });
    if (!current()) return;
    const v = summaryView(raw);
    if (v && (!validAddress(v.builder) || v.builder.toLowerCase() !== b.toLowerCase())) throw new Error("The returned builder does not match the requested address.");
    if (!v) return show("The factory returned something this page cannot read.", "notice err");
    const href = new URL("app.html", location.href);
    const rows = v.rows.map(r => `<tr><td><a href="${esc(href.pathname + "?address=" + checksum(r.milestone) + "&factory=" + factory)}">${esc(r.title)}</a></td><td><span class="tag ${esc(r.verdict)}">${esc(r.verdict)}</span></td><td>${esc(utc(r.finalized_at))}</td><td>${r.amendments}</td><td class="mono">${esc(short(r.funder))}</td></tr>`).join("");
    if (!v.recorded) {
      return show(`<b class="mono">${esc(short(v.builder))}</b> has ${v.created ? v.created + " milestone" + (v.created > 1 ? "s" : "") + " that " + (v.created > 1 ? "are" : "is") + " not on the record yet. A milestone is added once it is finalized and someone records it." : "no milestones from this factory."}`);
    }
    $("out").innerHTML = `<div class="sheet"><h2 class="mono" style="font-size:20px">${esc(short(v.builder))}</h2>
      <div class="counts"><div><b>${v.recorded}</b><span>${badgeMode ? "recorded" : "on the record"}</span></div><div><b class="MET">${v.met}</b><span>MET</span></div><div><b class="NOT_MET">${v.not_met}</b><span>NOT_MET</span></div><div><b>${v.with_amendments}</b><span>${badgeMode ? "amended" : "with an amendment"}</span></div></div>
      <table><thead><tr><th>Milestone</th><th>Verdict</th><th>Finalized</th><th>Amendments</th><th>Funder</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="notice" style="margin-top:14px">Counts only milestones created through this factory and recorded after they were finalized. Each line links to the milestone with its checks and history.${v.created > v.recorded ? " " + (v.created - v.recorded) + " more " + (v.created - v.recorded > 1 ? "are" : "is") + " not finalized or not recorded yet." : ""}</p></div>
      <details><summary>Embed this record</summary><pre>${esc(`<iframe src="${new URL("builder.html", location.href).href}?builder=${v.builder}${factory ? "&factory=" + factory : ""}&badge=1" width="360" height="150" style="border:0" title="Delivery record"></iframe>`)}</pre></details>`;
  } catch (e) {
    if (current()) show("Could not read the factory record: " + esc(e.message || e), "notice err");
  }
}
$("go").onclick = lookup;
$("builder").onkeydown = e => { if (e.key === "Enter") lookup(); };
if (cfg.EXAMPLE_BUILDER && !$("builder").value) { $("exwrap").hidden = false; $("exlink").href = "builder.html?builder=" + cfg.EXAMPLE_BUILDER; }
if (EXPLORER) $("explorer").href = EXPLORER;
if ($("builder").value) lookup();
