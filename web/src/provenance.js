import { validAddress, checksum } from "./record.js";
export const DEMO_FACTORY = "0x123352e162Fa441Ba1C4252662A7d00EC05fb737";
export const EVIDENCE_LIMIT = "Current-state verification: REPO_FILE, LIVE_PAGE and DELIVERABLE read evidence now, not as of the deadline. MET does not prove historical delivery. GITHUB_RELEASE checks the reported publication time; it does not freeze release contents.";
export function showProvenance(factory) {
  if (!validAddress(factory)) return;
  const known = factory.toLowerCase() === DEMO_FACTORY.toLowerCase();
  const p = document.createElement("p");
  p.id = "factory-provenance";
  p.className = "small";
  // Visible even in embedded records: unknown factory data must not appear canonical.
  p.textContent = (known ? "Known demo factory (historical project evidence): " : "Unverified custom factory: ") + checksum(factory) + ". " +
    (known ? "Live code provenance has not been independently verified here. " : "Its records are claims from this address, not the known demo factory. Matching method names or a self-reported hash do not authenticate code. ") +
    "Records use default state reads; contract FINALIZED is not proof of network-finalized state. " + EVIDENCE_LIMIT;
  document.querySelector("main")?.prepend(p);
}
