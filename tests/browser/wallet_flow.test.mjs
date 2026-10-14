// Browser tests with a mock EIP-1193 wallet and a mock Studio RPC. They check the page's behaviour
// (wallet connect, roles, transaction lifecycle). They do NOT prove real MetaMask or real Studionet behaviour.
// Run from a folder where playwright-core and genlayer-js are installed:  node wallet_flow.test.mjs
import { chromium } from "playwright-core";
import { abi } from "genlayer-js";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web");
const PORT = 8771;
const FUNDER = "0x" + "a1".repeat(20), BUILDER = "0x" + "b2".repeat(20), OTHER = "0x" + "c3".repeat(20);
const CONTRACT = "0x" + "d4".repeat(20), NEWC = "0x" + "e5".repeat(20);
const NOW = Math.floor(Date.now() / 1000);

const srv = spawn("python3", ["-m", "http.server", String(PORT), "-d", WEB], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  " + extra)); };

const baseState = over => ({
  funder: FUNDER, builder: BUILDER, title: "Ship v0.1.0", deadline_date: "2026-12-31", deadline_ts: 1798761599,
  amendments: 0, round: 1, phase: "PROVISIONAL", candidate: "MET", latest_verdict: "MET",
  latest_results: { release: "PASS", readme: "FAIL" }, window_end: NOW - 100, window_seconds: 300,
  final_verdict: "NONE", final_round: 0, finalized: 0, history_count: 0,
  checks: [{ id: "release", kind: "GITHUB_RELEASE", repo: "o/r", tag: "v0.1.0" }, { id: "readme", kind: "REPO_FILE", repo: "o/r", ref: "main", path: "README.md", phrase: "Known limitations" }],
  ...over,
});

async function newCase({ state, txScripts = {}, wallet = {}, hasWallet = true, nonceBump = false }) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(String(e)));
  const rpc = { methods: [], state, txScripts, nonce: 0, txIdx: {}, sends: [] };
  await p.exposeFunction("__bumpNonce", () => { rpc.nonce++; });
  await p.route("**/contracts/milestone_oracle.py", r => r.fulfill({ status: 200, contentType: "text/plain", body: "class MilestoneOracle:\n  pass\n" }));
  await p.route("https://studio.genlayer.com/**", async r => {
    const req = r.request(); let body = {}; try { body = JSON.parse(req.postData() || "{}"); } catch {}
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const arr = Array.isArray(body) ? body : [body];
    const out = arr.map(x => {
      rpc.methods.push(x.method);
      if (x.method === "gen_call") {
        const txt = Buffer.from((x.params[0].data || "").replace(/^0x/, ""), "hex").toString("latin1");
        let s = "NONE";
        if (txt.includes("get_state_json")) s = JSON.stringify(rpc.state);
        else if (txt.includes("get_attestation")) s = rpc.state.phase === "FINALIZED" ? rpc.state.final_verdict : "NONE";
        else if (txt.includes("get_history_json")) s = JSON.stringify({ action: "ASSESS", verdict: "MET", timestamp: NOW, note: "", caller: FUNDER });
        return { jsonrpc: "2.0", id: x.id, result: Buffer.from(abi.calldata.encode(s)).toString("hex") };
      }
      if (x.method === "eth_getTransactionCount") return { jsonrpc: "2.0", id: x.id, result: "0x" + rpc.nonce.toString(16) };
      if (x.method === "eth_gasPrice") return { jsonrpc: "2.0", id: x.id, result: "0x1" };
      if (x.method === "eth_estimateGas") return { jsonrpc: "2.0", id: x.id, result: "0x30d40" };
      if (x.method === "eth_chainId") return { jsonrpc: "2.0", id: x.id, result: "0xf22f" };
      if (x.method === "eth_getTransactionByHash") {
        const h = x.params[0]; const seq = rpc.txScripts[h] || [];
        const i = Math.min(rpc.txIdx[h] || 0, seq.length - 1); rpc.txIdx[h] = (rpc.txIdx[h] || 0) + 1;
        if (!seq.length) return { jsonrpc: "2.0", id: x.id, result: null };
        return { jsonrpc: "2.0", id: x.id, result: seq[i] };
      }
      return { jsonrpc: "2.0", id: x.id, error: { code: -32000, message: "mock: unsupported " + x.method } };
    });
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(Array.isArray(body) ? out : out[0]) });
  });
  if (hasWallet) {
    await p.addInitScript(cfg => {
      const listeners = {};
      window.__reqs = [];
      window.__w = { chainId: cfg.chainId, accounts: cfg.accounts, knownChain: cfg.knownChain, rejectConnect: cfg.rejectConnect, rejectSwitch: false, sendMode: cfg.sendMode || "ok", hash: cfg.hash || "0x" + "ab".repeat(32) };
      window.ethereum = {
        isMock: true,
        on: (e, f) => { (listeners[e] = listeners[e] || []).push(f); },
        emit: (e, v) => (listeners[e] || []).forEach(f => f(v)),
        request: async ({ method, params }) => {
          window.__reqs.push({ method, params });
          const w = window.__w;
          if (method === "eth_chainId") return w.chainId;
          if (method === "eth_requestAccounts" || method === "eth_accounts") {
            if (w.rejectConnect) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
            return w.accounts;
          }
          if (method === "wallet_switchEthereumChain") {
            if (w.rejectSwitch) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
            if (!w.knownChain && params[0].chainId !== w.chainId) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
            w.chainId = params[0].chainId; return null;
          }
          if (method === "wallet_addEthereumChain") { w.knownChain = true; return null; }
          if (method === "eth_sendTransaction") {
            if (w.sendMode === "reject") throw Object.assign(new Error("User rejected the request."), { code: 4001 });
            if (w.sendMode === "errorButSent") { await window.__bumpNonce(); throw new Error("RPC timeout after broadcast"); }
            if (w.sendMode === "errorNotSent") throw new Error("insufficient funds");
            await window.__bumpNonce(); return w.hash;
          }
          throw new Error("mock wallet: unsupported " + method);
        },
      };
    }, { chainId: "0xf22f", accounts: [FUNDER], knownChain: true, ...wallet });
  }
  const open = async (qs = "") => { await p.goto(`http://localhost:${PORT}/index.html?poll=50${qs}`); };
  return { p, ctx, rpc, errs, open };
}

const tx = (status, exec, extra = {}) => ({ hash: "0x" + "ab".repeat(32), status, data: {}, consensus_data: exec ? { leader_receipt: [{ execution_result: exec }] } : undefined, recipient: CONTRACT, ...extra });
const text = (p, sel) => p.textContent(sel);
const waitText = (p, sel, re, t = 8000) => p.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s).textContent), [sel, re.source], { timeout: t }).then(() => true).catch(() => false);

// 1. No wallet: reading works, actions locked, message is clear
{
  const c = await newCase({ state: baseState(), hasWallet: false });
  await c.open(`&address=${CONTRACT}`);
  await c.p.waitForSelector("#title", { state: "visible" });
  ok("no wallet: state still readable", (await text(c.p, "#title")) === "Ship v0.1.0");
  ok("no wallet: finalize disabled with reason", (await c.p.locator("#b_fin").isDisabled()) && /Connect a wallet/.test(await text(c.p, "#r_finalize")));
  ok("no wallet: explains how to proceed", /No browser wallet/.test(await text(c.p, "#wmsg")));
  ok("no private key input anywhere", (await c.p.locator("input[type=password]").count()) === 0 && !(await c.p.content()).includes("pkey"));
  ok("no localStorage key material", (await c.p.evaluate(() => Object.keys(localStorage))).every(k => !/key/i.test(k)));
  await c.ctx.close();
}

// 2. Connect flows
{
  const c = await newCase({ state: baseState(), wallet: { chainId: "0x1", knownChain: false } });
  await c.open(`&address=${CONTRACT}`);
  await c.p.waitForSelector("#title", { state: "visible" });
  await c.p.click("#connect");
  await waitText(c.p, "#wstatus", /Connected/);
  const reqs = await c.p.evaluate(() => window.__reqs.map(r => r.method));
  ok("connect: wrong chain -> add chain then switch", reqs.includes("wallet_addEthereumChain") && reqs.filter(m => m === "wallet_switchEthereumChain").length === 2);
  ok("connect: ends on Studio chain", (await c.p.evaluate(() => window.__w.chainId)) === "0xf22f");
  ok("connect: role pill shows funder", /funder/.test(await text(c.p, "#rolepill")));
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState(), wallet: { rejectConnect: true } });
  await c.open(`&address=${CONTRACT}`);
  await c.p.click("#connect");
  ok("connect: user rejection explained, not connected", await waitText(c.p, "#wmsg", /declined/) && /Not connected/.test(await text(c.p, "#wstatus")));
  await c.ctx.close();
}

// 3. Roles and phase-aware controls
{
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER] } });
  await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" });
  await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  ok("viewer: role viewer", /viewer/.test(await text(c.p, "#rolepill")));
  ok("viewer: start/assess/amend locked, finalize open after window",
    (await c.p.locator("#b_start").isDisabled()) && (await c.p.locator("#b_assess").isDisabled()) && (await c.p.locator("#b_amend").isDisabled()) && !(await c.p.locator("#b_fin").isDisabled()));
  ok("viewer: reason names the rule", /funder or the builder/.test(await text(c.p, "#r_start")));
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState({ window_end: NOW + 600 }), wallet: { accounts: [FUNDER] } });
  await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" });
  await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  ok("window open: finalize locked with reason", (await c.p.locator("#b_fin").isDisabled()) && /window is still open/.test(await text(c.p, "#r_finalize")));
  ok("funder cannot amend", /Only the builder/.test(await text(c.p, "#r_amend")));
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState({ phase: "NEEDS_EVIDENCE", candidate: "", window_end: 0 }), wallet: { accounts: [BUILDER] } });
  await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" });
  await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  await c.p.selectOption("#acheck", "readme");
  await c.p.dispatchEvent("#acheck", "change");
  ok("builder in NEEDS_EVIDENCE with failing check: amend enabled", !(await c.p.locator("#b_amend").isDisabled()));
  await c.p.selectOption("#acheck", "release"); await c.p.dispatchEvent("#acheck", "change");
  ok("builder: passing check cannot be amended", (await c.p.locator("#b_amend").isDisabled()) && /failing/.test(await text(c.p, "#r_amend")));
  ok("start allowed in NEEDS_EVIDENCE", !(await c.p.locator("#b_start").isDisabled()));
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState({ phase: "FINALIZED", final_verdict: "MET", window_end: 0 }), wallet: { accounts: [FUNDER] } });
  await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" });
  await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  ok("finalized: every action locked", (await c.p.locator("#b_start").isDisabled()) && (await c.p.locator("#b_assess").isDisabled()) && (await c.p.locator("#b_fin").isDisabled()));
  await c.ctx.close();
}

// 4. Transaction lifecycle
const H = "0x" + "ab".repeat(32);
{
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER], hash: H }, txScripts: { [H]: [tx("PENDING"), tx("ACCEPTED", "SUCCESS"), tx("FINALIZED", "SUCCESS")] } });
  await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" });
  await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  await c.p.click("#b_fin");
  const seenAccepted = await waitText(c.p, "#txmsg", /network status ACCEPTED/);
  ok("lifecycle: ACCEPTED is shown as in progress, not as applied", seenAccepted);
  ok("lifecycle: FINALIZED+SUCCESS reported as applied", await waitText(c.p, "#txmsg", /was applied/));
  const sent = await c.p.evaluate(() => window.__reqs.find(r => r.method === "eth_sendTransaction"));
  ok("lifecycle: transaction went through the wallet from the connected account", sent && sent.params[0].from.toLowerCase() === OTHER);
  // the reload runs right after the "applied" message appears, so wait for it instead of racing it
  for (let i = 0; i < 40 && c.rpc.methods.filter(m => m === "gen_call").length < 4; i++) await new Promise(r => setTimeout(r, 100));
  ok("lifecycle: state reloaded afterwards", c.rpc.methods.filter(m => m === "gen_call").length >= 4);
  ok("lifecycle: pending record cleared", (await c.p.evaluate(() => localStorage.getItem("mo_pending_tx"))) === null);
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER], hash: H }, txScripts: { [H]: [tx("ACCEPTED", "ERROR"), tx("FINALIZED", "ERROR")] } });
  await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" });
  await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  await c.p.click("#b_fin");
  ok("contract error: FINALIZED+ERROR reported as refused, not applied", await waitText(c.p, "#txmsg", /contract refused it/) && !/was applied/.test(await text(c.p, "#txmsg")));
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER], hash: H }, txScripts: { [H]: [tx("PENDING"), tx("UNDETERMINED")] } });
  await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" });
  await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  await c.p.click("#b_fin");
  ok("undetermined: reported as not applied", await waitText(c.p, "#txmsg", /not applied \(network status UNDETERMINED/));
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER], sendMode: "reject" } });
  await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" });
  await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  await c.p.click("#b_fin");
  ok("user rejects signature: clear message, no polling", await waitText(c.p, "#txmsg", /declined the request in the wallet. Nothing was sent/) && !c.rpc.methods.includes("eth_getTransactionByHash"));
  ok("user rejects: buttons usable again", !(await c.p.locator("#b_fin").isDisabled()));
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER], sendMode: "errorNotSent" } });
  await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" });
  await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  await c.p.click("#b_fin");
  ok("send error with unchanged nonce: reported as not sent", await waitText(c.p, "#txmsg", /was not sent/));
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER], sendMode: "errorButSent" } });
  await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" });
  await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  await c.p.click("#b_fin");
  ok("send error but nonce moved: flagged ambiguous, resend discouraged", await waitText(c.p, "#txmsg", /may have been sent/));
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER], chainId: "0x1", hash: H }, txScripts: { [H]: [tx("FINALIZED", "SUCCESS")] } });
  await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" });
  await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  await c.p.evaluate(() => { window.__w.chainId = "0x1"; window.ethereum.emit("chainChanged", "0x1"); });
  ok("network switched away: warning shown", await waitText(c.p, "#wmsg", /Wrong network/));
  await c.p.click("#b_fin");
  ok("wrong network at send time: wallet is switched back before sending", await waitText(c.p, "#txmsg", /was applied/) && (await c.p.evaluate(() => window.__reqs.filter(r => r.method === "wallet_switchEthereumChain").length)) >= 2);
  await c.ctx.close();
}

// 5. Resume an interrupted transaction after reload
{
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER] }, txScripts: { [H]: [tx("ACCEPTED", "SUCCESS"), tx("FINALIZED", "SUCCESS")] } });
  await c.p.addInitScript(([h, a]) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("mo_pending_tx", JSON.stringify({ hash: h, label: "finalize", fn: "finalize", address: a, at: Date.now() })); sessionStorage.setItem("seeded", "1"); } }, [H, CONTRACT]);
  await c.open("");
  ok("resume: finds the open transaction and reports final result", await waitText(c.p, "#txmsg", /was applied/));
  ok("resume: loads the milestone it belonged to", (await c.p.inputValue("#addr")) === CONTRACT);
  ok("resume: record cleared", (await c.p.evaluate(() => localStorage.getItem("mo_pending_tx"))) === null);
  await c.ctx.close();
}

// 6. Setup / deploy workflow
{
  const c = await newCase({ state: baseState(), wallet: { accounts: [FUNDER], hash: H },
    txScripts: { [H]: [tx("PENDING"), tx("FINALIZED", "SUCCESS", { recipient: NEWC })] } });
  await c.open("");
  await c.p.click("#newms");
  ok("setup: form visible with one starter check", (await c.p.locator("#s_checks .chk").count()) === 1);
  await c.p.click("#s_deploy");
  ok("setup: asks to connect first and lists field errors", /Connect a wallet/.test(await text(c.p, "#s_errs")) && /Builder must be/.test(await text(c.p, "#s_errs")));
  await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  await c.p.fill("#s_builder", FUNDER); await c.p.fill("#s_title", "Demo milestone"); await c.p.fill("#s_deadline", "2026-12-31");
  await c.p.click("#s_deploy");
  ok("setup: builder equal to funder rejected before any transaction", /must differ/.test(await text(c.p, "#s_errs")) && !(await c.p.evaluate(() => window.__reqs.some(r => r.method === "eth_sendTransaction"))));
  await c.p.fill("#s_builder", BUILDER);
  await c.p.fill("#s_window", "10");
  await c.p.click("#s_deploy");
  ok("setup: out-of-range window and empty check rejected", /300 to 604800/.test(await text(c.p, "#s_errs")));
  await c.p.fill("#s_window", "300");
  await c.p.locator("#s_checks [data-k=repo]").fill("o/r"); await c.p.locator("#s_checks [data-k=tag]").fill("v0.1.0");
  c.rpc.state = baseState({ funder: FUNDER, builder: BUILDER, title: "Demo milestone" });
  await c.p.click("#s_deploy");
  ok("setup: deploy is signed by the wallet", await c.p.waitForFunction(() => window.__reqs.some(r => r.method === "eth_sendTransaction"), null, { timeout: 8000 }).then(() => true).catch(() => false));
  ok("setup: after FINALIZED+SUCCESS the new address is picked up and loaded", await c.p.waitForFunction(a => document.getElementById("addr").value === a, NEWC, { timeout: 8000 }).then(() => true).catch(() => false));
  ok("setup: share link offered", await waitText(c.p, "#txmsg", new RegExp("\\?address=" + NEWC)));
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState(), wallet: { accounts: [FUNDER], hash: H }, txScripts: { [H]: [tx("FINALIZED", "ERROR", { recipient: NEWC })] } });
  await c.open("");
  await c.p.click("#newms"); await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  await c.p.fill("#s_builder", BUILDER); await c.p.fill("#s_title", "Demo milestone"); await c.p.fill("#s_deadline", "2026-12-31");
  await c.p.locator("#s_checks [data-k=repo]").fill("o/r"); await c.p.locator("#s_checks [data-k=tag]").fill("v0.1.0");
  await c.p.click("#s_deploy");
  ok("deploy refused by contract: reported, address NOT adopted", await waitText(c.p, "#txmsg", /contract refused it/) && (await c.p.inputValue("#addr")) === "");
  await c.ctx.close();
}

// 7. Safety of rendering
{
  const c = await newCase({ state: baseState({ title: "<img src=x onerror=alert(1)>" }) });
  const dialogs = []; c.p.on("dialog", d => { dialogs.push(d.message()); d.dismiss(); });
  await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" });
  ok("hostile title rendered as text, no script ran", (await text(c.p, "#title")).includes("<img") && dialogs.length === 0);
  ok("no page errors in the whole run", c.errs.length === 0, c.errs.join("|"));
  await c.ctx.close();
}

{
  // the page remembers the last milestone you looked at, so a reload does not drop it
  const c = await newCase({ state: baseState() });
  await c.open(""); 
  ok("fresh visit with no address and nothing remembered shows an empty box", (await c.p.inputValue("#addr")) === "");
  await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" });
  ok("a loaded address is remembered", (await c.p.evaluate(() => localStorage.getItem("mo_last_address"))) === CONTRACT);
  await c.open(""); await c.p.waitForSelector("#title", { state: "visible" });
  ok("reload without ?address= restores it and loads the milestone", (await c.p.inputValue("#addr")) === CONTRACT && (await text(c.p, "#title")) === "Ship v0.1.0");
  await c.open(`&address=${NEWC}`);
  ok("an address in the link wins over the remembered one", (await c.p.inputValue("#addr")) === NEWC);
  ok("no page errors in the remember-address checks", c.errs.length === 0, c.errs.join("|"));
  await c.ctx.close();
}

await browser.close(); srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
