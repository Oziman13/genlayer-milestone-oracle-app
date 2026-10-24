import { getAddress } from "viem";
import { validChecks, validTimestamp } from "./read-validation.js";

// The network looks contracts up by their checksum spelling (mixed upper/lower case); an all-lowercase spelling is not found.
// The factory stores addresses in lowercase, so every page converts before it reads or writes.
export const checksum = a => { try { return getAddress(String(a).trim().toLowerCase()); } catch { return String(a ?? "").trim(); } };

// Pure helpers for the Delivery Record pages (no network, no DOM): easy to test.
export const validAddress = s => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s.trim());

// Turns the factory's get_builder_summary reply into something safe to draw, or null if it is not that shape.
export function summaryView(raw) {
  let o;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
  if (!o || typeof o !== "object" || !Array.isArray(o.milestones)) return null;
  if (o.milestones.some(r => r && validAddress(r.milestone) && ["MET", "NOT_MET"].includes(r.verdict) && !validTimestamp(r.finalized_at))) return null;
  const n = x => (Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
  const rows = o.milestones
    .filter(r => r && validAddress(r.milestone) && (r.verdict === "MET" || r.verdict === "NOT_MET"))
    .map(r => ({ milestone: r.milestone, title: String(r.title ?? ""), verdict: r.verdict, finalized_at: n(r.finalized_at), amendments: n(r.amendments), funder: String(r.funder ?? "") }));
  return { builder: String(o.builder ?? ""), created: n(o.created), recorded: rows.length, met: rows.filter(r => r.verdict === "MET").length,
    not_met: rows.filter(r => r.verdict === "NOT_MET").length, with_amendments: rows.filter(r => r.amendments > 0).length, rows };
}

// Legacy matching is deliberately disabled: funder/builder/title are not a transaction identity.
export function pickCreated() { return null; }

// What the record box should say for one milestone page.
export function recordState(isFactoryMilestone, state, recordRaw) {
  if (!isFactoryMilestone) return { text: "This milestone was not created through the factory, so it cannot be added to a delivery record.", canRecord: false, recorded: false };
  if (recordRaw && recordRaw !== "NONE") return { text: "On the delivery record.", canRecord: false, recorded: true };
  const done = state && state.finalized === 1 && state.phase === "FINALIZED" && (state.final_verdict === "MET" || state.final_verdict === "NOT_MET");
  if (!done) return { text: "Once this milestone is finalized with MET or NOT_MET, anyone can add it to the builder's delivery record.", canRecord: false, recorded: false };
  return { text: "Finalized. Anyone can add this verdict to the builder's delivery record; the factory reads it back from this contract.", canRecord: true, recorded: false };
}

// What the shareable verdict card shows. Only a FINALIZED MET/NOT_MET gets a verdict stamp; anything else is
// labelled as not final so a provisional reading can never be shared as a result.
export function cardView(state, attestation) {
  if (!state || !validChecks(state.checks)) return null;
  const final = state.finalized === 1 && state.phase === "FINALIZED";
  const att = attestation === "MET" || attestation === "NOT_MET" ? attestation : "";
  const verdict = final && (state.final_verdict === "MET" || state.final_verdict === "NOT_MET") ? state.final_verdict : "";
  const consistent = !verdict || !att || att === verdict;
  const note = verdict ? (consistent ? "Final verdict." : "The contract's attestation and final verdict disagree; check the contract.")
    : final ? "Finalized without a MET or NOT_MET result."
    : state.phase === "PROVISIONAL" ? "Not final: this is a provisional reading inside the challenge window."
    : "Not final yet: no verdict has been reached.";
  const results = state.latest_results || {};
  return {
    stamp: consistent ? verdict : "", note, final, title: String(state.title ?? ""), deadline: String(state.deadline_date ?? ""),
    funder: String(state.funder ?? ""), builder: String(state.builder ?? ""), round: Number(state.final_round || state.round || 0), amendments: Number(state.amendments || 0),
    checks: state.checks.map(c => ({ id: String(c.id), kind: String(c.kind), result: results[c.id] || "" })),
  };
}
