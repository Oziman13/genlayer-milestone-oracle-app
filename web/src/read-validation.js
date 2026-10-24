// Validate read responses before they reach date formatters or action controls.
const object = value => !!value && typeof value === "object" && !Array.isArray(value);
export const validTimestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799;
export const validCount = value => Number.isSafeInteger(value) && value >= 0;
export const validHistoryCount = value => validCount(value) && value <= 64;
export const validChecks = checks => Array.isArray(checks) && checks.length >= 1 && checks.length <= 4 &&
  checks.every(c => object(c) && typeof c.id === "string" && /^[a-z0-9_]{1,20}$/.test(c.id) &&
    ["GITHUB_RELEASE", "REPO_FILE", "LIVE_PAGE", "DELIVERABLE"].includes(c.kind)) &&
  new Set(checks.map(c => c.id)).size === checks.length;
export function validReadState(state) {
  return object(state) && validChecks(state.checks) && typeof state.title === "string" &&
    ["IDLE", "OPEN", "PROVISIONAL", "NEEDS_EVIDENCE", "FINALIZED"].includes(state.phase) &&
    [state.funder, state.builder].every(a => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a)) &&
    validHistoryCount(state.history_count) &&
    ["round", "final_round", "amendments"].every(k => validCount(state[k])) &&
    validTimestamp(state.window_end) && [0, 1].includes(state.finalized) &&
    object(state.latest_results);
}
export const validHistoryRow = row => object(row) && typeof row.action === "string" && validTimestamp(row.timestamp);
