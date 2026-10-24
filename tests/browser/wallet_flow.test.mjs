// Browser tests with a mock EIP-1193 wallet and a mock Studio RPC. They check the page's behaviour
// (wallet connect, roles, transaction lifecycle). They do NOT prove real MetaMask or real Studionet behaviour.
// Run from the repository root:  npm install && npx playwright-core install chromium && npm test
// (set CHROMIUM_PATH to use an already installed Chromium instead of the downloaded one)
import { chromium } from "playwright-core";
import { abi } from "genlayer-js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web");
const PORT = 8771;
const FUNDER = "0x" + "a1".repeat(20), BUILDER = "0x" + "b2".repeat(20), OTHER = "0x" + "c3".repeat(20);
const FACTORY = "0x" + "f1".repeat(20);
const CONTRACT = "0x" + "d4".repeat(20), NEWC = "0x" + "e5".repeat(20);
const NOW = Math.floor(Date.now() / 1000);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  const f = path.join(WEB, u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });

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
  // states: per-contract state (lower-case address) for tests with more than one contract
  // listed: what the node returns for the per-account transaction listing; null = the call fails
  const rpc = { methods: [], state, states: {}, txScripts, nonce: 0, txIdx: {}, sends: [], listed: [], nonceFail: false, onFinal: null, finalSeen: {} };
  await p.exposeFunction("__bumpNonce", () => { rpc.nonce++; });
  await p.route("**/contracts/milestone_oracle.py", r => r.fulfill({ status: 200, contentType: "text/plain", body: "class MilestoneOracle:\n  pass\n" }));
  await p.route("**/config.js", r => r.fulfill({ status: 200, contentType: "text/javascript", body: 'window.MO_CONFIG={FACTORY:"",LIVE_EXAMPLE:"",REPO_CONTRACT:"https://github.com/Oziman13/genlayer-milestone-oracle",REPO_APP:"https://github.com/Oziman13/genlayer-milestone-oracle-app"};' }));
  await p.route("**/contracts/milestone_factory.py", r => r.fulfill({ status: 200, contentType: "text/plain", body: "class MilestoneFactory:\n  pass\n" }));
  await p.route("https://studio.genlayer.com/**", async r => {
    const req = r.request(); let body = {}; try { body = JSON.parse(req.postData() || "{}"); } catch {}
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const arr = Array.isArray(body) ? body : [body];
    if (arr.some(x => x.method === "eth_getTransactionCount") && rpc.onNonce) await rpc.onNonce();
    const out = arr.map(x => {
      rpc.methods.push(x.method);
      if (x.method === "gen_call") {
        const txt = Buffer.from((x.params[0].data || "").replace(/^0x/, ""), "hex").toString("latin1");
        let s = "NONE";
        (rpc.calledTo = rpc.calledTo || []).push(String(x.params[0].to || ""));
        const to = String(x.params[0].to || "").toLowerCase();
        let raw = null;
        if (rpc.stateFailures && rpc.stateFailures[to] > 0 && txt.includes("get_state_json")) { rpc.stateFailures[to]--; return { jsonrpc: "2.0", id: x.id, error: { code: -32000, message: "mock: contract not deployed yet" } }; }
        if (txt.includes("get_milestones_page")) s = JSON.stringify(rpc.factoryPage || { total: 0, items: [] });
        else if (txt.includes("is_factory_milestone")) raw = !!rpc.isFactory;
        else if (txt.includes("get_record")) s = rpc.recordRaw || "NONE";
        else if (txt.includes("get_factory_info")) s = JSON.stringify(rpc.factoryInfo || {});
        else if (txt.includes("get_state_json")) s = JSON.stringify(rpc.states[to] || rpc.state);
        else if (txt.includes("get_attestation")) s = rpc.state.phase === "FINALIZED" ? rpc.state.final_verdict : "NONE";
        else if (txt.includes("get_history_json")) s = JSON.stringify({ action: "ASSESS", verdict: "MET", timestamp: NOW, note: "", caller: FUNDER });
        return { jsonrpc: "2.0", id: x.id, result: Buffer.from(abi.calldata.encode(raw === null ? s : raw)).toString("hex") };
      }
      if (x.method === "eth_getTransactionCount") return rpc.nonceFail ? { jsonrpc: "2.0", id: x.id, error: { code: -32000, message: "mock: nonce unavailable" } } : { jsonrpc: "2.0", id: x.id, result: "0x" + rpc.nonce.toString(16) };
      if (x.method === "sim_getTransactionsForAddress") return rpc.listed === null ? { jsonrpc: "2.0", id: x.id, error: { code: -32601, message: "mock: listing unsupported" } } : { jsonrpc: "2.0", id: x.id, result: rpc.listed };
      if (x.method === "eth_gasPrice") return { jsonrpc: "2.0", id: x.id, result: "0x1" };
      if (x.method === "eth_estimateGas") return { jsonrpc: "2.0", id: x.id, result: "0x30d40" };
      if (x.method === "eth_chainId") return { jsonrpc: "2.0", id: x.id, result: "0xf22f" };
      if (x.method === "eth_getTransactionByHash") {
        const h = x.params[0]; const seq = rpc.txScripts[h] || [];
        const i = Math.min(rpc.txIdx[h] || 0, seq.length - 1); rpc.txIdx[h] = (rpc.txIdx[h] || 0) + 1;
        if (!seq.length) return { jsonrpc: "2.0", id: x.id, result: null };
        if (seq[i].status === "FINALIZED" && !rpc.finalSeen[h]) { rpc.finalSeen[h] = true; rpc.onFinal && rpc.onFinal(h); }
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
  const open = async (qs = "") => { await p.goto(`http://localhost:${PORT}/app.html?poll=50${qs}`); };
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


// ============================ NEW: wallet paths, ambiguous-send recovery, reload recovery ============================
const CONTRACT2 = "0x" + "f6".repeat(20);
const connect = async c => { await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/); };
const loaded = async c => { await c.open(`&address=${CONTRACT}`); await c.p.waitForSelector("#title", { state: "visible" }); };
const hexData = c => c.p.evaluate(() => (window.__reqs.filter(r => r.method === "eth_sendTransaction").pop() || { params: [{}] }).params[0].data || "");
const dataText = async c => Buffer.from((await hexData(c)).replace(/^0x/, ""), "hex").toString("latin1");
const sendCount = c => c.p.evaluate(() => window.__reqs.filter(r => r.method === "eth_sendTransaction").length);
const pend = c => c.p.evaluate(() => JSON.parse(localStorage.getItem("mo_pending_tx") || "null"));
const seed = (c, rec) => c.p.addInitScript(r => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("mo_pending_tx", JSON.stringify(r)); sessionStorage.setItem("seeded", "1"); } }, rec);
const allLocked = async c => (await Promise.all(["#b_start", "#b_assess", "#b_fin", "#b_amend", "#s_deploy"].map(i => c.p.locator(i).isDisabled()))).every(Boolean);
const listedTx = (over = {}) => ({ hash: H, from_address: OTHER, to_address: CONTRACT, nonce: 0, created_at: Math.floor(Date.now() / 1000), ...over });
const unlocked = c => c.p.waitForFunction(() => !document.getElementById("b_fin").disabled, null, { timeout: 5000 }).then(() => true).catch(() => false);

// --- the owner wallet paths that had no browser test: start_round, assess, amend -------------------------
{
  const c = await newCase({ state: baseState({ phase: "IDLE", round: 0, candidate: "NONE", window_end: 0 }), wallet: { accounts: [FUNDER] }, txScripts: { [H]: [tx("ACCEPTED", "SUCCESS"), tx("FINALIZED", "SUCCESS")] } });
  c.rpc.onFinal = () => { c.rpc.state = baseState({ phase: "OPEN", round: 1, candidate: "NONE", window_end: 0 }); };
  await loaded(c); await connect(c);
  await c.p.click("#b_start");
  ok("start_round: sent with the right function and applied only after FINALIZED+SUCCESS", await waitText(c.p, "#txmsg", /start_round was applied/) && (await dataText(c)).includes("start_round") && (await sendCount(c)) === 1);
  ok("start_round: the page reloads the state (phase OPEN) and unlocks assess", await waitText(c.p, "#phase", /^OPEN$/) && await c.p.waitForFunction(() => !document.getElementById("b_assess").disabled, null, { timeout: 5000 }).then(() => true).catch(() => false));
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState({ phase: "OPEN", round: 1, candidate: "NONE", window_end: 0 }), wallet: { accounts: [BUILDER] }, txScripts: { [H]: [tx("FINALIZED", "SUCCESS")] } });
  c.rpc.onFinal = () => { c.rpc.state = baseState({ phase: "PROVISIONAL", round: 1, candidate: "MET", history_count: 1, window_end: NOW + 600 }); };
  await loaded(c); await connect(c);
  await c.p.click("#b_assess");
  ok("assess: sent as assess and applied, state reloaded to PROVISIONAL", await waitText(c.p, "#txmsg", /assess was applied/) && (await dataText(c)).includes("assess") && await waitText(c.p, "#phase", /^PROVISIONAL$/));
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState({ phase: "NEEDS_EVIDENCE", round: 1, candidate: "NONE", window_end: 0 }), wallet: { accounts: [BUILDER] }, txScripts: { [H]: [tx("FINALIZED", "SUCCESS")] } });
  c.rpc.onFinal = () => { c.rpc.state = baseState({ phase: "NEEDS_EVIDENCE", round: 1, candidate: "NONE", amendments: 1, window_end: 0 }); };
  await loaded(c); await connect(c);
  await c.p.selectOption("#acheck", "readme");
  await c.p.fill("#atarget", "https://example.org/new.md"); await c.p.fill("#anote", "moved the file");
  await c.p.click("#b_amend");
  ok("amend: sent with the target and note, applied, amendment counter reloaded", await waitText(c.p, "#txmsg", /amend was applied/) && (await dataText(c)).includes("amend") && (await dataText(c)).includes("moved the file") && await waitText(c.p, "#amends", /1 of 3/));
  await c.ctx.close();
}
{
  const c = await newCase({ state: baseState({ phase: "NEEDS_EVIDENCE", window_end: 0 }), wallet: { accounts: [FUNDER] } });
  await loaded(c); await connect(c);
  ok("funder cannot amend or finalize outside the rules, nothing can be sent", (await c.p.locator("#b_amend").isDisabled()) && (await c.p.locator("#b_fin").isDisabled()) && (await sendCount(c)) === 0);
  await c.ctx.close();
}

// --- ambiguous send: context is kept, retry is blocked, the transaction is located after a reload -------
async function ambiguousCase(extra = {}) {
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER], sendMode: "errorButSent", hash: H }, txScripts: { [H]: [tx("ACCEPTED", "SUCCESS"), tx("FINALIZED", "SUCCESS")] }, ...extra });
  await loaded(c); await connect(c); await c.p.click("#b_fin");
  await waitText(c.p, "#txmsg", /may have been sent/);
  return c;
}
{
  const c = await ambiguousCase();
  const p = await pend(c);
  ok("ambiguous: the record keeps account, network, contract, action and nonce context",
    p && p.stage === "ambiguous" && p.account.toLowerCase() === OTHER && p.chainId === "0xf22f" && p.address.toLowerCase() === CONTRACT && p.fn === "finalize" && p.label === "finalize" && p.nonceBefore === 0 && p.nonceAfter === 1);
  ok("ambiguous: the unfinished-transaction panel shows that context", await c.p.locator("#recovery").isVisible() && /finalize/.test(await text(c.p, "#recmsg")) && (await text(c.p, "#recmsg")).includes(OTHER) && (await text(c.p, "#recmsg")).toLowerCase().includes(CONTRACT) && /before sending: 0/.test(await text(c.p, "#recmsg")));
  ok("ambiguous: every send, including deploy, is locked with the reason", await allLocked(c) && /may have been sent/.test(await text(c.p, "#r_finalize")));
  await c.p.click("#b_fin", { force: true }).catch(() => {});
  ok("ambiguous: a blind resend is impossible (only the first transaction was ever sent)", (await sendCount(c)) === 1);
  await c.ctx.close();
}
{ // reload, the node lists exactly one matching transaction -> it is found and followed to the end
  const c = await ambiguousCase();
  c.rpc.listed = [listedTx(), listedTx({ hash: "0x" + "11".repeat(32), to_address: CONTRACT2, nonce: 0 }), listedTx({ hash: "0x" + "22".repeat(32), nonce: 0, created_at: 1000 })];
  await c.p.reload();
  ok("reload: the matching transaction is located and reported as applied (other contract / ancient tx ignored)", await waitText(c.p, "#txmsg", /finalize was applied/));
  await connect(c);
  ok("reload: record cleared and sends unlocked again", (await pend(c)) === null && await unlocked(c) && await c.p.locator("#recovery").isHidden());
  await c.ctx.close();
}
{ // reload, the node lists nothing but the account's nonce moved -> unresolved, still blocked
  const c = await ambiguousCase();
  c.rpc.listed = [];
  await c.p.reload();
  ok("unresolved (nonce moved, nothing listed): says why and keeps sends blocked", await waitText(c.p, "#recmsg", /transaction count moved \(0 to 1\) but no matching transaction is listed/) && await allLocked(c));
  ok("unresolved: points to the account history in the explorer", /Account history: .*\/address\//.test(await text(c.p, "#recmsg")));
  c.rpc.listed = [listedTx()];
  await c.p.click("#recheck");
  ok("unresolved -> Check again finds the transaction once it is listed", await waitText(c.p, "#txmsg", /finalize was applied/) && (await pend(c)) === null);
  await c.ctx.close();
}
{ // listing not supported by the node: nonce still decides
  const c = await ambiguousCase();
  c.rpc.listed = null;
  await c.p.reload();
  ok("listing unavailable and nonce moved: unresolved, blocked, honest wording", await waitText(c.p, "#recmsg", /node could not list/) && await allLocked(c));
  await c.ctx.close();
}
{ // two plausible transactions
  const c = await ambiguousCase();
  const H2 = "0x" + "33".repeat(32);
  c.rpc.listed = [listedTx(), listedTx({ hash: H2, nonce: 0 })];
  await c.p.reload();
  ok("two candidates: both hashes are shown, nothing is guessed, sends stay blocked", await waitText(c.p, "#recmsg", /Several transactions/) && (await text(c.p, "#recmsg")).includes(H) && (await text(c.p, "#recmsg")).includes(H2) && await allLocked(c));
  await connect(c);
  ok("manual release: 'I checked: it was not sent' clears the record and unlocks", await (async () => { await c.p.click("#recdismiss"); return (await pend(c)) === null && !(await c.p.locator("#b_fin").isDisabled()); })());
  await c.ctx.close();
}
{ // hash never obtained, nonce did not move -> safe to retry
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER] } });
  await seed(c, { stage: "signing", label: "finalize", fn: "finalize", args: [], address: CONTRACT, account: OTHER, chainId: "0xf22f", nonceBefore: 0, at: Date.now() });
  await loaded(c);
  ok("reload during signing, nonce unchanged: reported as not sent, safe to retry", await waitText(c.p, "#txmsg", /was not sent: the account's transaction count did not move/) && (await pend(c)) === null);
  await connect(c);
  ok("reload during signing, nonce unchanged: sends unlocked", !(await c.p.locator("#b_fin").isDisabled()));
  await c.ctx.close();
}
{ // hash never obtained, tx was in fact broadcast
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER] }, txScripts: { [H]: [tx("FINALIZED", "SUCCESS")] } });
  c.rpc.nonce = 1; c.rpc.listed = [listedTx()];
  await seed(c, { stage: "signing", label: "finalize", fn: "finalize", args: [], address: CONTRACT, account: OTHER, chainId: "0xf22f", nonceBefore: 0, at: Date.now() });
  await loaded(c);
  ok("reload during signing, tx was broadcast: located by the listing and followed to FINALIZED", await waitText(c.p, "#txmsg", /finalize was applied/) && (await pend(c)) === null);
  await c.ctx.close();
}
{ // nonce unreadable when the wallet fails -> must be treated as ambiguous, not as 'not sent'
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER], sendMode: "errorNotSent" } });
  await loaded(c); await connect(c); c.rpc.nonceFail = true; await c.p.click("#b_fin");
  ok("nonce unreadable + wallet error: flagged ambiguous and blocked (never 'not sent')", await waitText(c.p, "#txmsg", /may have been sent/) && !/was not sent/.test(await text(c.p, "#txmsg")) && await allLocked(c));
  ok("nonce unreadable: the record is stored as ambiguous", (await pend(c)).stage === "ambiguous");
  await c.ctx.close();
}
{ // effect hint while unresolved
  const c = await newCase({ state: baseState({ phase: "FINALIZED", window_end: 0 }), wallet: { accounts: [OTHER] } });
  c.rpc.nonce = 1; c.rpc.listed = [];
  await seed(c, { stage: "ambiguous", label: "finalize", fn: "finalize", args: [], address: CONTRACT, account: OTHER, chainId: "0xf22f", nonceBefore: 0, nonceAfter: 1, at: Date.now(),
    snapshot: { round: 1, phase: "PROVISIONAL", history_count: 0, amendments: 0 } });
  await loaded(c);
  ok("unresolved: the contract state is compared with the snapshot and the hint is shown (record is NOT cleared by it)", await waitText(c.p, "#recmsg", /already shows the effect of finalize/) && (await pend(c)) !== null);
  await c.ctx.close();
}

// --- reload recovery uses the recorded contract and adopts a finalized deployment -----------------------
{ // the page was opened for another contract; the recorded transaction decides what is loaded
  const c = await newCase({ state: baseState({ title: "Wrong milestone" }), wallet: { accounts: [OTHER] }, txScripts: { [H]: [tx("ACCEPTED", "SUCCESS"), tx("FINALIZED", "SUCCESS", { recipient: CONTRACT2 })] } });
  c.rpc.states[CONTRACT2] = baseState({ title: "Recorded milestone" });
  await seed(c, { stage: "sent", hash: H, label: "assess", fn: "assess", args: [], address: CONTRACT2, account: OTHER, chainId: "0xf22f", nonceBefore: 0, at: Date.now() });
  await c.open(`&address=${CONTRACT}`);
  ok("reload recovery: finishes the recorded transaction", await waitText(c.p, "#txmsg", /assess was applied/));
  ok("reload recovery: the Contract box switches to the recorded contract and loads it", (await c.p.inputValue("#addr")).toLowerCase() === CONTRACT2 && (await text(c.p, "#title")) === "Recorded milestone");
  await c.ctx.close();
}
{ // finalized deployment is adopted after a reload
  const c = await newCase({ state: baseState({ title: "Old milestone" }), wallet: { accounts: [FUNDER] }, txScripts: { [H]: [tx("PENDING"), tx("FINALIZED", "SUCCESS", { recipient: NEWC })] } });
  c.rpc.states[NEWC] = baseState({ title: "Fresh milestone" });
  await seed(c, { stage: "sent", hash: H, label: "deploy", fn: "deploy", args: ["x"], account: FUNDER, chainId: "0xf22f", nonceBefore: 0, at: Date.now() });
  await c.open(`&address=${CONTRACT}`);
  ok("deploy recovery: the new address is adopted from the FINALIZED+SUCCESS receipt and loaded", await c.p.waitForFunction(a => document.getElementById("addr").value.toLowerCase() === a, NEWC, { timeout: 8000 }).then(() => true).catch(() => false) && await waitText(c.p, "#title", /Fresh milestone/));
  ok("deploy recovery: share link shown and record cleared", await waitText(c.p, "#txmsg", new RegExp("\\?address=" + NEWC)) && (await pend(c)) === null);
  await c.ctx.close();
}
{ // deploy FINALIZED but refused -> never adopted
  const c = await newCase({ state: baseState({ title: "Old milestone" }), wallet: { accounts: [FUNDER] }, txScripts: { [H]: [tx("FINALIZED", "ERROR", { recipient: NEWC })] } });
  await seed(c, { stage: "sent", hash: H, label: "deploy", fn: "deploy", args: ["x"], account: FUNDER, chainId: "0xf22f", nonceBefore: 0, at: Date.now() });
  await c.open(`&address=${CONTRACT}`);
  ok("deploy recovery: a refused deployment is reported and its address is NOT adopted", await waitText(c.p, "#txmsg", /contract refused it/) && (await c.p.inputValue("#addr")) === CONTRACT);
  await c.ctx.close();
}
{ // deploy finalized but no address in the receipt
  const c = await newCase({ state: baseState({ title: "Old milestone" }), wallet: { accounts: [FUNDER] }, txScripts: { [H]: [tx("FINALIZED", "SUCCESS", { recipient: undefined })] } });
  await seed(c, { stage: "sent", hash: H, label: "deploy", fn: "deploy", args: ["x"], account: FUNDER, chainId: "0xf22f", nonceBefore: 0, at: Date.now() });
  await c.open(`&address=${CONTRACT}`);
  ok("deploy recovery: no address in the receipt -> clear message, nothing adopted", await waitText(c.p, "#txmsg", /could not read the new contract address/) && (await c.p.inputValue("#addr")) === CONTRACT);
  await c.ctx.close();
}
{ // a transaction that is still not final stays recorded and blocked, and can be re-checked
  const c = await newCase({ state: baseState(), wallet: { accounts: [OTHER] }, txScripts: { [H]: [tx("PENDING")] } });
  await seed(c, { stage: "sent", hash: H, label: "finalize", fn: "finalize", args: [], address: CONTRACT, account: OTHER, chainId: "0xf22f", nonceBefore: 0, at: Date.now() });
  await loaded(c); await connect(c);
  ok("open transaction: sends are locked while it is unresolved", await waitText(c.p, "#r_finalize", /Waiting for the earlier finalize transaction/) && (await c.p.locator("#b_fin").isDisabled()));
  c.rpc.txScripts[H] = [tx("FINALIZED", "SUCCESS")];
  ok("open transaction: once it is FINALIZED+SUCCESS it is reported, the record is cleared and sends unlock", await waitText(c.p, "#txmsg", /finalize was applied/) && (await pend(c)) === null && await unlocked(c));
  await c.ctx.close();
}

// --- factory: create through the factory, adopt the address from its list, record a finalized verdict ----------
const sentData = c => c.p.evaluate(() => { const r = window.__reqs.filter(q => q.method === "eth_sendTransaction").pop(); return r ? JSON.stringify(r.params) : ""; });
const hasText = async (c, word) => c.p.evaluate(w => { const r = window.__reqs.filter(q => q.method === "eth_sendTransaction").pop(); if (!r) return false; const hex = String(r.params[0].data || "").replace(/^0x/, ""); let t = ""; for (let i = 0; i + 1 < hex.length; i += 2) t += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16)); return t.includes(w); }, word);
const fillSetup = async c => {
  await c.p.click("#newms"); await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  await c.p.fill("#s_builder", BUILDER); await c.p.fill("#s_title", "Demo milestone"); await c.p.fill("#s_deadline", "2026-12-31");
  await c.p.locator("#s_checks [data-k=repo]").fill("o/r"); await c.p.locator("#s_checks [data-k=tag]").fill("v0.1.0");
};
const created = { total: 2, offset: 0, items: [
  { funder: OTHER, builder: BUILDER, title: "Demo milestone", milestone: "0x" + "99".repeat(20), recorded: false },
  { funder: FUNDER, builder: BUILDER, title: "Demo milestone", milestone: NEWC, recorded: false }] };
{
  const c = await newCase({ state: baseState(), wallet: { accounts: [FUNDER], hash: H }, txScripts: { [H]: [tx("PENDING"), tx("FINALIZED", "SUCCESS", { recipient: FACTORY })] } });
  c.rpc.factoryPage = created; c.rpc.states[NEWC] = baseState({ title: "Demo milestone" }); c.rpc.isFactory = true;
  await c.open(`&factory=${FACTORY}`);
  await fillSetup(c);
  await c.p.click("#s_deploy");
  if (process.env.DBG) { await new Promise(r => setTimeout(r, 1500)); console.log("DATA", (await sentData(c)).slice(0, 700)); console.log("MSG", await text(c.p, "#s_errs"), "|", await text(c.p, "#txmsg"), c.errs); }
  ok("factory: the transaction is a create_milestone call (not a contract deployment)", await c.p.waitForFunction(() => window.__reqs.some(r => r.method === "eth_sendTransaction"), null, { timeout: 8000 }).then(() => true).catch(() => false) && await hasText(c, "create_milestone"));
  ok("factory: no list match is adopted as transaction proof", await waitText(c.p,"#txmsg",/No address was adopted/) && (await c.p.inputValue("#addr")) === "");
  ok("factory: transaction hash is retained instead of a guessed share link", (await pend(c))?.hash === H && !/Share this link/.test(await text(c.p,"#txmsg")));
  ok("factory: unresolved creation hides previous milestone and record", await c.p.locator("#app").isHidden() && await c.p.locator("#recordbox").isHidden());
  await c.ctx.close();
}
{ // created but not found in the list -> nothing adopted, clear message
  const c = await newCase({ state: baseState(), wallet: { accounts: [FUNDER], hash: H }, txScripts: { [H]: [tx("FINALIZED", "SUCCESS", { recipient: FACTORY })] } });
  c.rpc.factoryPage = { total: 0, items: [] };
  await c.open(`&factory=${FACTORY}`); await fillSetup(c); await c.p.click("#s_deploy");
  ok("factory: milestone not in the list -> message, address NOT adopted", await waitText(c.p, "#txmsg", /No address was adopted/) && (await c.p.inputValue("#addr")) === "");
  await c.ctx.close();
}
{ // finalized + factory milestone + not yet recorded -> record button, signed, then link
  const c = await newCase({ state: baseState({ phase: "FINALIZED", finalized: 1, final_verdict: "MET", candidate: "MET" }), wallet: { accounts: [OTHER], hash: H }, txScripts: { [H]: [tx("FINALIZED", "SUCCESS", { recipient: FACTORY })] } });
  c.rpc.isFactory = true;
  await c.open(`&factory=${FACTORY}&address=${CONTRACT}`);
  await c.p.waitForSelector("#recordbox", { state: "visible" });
  ok("record: finalized factory milestone offers 'Add to delivery record'", await c.p.locator("#b_record").isVisible() && /Anyone can add/.test(await text(c.p, "#recmsg2")));
  await c.p.click("#connect"); await waitText(c.p, "#wstatus", /Connected/);
  ok("record: a stranger (not funder/builder) may press it", await c.p.locator("#b_record").isEnabled());
  c.rpc.recordRaw = JSON.stringify({ verdict: "MET" });
  await c.p.click("#b_record");
  ok("record: sends a record call and reports it applied", await waitText(c.p, "#txmsg", /record was applied/) && await hasText(c, "record"));
  ok("record: afterwards shows 'On the delivery record' and a link to the builder page", await waitText(c.p, "#recmsg2", /On the delivery record/) && (await c.p.getAttribute("#recordlink", "href")).includes("builder.html?builder=" + BUILDER));
  await c.ctx.close();
}
{ // a milestone deployed outside the factory can never be recorded
  const c = await newCase({ state: baseState({ phase: "FINALIZED", finalized: 1, final_verdict: "MET" }), wallet: { accounts: [OTHER] } });
  c.rpc.isFactory = false;
  await c.open(`&factory=${FACTORY}&address=${CONTRACT}`);
  await c.p.waitForSelector("#recordbox", { state: "visible" });
  ok("record: look-alike (not from the factory) -> explained, no button", /not created through the factory/.test(await text(c.p, "#recmsg2")) && await c.p.locator("#b_record").isHidden());
  await c.ctx.close();
}
{ // no factory configured: the old direct-deploy flow and no record box
  const c = await newCase({ state: baseState() });
  await c.open(`&address=${CONTRACT}`);
  await c.p.waitForSelector("#title", { state: "visible" });
  ok("no factory: record box stays hidden", await c.p.locator("#recordbox").isHidden());
  await c.ctx.close();
}
{ // reload recovery of a create_milestone transaction adopts the milestone from the factory list
  const c = await newCase({ state: baseState({ title: "Old milestone" }), wallet: { accounts: [FUNDER] }, txScripts: { [H]: [tx("PENDING"), tx("FINALIZED", "SUCCESS", { recipient: FACTORY })] } });
  c.rpc.factoryPage = created; c.rpc.states[NEWC] = baseState({ title: "Fresh milestone" });
  await seed(c, { stage: "sent", hash: H, label: "create_milestone", fn: "create_milestone", args: [BUILDER, "Demo milestone"], address: FACTORY, meta: { builder: BUILDER, title: "Demo milestone" }, account: FUNDER, chainId: "0xf22f", nonceBefore: 0, at: Date.now() });
  await c.open(`&factory=${FACTORY}&address=${CONTRACT}`);
  ok("factory recovery: finalized creation stays unresolved after reload", await waitText(c.p,"#txmsg",/No address was adopted/) && (await c.p.inputValue("#addr")) === "" && (await pend(c))?.hash === H);
  ok("factory recovery: recorded factory remains authoritative despite URL", (await pend(c))?.address === FACTORY);
  await c.p.reload();
  ok("factory recovery: second reload retains transaction and lock", await waitText(c.p,"#txmsg",/No address was adopted/) && await allLocked(c));
  await c.p.click("#recdismiss");
  ok("factory recovery: manual acknowledgement never calls the creation not sent", await waitText(c.p,"#txmsg",/acknowledged/) && !/not sent/i.test(await text(c.p,"#txmsg")) && (await pend(c)) === null);
  await c.ctx.close();
}

// --- deploy-factory page -------------------------------------------------------------------------------
{
  const { createHash } = await import("node:crypto");
  const sha = "0x" + createHash("sha256").update("class MilestoneOracle:\n  pass\n").digest("hex");
  const openDF = async (c) => { await c.p.goto(`http://localhost:${PORT}/deploy-factory.html`); await c.p.waitForFunction(() => /SHA-256/.test(document.getElementById("info").textContent)); };
  { // happy path: signed by the wallet, address read from the receipt, hash verified
    const c = await newCase({ state: baseState(), wallet: { accounts: [FUNDER], hash: H }, txScripts: { [H]: [tx("PENDING"), tx("FINALIZED", "SUCCESS", { recipient: FACTORY })] } });
    c.rpc.factoryInfo = { code_sha256: sha, milestones: 0 };
    await openDF(c);
    ok("deploy-factory: shows the sizes and the SHA-256 of the milestone source", (await text(c.p, "#info")).includes(sha));
    ok("deploy-factory: deploy button locked until a wallet is connected", await c.p.locator("#deploy").isDisabled());
    await c.p.click("#connect"); await waitText(c.p, "#who", /Connected/);
    await c.p.click("#deploy");
    ok("deploy-factory: signed by the wallet", await c.p.waitForFunction(() => window.__reqs.some(r => r.method === "eth_sendTransaction"), null, { timeout: 8000 }).then(() => true).catch(() => false));
    ok("deploy-factory: address shown only after FINALIZED+SUCCESS", await c.p.waitForFunction(a => document.getElementById("addr").textContent.toLowerCase() === a, FACTORY, { timeout: 8000 }).then(() => true).catch(() => false));
    ok("deploy-factory: the factory's code hash is checked against the shown source", await waitText(c.p, "#verify", /Verified/));
    ok("deploy-factory: no page errors", c.errs.length === 0, c.errs.join("|"));
    await c.ctx.close();
  }
  { // wrong hash -> loud warning
    const c = await newCase({ state: baseState(), wallet: { accounts: [FUNDER], hash: H }, txScripts: { [H]: [tx("FINALIZED", "SUCCESS", { recipient: FACTORY })] } });
    c.rpc.factoryInfo = { code_sha256: "0x" + "00".repeat(32) };
    await openDF(c); await c.p.click("#connect"); await waitText(c.p, "#who", /Connected/); await c.p.click("#deploy");
    ok("deploy-factory: a factory with different code is flagged, not trusted", await waitText(c.p, "#verify", /WARNING/));
    await c.ctx.close();
  }
  { // refused by the network -> no address
    const c = await newCase({ state: baseState(), wallet: { accounts: [FUNDER], hash: H }, txScripts: { [H]: [tx("FINALIZED", "ERROR", { recipient: FACTORY })] } });
    await openDF(c); await c.p.click("#connect"); await waitText(c.p, "#who", /Connected/); await c.p.click("#deploy");
    ok("deploy-factory: a refused deployment shows no address", await waitText(c.p, "#msg", /not deployed/) && await c.p.locator("#result").isHidden());
    await c.ctx.close();
  }
  { // user rejects in the wallet
    const c = await newCase({ state: baseState(), wallet: { accounts: [FUNDER], sendMode: "reject" } });
    await openDF(c); await c.p.click("#connect"); await waitText(c.p, "#who", /Connected/); await c.p.click("#deploy");
    ok("deploy-factory: declining in the wallet sends nothing and says so", await waitText(c.p, "#msg", /not deployed|declined/i) && await c.p.locator("#result").isHidden() && (await c.p.locator("#deploy").isEnabled()));
    await c.ctx.close();
  }
}

{ // the new contract is not readable right away: the page waits and never shows the old milestone meanwhile
  const c = await newCase({ state: baseState({ title: "Old milestone" }), wallet: { accounts: [FUNDER], hash: H }, txScripts: { [H]: [tx("FINALIZED", "SUCCESS", { recipient: FACTORY })] } });
  c.rpc.factoryPage = created; c.rpc.states[NEWC] = baseState({ title: "Fresh milestone" }); c.rpc.isFactory = true; c.rpc.stateFailures = { [NEWC]: 3 };
  await c.open(`&factory=${FACTORY}&address=${CONTRACT}`);
  await c.p.waitForSelector("#title", { state: "visible" });
  ok("late contract: the old milestone is loaded first", (await text(c.p, "#title")) === "Old milestone");
  await fillSetup(c); await c.p.click("#s_deploy");
  ok("late contract: unreadable candidate is never auto-adopted", await waitText(c.p,"#txmsg",/No address was adopted/) && await c.p.locator("#app").isHidden());
  ok("late contract: the old milestone never stays on screen under the new address", (await c.p.inputValue("#addr")) === "");
  await c.ctx.close();
}
{ // never readable: honest message, no stale data, no success claim
  const c = await newCase({ state: baseState({ title: "Old milestone" }), wallet: { accounts: [FUNDER], hash: H }, txScripts: { [H]: [tx("FINALIZED", "SUCCESS", { recipient: FACTORY })] } });
  c.rpc.factoryPage = created; c.rpc.states[NEWC] = baseState({ title: "Fresh milestone" }); c.rpc.isFactory = true; c.rpc.stateFailures = { [NEWC]: 1000 };
  await c.open(`&factory=${FACTORY}&address=${CONTRACT}`);
  await c.p.waitForSelector("#title", { state: "visible" });
  await fillSetup(c); await c.p.click("#s_deploy");
  ok("unreadable contract: says created-but-not-readable, no success claim, old data hidden", await waitText(c.p, "#txmsg", /No address was adopted/, 15000) && !/through the factory\.\nShare/.test(await text(c.p, "#txmsg")) && await c.p.locator("#app").isHidden());
  await c.ctx.close();
}

{ // the network finds contracts by their checksum spelling: every read must use it, even if the page was opened with lowercase
  const { getAddress } = await import("viem");
  const c = await newCase({ state: baseState() });
  await c.open(`&address=${CONTRACT}`);
  await c.p.waitForSelector("#title", { state: "visible" });
  ok("checksum: reads use the checksum spelling although the page was opened with a lowercase address", c.rpc.calledTo.length > 0 && c.rpc.calledTo.every(t => t === getAddress(CONTRACT)), c.rpc.calledTo.join(","));
  ok("checksum: the verdict-card link uses the checksum spelling", (await c.p.getAttribute("#cardlink", "href")).endsWith("address=" + getAddress(CONTRACT)));
  await c.ctx.close();
}

{
  const c = await newCase({state:baseState(),wallet:{accounts:[OTHER],hash:H}});
  await loaded(c); await connect(c);
  await c.p.evaluate(()=>{ Storage.prototype.setItem = () => { throw new Error("storage blocked"); }; });
  await c.p.click("#b_fin");
  ok("wallet: unavailable recovery storage prevents signing", await waitText(c.p,"#txmsg",/recovery storage is unavailable/) && !(await c.p.evaluate(()=>window.__reqs.some(r=>r.method==="eth_sendTransaction"))));
  await c.ctx.close();
}
// Account changes while the nonce request is in flight must not sign with another client.
for (const deployFactory of [false,true]) {
  const c = await newCase({state:baseState(),wallet:{accounts:[OTHER],hash:H}});
  if (deployFactory) {
    await c.p.goto(`http://localhost:${PORT}/deploy-factory.html`);
    await c.p.waitForFunction(()=>/SHA-256/.test(document.getElementById("info").textContent));
    await c.p.click("#connect"); await waitText(c.p,"#who",/Connected/);
  } else { await loaded(c); await connect(c); }
  c.rpc.onNonce = async () => { c.rpc.onNonce = null; await c.p.evaluate(a=>window.ethereum.emit("accountsChanged",[a]),FUNDER); };
  await c.p.click(deployFactory ? "#deploy" : "#b_fin");
  ok(`account race: ${deployFactory ? "factory deployment" : "milestone action"} aborts before signing`, await waitText(c.p,deployFactory ? "#msg" : "#txmsg",/Wallet changed/) && !(await c.p.evaluate(()=>window.__reqs.some(r=>r.method==="eth_sendTransaction"))));
  await c.ctx.close();
}
// Exact transaction-to-child association is unavailable: all list shapes fail closed.
for (const [name, page] of [
  ["identical consecutive creations", {total:2,items:[{funder:FUNDER,builder:BUILDER,title:"Demo milestone",milestone:CONTRACT},{funder:FUNDER,builder:BUILDER,title:"Demo milestone",milestone:NEWC}]}],
  ["concurrent single match is not proof", created],
  ["more than 50 newer creations", {total:100,offset:50,items:created.items}],
  ["RPC indexing delay", {total:0,items:[]}],
]) {
  const c = await newCase({state:baseState(),wallet:{accounts:[FUNDER],hash:H},txScripts:{[H]:[tx("FINALIZED","SUCCESS",{recipient:FACTORY})]}});
  c.rpc.factoryPage = page;
  await c.open(`&factory=${FACTORY}`); await fillSetup(c); await c.p.click("#s_deploy");
  await waitText(c.p,"#txmsg",/created|applied/);
  await new Promise(r=>setTimeout(r,100));
  ok(`creation safety: ${name} never adopts a guessed address`, (await c.p.inputValue("#addr")) === "");
  ok(`creation safety: ${name} retains finalized transaction for manual recovery`, (await pend(c))?.hash === H && await allLocked(c));
  await c.ctx.close();
}
{
  const c = await newCase({state:baseState(),wallet:{accounts:[FUNDER],sendMode:"errorButSent"},nonceBump:true});
  await c.p.goto(`http://localhost:${PORT}/deploy-factory.html`);
  await c.p.waitForFunction(()=>/SHA-256/.test(document.getElementById("info").textContent));
  await c.p.click("#connect"); await waitText(c.p,"#who",/Connected/); await c.p.click("#deploy");
  await waitText(c.p,"#msg",/AMBIGUOUS|may have been sent/);
  ok("factory deployment: ambiguous send is durably locked", (await pend(c))?.stage === "ambiguous" && await c.p.locator("#deploy").isDisabled());
  await c.p.reload();
  await c.p.click("#connect"); await waitText(c.p,"#who",/Connected/);
  ok("factory deployment: reload preserves the send lock", await c.p.locator("#deploy").isDisabled());
  await c.ctx.close();
}
{
  const c = await newCase({state:baseState(),wallet:{accounts:[OTHER],hash:H},txScripts:{[H]:[tx("FINALIZED","")]}});
  await loaded(c); await connect(c); await c.p.click("#b_fin");
  await waitText(c.p,"#txmsg",/unreadable/);
  ok("unreadable finalized execution retains pending hash and blocks resend", (await pend(c))?.hash === H && await allLocked(c));
  await c.ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
