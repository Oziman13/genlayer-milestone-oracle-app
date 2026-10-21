import { hasWallet, readClient, writeClient, connectWallet, ensureNetwork, sendAndConfirm, EXPLORER } from "./wallet.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let address = null, wallet = null, busy = false, oracleCode = "", factoryCode = "", oracleSha = "";

const sha256 = async text => "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, "0")).join("");
const say = (t, err = false) => { $("msg").className = "notice" + (err ? " err" : ""); $("msg").textContent = t; };
const findAddress = tx => [tx?.txDataDecoded?.contractAddress, tx?.data?.contract_address, tx?.recipient, tx?.to_address].find(x => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x)) || null;

async function fetchCode() {
  const get = async f => { const r = await fetch(f, { cache: "no-store" }); if (!r.ok) throw new Error(f + ": HTTP " + r.status); return r.text(); };
  oracleCode = await get("../contracts/milestone_oracle.py");
  factoryCode = await get("../contracts/milestone_factory.py");
  if (!oracleCode.includes("class MilestoneOracle")) throw new Error("milestone_oracle.py has unexpected content");
  if (!factoryCode.includes("class MilestoneFactory")) throw new Error("milestone_factory.py has unexpected content");
  oracleSha = await sha256(oracleCode);
  $("info").innerHTML = `Factory source: ${factoryCode.length} characters. Milestone source it will hold: ${oracleCode.length} characters.<br>Milestone source SHA-256: <code>${esc(oracleSha)}</code>`;
  $("deploy").disabled = busy || !address;
}

$("connect").onclick = async () => {
  try { address = await connectWallet(); wallet = writeClient(address); $("who").textContent = "Connected: " + address; $("deploy").disabled = busy || !oracleSha; }
  catch (e) { say(e.message || String(e), true); }
};

$("deploy").onclick = async () => {
  if (!wallet || !oracleSha) return;
  busy = true; $("deploy").disabled = true;
  try {
    await ensureNetwork();
    say("Confirm the deployment in your wallet…");
    const o = await sendAndConfirm({ client: wallet, address, label: "deploy factory", build: () => wallet.deployContract({ code: factoryCode, args: [oracleCode], leaderOnly: false }),
      onUpdate: u => { if (u.stage === "submitted") say(`Sent. Tx ${u.hash}\nWaiting for the network to finalize it (can take several minutes)…${EXPLORER ? "\nExplorer: " + EXPLORER + "/tx/" + u.hash : ""}`); } });
    if (o.kind !== "APPLIED") { say(`The factory was not deployed (${o.kind}${o.message ? ": " + o.message : ""}).${o.hash ? "\nTx " + o.hash : ""}${o.kind === "STILL_PENDING" || o.kind === "AMBIGUOUS" ? "\nIt may still go through. Check your account's history in the explorer before trying again." : ""}`, true); return; }
    const a = findAddress(o.tx);
    if (!a) { say("Deployment finalized, but the address could not be read from the receipt. Find it in the explorer under this transaction.", true); return; }
    $("result").hidden = false; $("addr").textContent = a;
    let verdict = "";
    try {
      const info = JSON.parse(await readClient().readContract({ address: a, functionName: "get_factory_info", args: [] }));
      verdict = info.code_sha256 === oracleSha ? "Verified: the factory holds exactly the milestone source shown above." : "WARNING: the factory's code hash differs from the source shown above. Do not use this factory.";
      $("verify").className = info.code_sha256 === oracleSha ? "notice" : "notice err";
    } catch (e) { verdict = "Could not read the new factory yet (" + (e.message || e) + "). Reload and try again before using it."; $("verify").className = "notice err"; }
    $("verify").textContent = verdict;
    say("Factory deployed.");
  } catch (e) { say("Deployment did not start: " + (e.message || e), true); }
  finally { busy = false; $("deploy").disabled = !address || !oracleSha; }
};

if (!hasWallet()) say("No browser wallet found. Install MetaMask (or another EIP-1193 wallet) and reload.", true);
fetchCode().catch(e => say("Could not load the contract sources: " + (e.message || e), true));
