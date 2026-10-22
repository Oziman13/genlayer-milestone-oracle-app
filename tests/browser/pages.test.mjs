// Tests for the landing page and the builder record page (mock Studio RPC; no real network).
import { chromium } from "playwright-core";
import { abi } from "genlayer-js";
import { getAddress } from "viem";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summaryView, validAddress, pickCreated, recordState, cardView } from "../../web/src/record.js";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web");
const PORT = 8772;
const FACTORY = "0x" + "f1".repeat(20), B = "0x" + "b2".repeat(20), F = "0x" + "a1".repeat(20), M1 = "0x" + "d4".repeat(20), M2 = "0x" + "d5".repeat(20);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".md": "text/markdown" };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  const f = path.join(WEB, u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  " + x)); };

// ---- pure helpers
ok("validAddress accepts 0x+40 hex only", validAddress(B) && !validAddress("0x12") && !validAddress("b2".repeat(21)) && !validAddress(null));
ok("summaryView rejects non-summary", summaryView("nope") === null && summaryView("{}") === null && summaryView(JSON.stringify({ milestones: 5 })) === null);
const raw = JSON.stringify({ builder: B, created: 3, milestones: [
  { milestone: M1, title: "A", verdict: "MET", finalized_at: 100, amendments: 0, funder: F },
  { milestone: M2, title: "B", verdict: "NOT_MET", finalized_at: 200, amendments: 2, funder: F },
  { milestone: "bad", title: "X", verdict: "MET" }, { milestone: M1, title: "Y", verdict: "MAYBE" }] });
const v = summaryView(raw);
ok("summaryView drops malformed rows and recounts itself", v.recorded === 2 && v.met === 1 && v.not_met === 1 && v.with_amendments === 1 && v.created === 3);

// ---- pickCreated / recordState
const rows = [{ funder: F, builder: B, title: "T", milestone: M1 }, { funder: F.toUpperCase().replace("0X", "0x"), builder: B, title: " T ", milestone: M2 }, { funder: "0x" + "cc".repeat(20), builder: B, title: "T", milestone: "0x" + "77".repeat(20) }];
ok("pickCreated: newest matching row wins, case and spaces ignored", pickCreated(rows, F, B, "T") === M2);
ok("pickCreated: other funder's twin is never picked", pickCreated(rows, "0x" + "cc".repeat(20), B, "T") === "0x" + "77".repeat(20) && pickCreated(rows, "0x" + "dd".repeat(20), B, "T") === null);
ok("pickCreated: empty or malformed input gives null", pickCreated([], F, B, "T") === null && pickCreated(null, F, B, "T") === null && pickCreated([{ funder: F, builder: B, title: "T", milestone: "bad" }], F, B, "T") === null);
const fin = { finalized: 1, phase: "FINALIZED", final_verdict: "MET" };
ok("recordState: not from the factory -> cannot record", !recordState(false, fin, "NONE").canRecord);
ok("recordState: finalized MET/NOT_MET and not recorded -> can record", recordState(true, fin, "NONE").canRecord && recordState(true, { ...fin, final_verdict: "NOT_MET" }, "NONE").canRecord);
ok("recordState: INCONCLUSIVE / not finalized -> cannot record", !recordState(true, { ...fin, final_verdict: "INCONCLUSIVE" }, "NONE").canRecord && !recordState(true, { ...fin, finalized: 0, phase: "PROVISIONAL" }, "NONE").canRecord);
ok("recordState: already recorded -> shown as recorded, no button", recordState(true, fin, "{}").recorded && !recordState(true, fin, "{}").canRecord);

// ---- cardView (pure)
const st = over => ({ title: "Ship v1", deadline_date: "2026-12-31", funder: F, builder: B, phase: "FINALIZED", finalized: 1, final_verdict: "MET", final_round: 1, round: 1, amendments: 0, history_count: 3,
  checks: [{ id: "release", kind: "GITHUB_RELEASE" }, { id: "readme", kind: "REPO_FILE" }], latest_results: { release: "PASS" }, ...over });
ok("cardView: FINALIZED MET gets the MET stamp", cardView(st(), "MET").stamp === "MET" && cardView(st(), "MET").final);
ok("cardView: provisional reading never gets a stamp", cardView(st({ phase: "PROVISIONAL", finalized: 0, final_verdict: "NONE" }), "NONE").stamp === "" && /Not final/.test(cardView(st({ phase: "PROVISIONAL", finalized: 0, final_verdict: "NONE" }), "NONE").note));
ok("cardView: attestation that disagrees with the final verdict -> no stamp and a warning", cardView(st(), "NOT_MET").stamp === "" && /disagree/.test(cardView(st(), "NOT_MET").note));
ok("cardView: finalized INCONCLUSIVE -> no stamp", cardView(st({ final_verdict: "INCONCLUSIVE" }), "NONE").stamp === "" && /without a MET or NOT_MET/.test(cardView(st({ final_verdict: "INCONCLUSIVE" }), "NONE").note));
ok("cardView: unchecked checks have an empty result, junk input gives null", cardView(st(), "MET").checks[1].result === "" && cardView(null, "") === null && cardView({}, "") === null);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
async function page(summary, extra = {}) {
  const p = await (await browser.newContext()).newPage();
  const errs = []; p.on("pageerror", e => errs.push(String(e)));
  await p.route("**/config.js", r => r.fulfill({ status: 200, contentType: "text/javascript", body: 'window.MO_CONFIG={FACTORY:"",LIVE_EXAMPLE:"",REPO_CONTRACT:"https://github.com/Oziman13/genlayer-milestone-oracle",REPO_APP:"https://github.com/Oziman13/genlayer-milestone-oracle-app"};' }));
  await p.route("https://fonts.googleapis.com/**", r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("https://studio.genlayer.com/**", async r => {
    const req = r.request(); let body = {}; try { body = JSON.parse(req.postData() || "{}"); } catch {}
    const h = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
    const out = (Array.isArray(body) ? body : [body]).map(x => {
      if (x.method === "gen_call") {
        const txt = Buffer.from((x.params[0].data || "").replace(/^0x/, ""), "hex").toString("latin1");
        if (summary === "FAIL") return { jsonrpc: "2.0", id: x.id, error: { code: -32000, message: "mock down" } };
        let s = txt.includes("get_builder_summary") ? summary : "NONE", raw = null;
        if (txt.includes("get_state_json")) s = extra.state ? JSON.stringify(extra.state) : "NONE";
        else if (txt.includes("get_attestation")) s = extra.att || "NONE";
        else if (txt.includes("get_history_json")) s = JSON.stringify({ action: "FINALIZE", verdict: "MET", timestamp: 1790000000, note: "", caller: F });
        else if (txt.includes("is_factory_milestone")) raw = extra.isFactory === true;
        else if (txt.includes("get_record")) s = extra.record || "NONE";
        return { jsonrpc: "2.0", id: x.id, result: Buffer.from(abi.calldata.encode(raw === null ? s : raw)).toString("hex") };
      }
      if (x.method === "eth_chainId") return { jsonrpc: "2.0", id: x.id, result: "0xf22f" };
      return { jsonrpc: "2.0", id: x.id, error: { code: -32000, message: "mock: unsupported" } };
    });
    r.fulfill({ status: 200, contentType: "application/json", headers: h, body: JSON.stringify(Array.isArray(body) ? out : out[0]) });
  });
  return { p, errs };
}
const url = q => `http://localhost:${PORT}/${q}`;

// ---- landing
{
  const { p, errs } = await page("{}");
  await p.goto(url("index.html")); 
  ok("landing: headline and both buttons", (await p.textContent("h1")).includes("Did they deliver") && (await p.locator("a.btn").count()) >= 2);
  ok("landing: shows only the labelled real test run (stamp MET, own accounts)", (await p.textContent(".slip")).includes("Our own test run") && (await p.textContent(".slip")).includes("own test accounts"));
  ok("landing: no empty counters or invented numbers on the page", !/\b0 (milestones|builders)\b/.test(await p.textContent("body")));
  ok("landing: footer links filled from config", (await p.getAttribute("#repoC", "href")).includes("github.com/Oziman13/genlayer-milestone-oracle"));
  ok("landing: no page errors", errs.length === 0, errs.join("|"));
  await p.goto(url("index.html?address=0xDf63AB2C788c452e5E0088E6767Fe78e6e93ce30"));
  await p.waitForURL(/app\.html\?address=0xDf63/);
  ok("landing: old ?address= links still open the app", p.url().includes("/app.html?address=0xDf63"));
  await p.close();
}
// ---- builder page
{
  const { p, errs } = await page(raw);
  await p.goto(url(`builder.html?builder=${B}&factory=${FACTORY}`));
  await p.waitForSelector(".counts");
  const t = await p.textContent("#out");
  ok("builder: counts recomputed from rows (2 recorded, 1 MET, 1 NOT_MET)", /2ontherecord/.test(t.replace(/\s/g, "")) && t.includes("NOT_MET") && t.includes("MET"));
  ok("builder: rows link to the milestone in the app", (await p.locator("#out table a").first().getAttribute("href")).endsWith("app.html?address=" + getAddress(M1)));
  ok("builder: states what is NOT counted (created 3, recorded 2)", t.includes("1 more is not finalized or not recorded yet"));
  ok("builder: embed snippet offered", (await p.textContent("#out details pre")).includes("badge=1"));
  ok("builder: no page errors", errs.length === 0, errs.join("|"));
  await p.close();
}
{
  const { p } = await page(JSON.stringify({ builder: B, created: 1, milestones: [] }));
  await p.goto(url(`builder.html?builder=${B}&factory=${FACTORY}`));
  await p.waitForSelector("#out .notice");
  ok("builder: created but not recorded -> honest empty state, no zero counters", (await p.textContent("#out")).includes("not on the record yet") && (await p.locator(".counts").count()) === 0);
  await p.close();
}
{
  const { p } = await page("FAIL");
  await p.goto(url(`builder.html?builder=${B}&factory=${FACTORY}`));
  await p.waitForSelector("#out .notice");
  ok("builder: node failure is reported, not shown as an empty record", (await p.textContent("#out")).includes("Could not read the factory"));
  await p.close();
}
{
  const { p } = await page("{}");
  await p.goto(url(`builder.html?builder=${B}`));
  await p.waitForSelector("#out .notice");
  ok("builder: no factory configured -> says so, no sample data", (await p.textContent("#out")).includes("No factory is set"));
  await p.fill("#builder", "0x12"); await p.click("#go");
  ok("builder: bad address refused", (await p.textContent("#out")).includes("40 hex characters"));
  await p.close();
}
{
  const { p } = await page(raw);
  await p.goto(url(`builder.html?builder=${B}&factory=${FACTORY}&badge=1`));
  await p.waitForSelector(".counts");
  ok("badge mode: header and table hidden, counts visible", !(await p.isVisible("header")) && !(await p.locator("#out table").isVisible()) && await p.isVisible(".counts"));
  await p.close();
}
// ---- card page
const M = "0x" + "d4".repeat(20);
{
  const { p, errs } = await page("{}", { state: st(), att: "MET", isFactory: true, record: "{}" });
  await p.goto(url(`card.html?address=${M}&factory=${FACTORY}`));
  await p.waitForSelector(".slip");
  const t = await p.textContent("#card");
  ok("card: finalized MET shows the stamp, title, checks and who is who", (await p.textContent(".stamp")) === "MET" && t.includes("Ship v1") && t.includes("release") && t.includes("PASS") && t.includes("not checked"));
  ok("card: shows the last real history event", t.includes("FINALIZE") && t.includes("UTC"));
  ok("card: recorded milestone links to the builder record", t.includes("On the delivery record") && (await p.locator("#card a", { hasText: "builder's record" }).getAttribute("href")).includes("builder.html?builder=" + B));
  ok("card: states the limits, links to the full history", t.includes("does not say the work is good") && (await p.locator("#card a", { hasText: "full history" }).getAttribute("href")).includes("app.html?address=" + getAddress(M)));
  ok("card: title carries the verdict", (await p.title()).startsWith("MET: Ship v1"));
  ok("card: no page errors", errs.length === 0, errs.join("|"));
  await p.close();
}
{
  const { p } = await page("{}", { state: st({ phase: "PROVISIONAL", finalized: 0, final_verdict: "NONE" }), att: "NONE" });
  await p.goto(url(`card.html?address=${M}`));
  await p.waitForSelector(".slip");
  ok("card: provisional reading has NO stamp and says it is not final", (await p.locator(".stamp").count()) === 0 && (await p.textContent("#card")).includes("Not final"));
  await p.close();
}
{
  const { p } = await page("{}", { state: st(), att: "MET", isFactory: false });
  await p.goto(url(`card.html?address=${M}&factory=${FACTORY}`));
  await p.waitForSelector(".slip");
  ok("card: milestone outside the factory says it cannot be on the record", (await p.textContent("#card")).includes("outside the factory"));
  await p.close();
}
{
  const { p } = await page("FAIL");
  await p.goto(url(`card.html?address=${M}`));
  await p.waitForSelector("#card .notice.err");
  ok("card: node failure is reported as an error", (await p.textContent("#card")).includes("Could not read the milestone"));
  await p.goto(url("card.html"));
  await p.waitForSelector("#card .notice");
  ok("card: missing address explains how to open it", (await p.textContent("#card")).includes("?address=0x"));
  await p.close();
}
// ---- diagnose page (read-only report)
{
  const { p, errs } = await page("{}", { state: st(), att: "MET" });
  await p.goto(url(`diagnose.html?factory=${FACTORY}`));
  await p.waitForFunction(() => /Done\./.test(document.getElementById("out").textContent), null, { timeout: 8000 });
  ok("diagnose: reports on the factory and sends nothing", (await p.textContent("#out")).includes("== Factory") && (await p.textContent("#out")).includes("open this page with ?account=") && errs.length === 0, errs.join("|"));
  await p.close();
}
await browser.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
