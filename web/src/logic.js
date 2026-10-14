// Pure, testable rules: which action is allowed for which wallet, in which phase, at which time.
export const MAX_ROUNDS = 6;
export const MAX_AMEND = 3;

const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
export const roleOf = (state, address) =>
  !state || !address ? "none" : same(address, state.funder) ? "funder" : same(address, state.builder) ? "builder" : "viewer";

const ok = () => ({ ok: true, reason: "" });
const no = reason => ({ ok: false, reason });

export function computeActions(state, address, nowSec, selectedCheckId) {
  const out = { role: roleOf(state, address) };
  if (!state) { for (const k of ["start", "assess", "amend", "finalize"]) out[k] = no("Load a milestone first."); return out; }
  const party = out.role === "funder" || out.role === "builder";
  const needWallet = !address;

  out.start = needWallet ? no("Connect a wallet.")
    : !party ? no("Only the funder or the builder can start a round.")
    : !["IDLE", "NEEDS_EVIDENCE"].includes(state.phase) ? no(state.phase === "FINALIZED" ? "The milestone is finalized." : "A round is already in progress.")
    : state.round >= MAX_ROUNDS ? no("Round limit reached.") : ok();

  out.assess = needWallet ? no("Connect a wallet.")
    : !party ? no("Only the funder or the builder can assess.")
    : state.phase !== "OPEN" ? no("Start a round first (phase must be OPEN).") : ok();

  const windowOpen = state.window_end > nowSec;
  const amendable = state.phase === "NEEDS_EVIDENCE" || (state.phase === "PROVISIONAL" && state.candidate === "NOT_MET" && windowOpen);
  const failing = selectedCheckId && ["FAIL", "LATE", "ERROR"].includes((state.latest_results || {})[selectedCheckId]);
  out.amend = needWallet ? no("Connect a wallet.")
    : out.role !== "builder" ? no("Only the builder can amend.")
    : !amendable ? no("Amending is possible in NEEDS_EVIDENCE, or while a NOT_MET reading is inside its challenge window.")
    : state.amendments >= MAX_AMEND ? no("All 3 amendments are used.")
    : !failing ? no("Pick a check that is currently failing.") : ok();

  out.finalize = needWallet ? no("Connect a wallet.")
    : state.phase !== "PROVISIONAL" ? no("There is no provisional verdict to finalize.")
    : windowOpen ? no("The challenge window is still open.") : ok();
  return out;
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;
export function validateSetup(form, funderAddress) {
  const errs = [];
  if (!ADDR.test(form.builder || "")) errs.push("Builder must be a 0x address (42 characters).");
  else if (funderAddress && same(form.builder, funderAddress)) errs.push("Builder must differ from the connected (funder) account.");
  if (!form.title || form.title.trim().length < 3) errs.push("Title needs at least 3 characters.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.deadline || "")) errs.push("Deadline must be YYYY-MM-DD.");
  if (!(form.window >= 300 && form.window <= 604800)) errs.push("Challenge window must be 300 to 604800 seconds.");
  if (!form.checks.length) errs.push("Add at least one check.");
  if (form.checks.length > 4) errs.push("At most four checks.");
  const ids = new Set();
  for (const c of form.checks) {
    if (ids.has(c.id)) errs.push("Check ids must be unique.");
    ids.add(c.id);
  }
  return errs;
}
