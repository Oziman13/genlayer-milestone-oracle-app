// Read-only Chromium regressions: all RPC is mocked; signing methods are forbidden.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {abi} from 'genlayer-js';
import {fromRlp, getAddress} from 'viem';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(process.env.MO_TEST_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const A='0x'+'a1'.repeat(20), B='0x'+'b2'.repeat(20), M='0x'+'d4'.repeat(20), N='0x'+'d5'.repeat(20), F='0x'+'f1'.repeat(20);
const DEMO='0x123352e162Fa441Ba1C4252662A7d00EC05fb737';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+5000;while(!fn()){if(Date.now()>end)throw Error('Timed out waiting for mocked request');await pause(10);}}
const state=(title='Milestone M',over={})=>({title,funder:A,builder:B,deadline_date:'2026-10-31',checks:[{id:'live',kind:'LIVE_PAGE',url:'https://example.org/',phrase:'Milestone'}],round:1,final_round:0,amendments:0,phase:'PROVISIONAL',finalized:0,final_verdict:'NONE',latest_verdict:'MET',latest_results:{live:'PASS'},history_count:0,window_end:1,window_seconds:300,candidate:'MET',...over});
const row=(i=0)=>({milestone:'0x'+(100+i).toString(16).padStart(40,'0'),title:i?'Long title '+ 'X'.repeat(180):'Milestone record',verdict:i%2?'NOT_MET':'MET',finalized_at:1790000000+i,amendments:i%4,funder:A});
const summary=(builder=B,title='Builder record')=>({builder,created:1,milestones:[{...row(),title}]});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.py':'text/plain','.png':'image/png','.md':'text/markdown'};
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.resolve(ROOT,'.'+pathname);
 if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const ORIGIN=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
let completed=0;
async function fixture({width=390,initialProvider=false,factory=F}={}){
 const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:width===390});
 const p=await ctx.newPage(), errors=[],requests=[],gates=[];
 p.on('pageerror',e=>errors.push(String(e)));
 const data={states:{[M]:state(),[N]:state('Milestone N',{phase:'IDLE',window_end:0,latest_verdict:'NONE',latest_results:{}})},summary:summary(),record:'NONE'};
 const reads=async ({fn,args,to})=>{
  if(fn==='get_state_json')return JSON.stringify(data.states[to]||state());
  if(fn==='get_attestation')return 'NONE';
  if(fn==='get_history_json')return JSON.stringify({action:'ASSESS',phase:'PROVISIONAL',verdict:'MET',timestamp:1790000000,caller:A,results:{live:'PASS'}});
  if(fn==='get_builder_summary')return JSON.stringify(data.summary);
  if(fn==='is_factory_milestone')return true;
  if(fn==='get_record')return data.record;
  return 'NONE';
 };
 const c={p,ctx,errors,requests,data,read:reads,nonce:async()=> '0x0'};
 await p.addInitScript(({account,initial})=>{
  window.providerRequests=[];window.providers={};
  window.installProvider=(id,withEvent=true)=>{
   if(!window.providers[id]){
    const listeners={};const provider={account,chain:'0xf22f',
     on(event,fn){(listeners[event]||= []).push(fn);},
     listenerCount(event){return (listeners[event]||[]).length;},
     emit(event,value){if(event==='accountsChanged')this.account=value[0];if(event==='chainChanged')this.chain=value;for(const fn of listeners[event]||[])fn(value);},
     async request({method}){
      window.providerRequests.push({id,method});
      if(method==='eth_requestAccounts'||method==='eth_accounts')return this.account?[this.account]:[];
      if(method==='eth_chainId')return this.chain;
      if(method==='wallet_switchEthereumChain'){this.chain='0xf22f';return null;}
      if(method==='wallet_addEthereumChain')return null;
      throw Error('Signing/unsupported wallet method forbidden in correctness tests: '+method);
     }};
    window.providers[id]=provider;
   }
   window.ethereum=window.providers[id];
   if(withEvent)window.dispatchEvent(new Event('ethereum#initialized'));
  };
  if(initial)window.installProvider('first',false);
 },{account:A,initial:initialProvider});
 await p.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===ORIGIN){
   if(url.pathname==='/web/config.js')return route.fulfill({status:200,contentType:'text/javascript',body:`window.MO_CONFIG=${JSON.stringify({FACTORY:factory,LIVE_EXAMPLE:'',EXAMPLE_BUILDER:'',REPO_CONTRACT:'https://github.com/Oziman13/genlayer-milestone-oracle',REPO_APP:'https://github.com/Oziman13/genlayer-milestone-oracle-app'})};`});
   return route.continue();
  }
  if(url.hostname!=='studio.genlayer.com')return route.fulfill({status:200,contentType:'text/css',body:''});
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=JSON.parse(req.postData());const list=Array.isArray(body)?body:[body];
  const values=await Promise.all(list.map(async rpc=>{
   try{
    let value;
    if(rpc.method==='gen_call'){
     const [encoded]=fromRlp(rpc.params[0].data);
     const decoded=abi.calldata.decode(Buffer.from(encoded.slice(2),'hex'));
     const call={fn:decoded.get('method'),args:decoded.get('args')||[],to:rpc.params[0].to.toLowerCase()};
     requests.push(call);value=await c.read(call,reads);call.completed=true;
     value=Buffer.from(abi.calldata.encode(value)).toString('hex');
    }else if(rpc.method==='eth_getTransactionCount'){requests.push({fn:'nonce'});value=await c.nonce();}
    else if(rpc.method==='eth_chainId')value='0xf22f';
    else if(rpc.method==='sim_getTransactionsForAddress')value=[];
    else if(rpc.method==='eth_getTransactionByHash')value=null;
    else throw Error('Non-read RPC forbidden: '+rpc.method);
    return {jsonrpc:'2.0',id:rpc.id,result:value};
   }catch(e){return {jsonrpc:'2.0',id:rpc.id,error:{code:-32000,message:e.message}};}
  }));
  await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(Array.isArray(body)?values:values[0])}).catch(()=>{});
 });
 c.open=async(url='app.html')=>p.goto(ORIGIN+'/web/'+url);
 c.loaded=()=>p.waitForFunction(()=>document.getElementById('loadmsg').textContent==='Loaded.');
 c.connect=async()=>{await p.click('#connect');await p.waitForFunction(()=>document.getElementById('wstatus').textContent.startsWith('Connected:'));};
 c.load=async a=>{await p.fill('#addr',a);await p.click('#load');};
 c.gate=()=>{const g=deferred();gates.push(g);return g;};
 c.close=async()=>{for(const g of gates)g.resolve('NONE');await ctx.close();};
 return c;
}
async function check(name,options,fn){await test(name,async()=>{const c=await fixture(options);try{await fn(c);assert.deepEqual(c.errors,[]);assert.equal(await c.p.evaluate(()=>window.providerRequests.some(r=>/sign|sendTransaction/i.test(r.method))),false);completed++;}finally{await c.close();}});}
try {
 for(const phase of ['get_state_json','get_attestation','get_history_json','is_factory_milestone','get_record']){
  await check(`P1: stale ${phase} cannot overwrite a newer milestone`,{initialProvider:true},async c=>{
   c.data.states[M]=state('Old M',{history_count:1,phase:'FINALIZED',finalized:1,final_verdict:'MET'});
   const gate=c.gate();let held=false;
   c.read=async(call,normal)=>{if(call.fn===phase&&!held&&(call.to===M||phase.startsWith('is_factory')||phase==='get_record')){held=true;await gate.promise;}return normal(call);};
   await c.open(`app.html?address=${M}`);await until(()=>held);await c.load(N);await c.loaded();
   gate.resolve();await until(()=>c.requests.some(r=>r.fn===phase&&r.completed));await c.p.waitForTimeout(100);
   assert.equal(await c.p.locator('#title').innerText(),'Milestone N');assert.equal(await c.p.inputValue('#addr'),N);
   assert.equal(await c.p.locator('#phase').innerText(),'IDLE');assert.match(await c.p.getAttribute('#cardlink','href'),new RegExp(getAddress(N)));
   await c.connect();assert.equal(await c.p.locator('#b_fin').isDisabled(),true);assert.equal(await c.p.locator('#b_start').isEnabled(),true);
  });
 }
 for(const oldFails of [false,true]){
  await check(`P1: ${oldFails?'stale failure preserves new success':'stale success cannot resurrect failed selection'}`,{},async c=>{
   const gate=c.gate();let held=false;
   c.read=async(call,normal)=>{if(call.fn==='get_state_json'&&call.to===M){held=true;await gate.promise;if(oldFails)throw Error('old failed');}if(call.fn==='get_state_json'&&call.to===N&&!oldFails)throw Error('new failed');return normal(call);};
   await c.open(`app.html?address=${M}`);await until(()=>held);await c.load(N);
   if(oldFails)await c.loaded();else await c.p.waitForFunction(()=>document.getElementById('loadmsg').textContent.includes('Could not read'));
   gate.resolve();await c.p.waitForTimeout(150);
   if(oldFails)assert.equal(await c.p.locator('#title').innerText(),'Milestone N');else {assert.equal(await c.p.locator('#app').isHidden(),true);assert.equal(await c.p.locator('#b_fin').isDisabled(),true);}
  });
 }
 await check('P1: editing an address invalidates actions and pending refresh (including A-B-A)',{initialProvider:true},async c=>{
  await c.open(`app.html?address=${M}`);await c.loaded();await c.connect();assert.equal(await c.p.locator('#b_fin').isEnabled(),true);
  const gate=c.gate();let held=false;c.read=async(call,normal)=>{if(call.fn==='get_state_json'){held=true;await gate.promise;}return normal(call);};
  await c.p.click('#refresh');await until(()=>held);await c.p.fill('#addr',N);await c.p.fill('#addr',M);gate.resolve();await c.p.waitForTimeout(150);
  assert.equal(await c.p.locator('#app').isHidden(),true);assert.equal(await c.p.locator('#b_fin').isDisabled(),true);
 });
 await check('P1: address changes during preflight abort before any signing request',{initialProvider:true},async c=>{
  await c.open(`app.html?address=${M}`);await c.loaded();await c.connect();const gate=c.gate();let held=false;
  c.nonce=async()=>{if(!held){held=true;await gate.promise;}return '0x0';};
  await c.p.click('#b_fin');await until(()=>held);await c.p.fill('#addr',N);gate.resolve();
  await c.p.waitForFunction(()=>document.getElementById('txmsg').textContent.includes('selected contract changed'));
  assert.equal(await c.p.locator('#b_fin').isDisabled(),true);assert.equal(await c.p.evaluate(()=>localStorage.getItem('mo_pending_tx')),null);
 });
 for(const width of [360,390,768,1440])for(const factory of [F,DEMO]){
  await check(`P1: ${width}px ${factory===F?'custom':'demo'} Factory badge shows compact provenance`,{width,factory},async c=>{
   await c.p.setViewportSize({width,height:150});await c.open(`builder.html?builder=${B}&badge=1`);await c.p.waitForSelector('.counts');
   assert.equal(await c.p.locator('#factory-provenance').isVisible(),true);
   const text=await c.p.locator('#factory-provenance').innerText();assert.ok(text.includes(getAddress(factory)));assert.match(text,factory===F?/Unverified custom Factory/:/Known demo Factory/);assert.match(text,/network finality unverified/);
   assert.ok((await c.p.locator('.counts').boundingBox()).y+(await c.p.locator('.counts').boundingBox()).height<=150);
  });
 }
 for(const emitEvent of [true,false])await check(`P1: delayed provider injection ${emitEvent?'with discovery event':'without event'} binds once`,{},async c=>{
  await c.open();assert.equal(await c.p.locator('#mobile-wallet-help').isVisible(),true);
  await c.p.evaluate(event=>window.installProvider('late',event),emitEvent);
  await c.p.waitForFunction(()=>window.ethereum.listenerCount('accountsChanged')===1);
  await c.connect();assert.equal(await c.p.locator('#mobile-wallet-help').isHidden(),true);
  await c.p.evaluate(()=>{for(let i=0;i<3;i++)window.dispatchEvent(new Event('ethereum#initialized'));});
  assert.deepEqual(await c.p.evaluate(()=>['accountsChanged','chainChanged','disconnect'].map(e=>window.ethereum.listenerCount(e))),[1,1,1]);
  await c.p.evaluate(b=>window.ethereum.emit('accountsChanged',[b]),B);assert.match(await c.p.locator('#wstatus').innerText(),new RegExp(B));
  await c.p.evaluate(()=>window.ethereum.emit('chainChanged','0x1'));assert.match(await c.p.locator('#wmsg').innerText(),/Wrong network/);
  await c.p.evaluate(()=>{localStorage.setItem('mo_pending_tx',JSON.stringify({stage:'ambiguous',hash:'0xabc',label:'existing',fn:'assess'}));window.ethereum.emit('disconnect',{code:4900});});
  assert.match(await c.p.locator('#wmsg').innerText(),/disconnected/);assert.ok(await c.p.evaluate(()=>localStorage.getItem('mo_pending_tx')));
 });
 await check('P1: replacement provider clears connection and ignores old events',{initialProvider:true},async c=>{
  await c.open(`app.html?address=${M}`);await c.loaded();await c.connect();await c.p.evaluate(()=>window.installProvider('second'));
  assert.equal(await c.p.locator('#wstatus').innerText(),'Not connected.');await c.connect();
  await c.p.evaluate(b=>window.providers.first.emit('accountsChanged',[b]),B);assert.match(await c.p.locator('#wstatus').innerText(),new RegExp(A));
  await c.p.evaluate(()=>{delete window.ethereum;window.dispatchEvent(new Event('ethereum#initialized'));});
  assert.match(await c.p.locator('#wstatus').innerText(),/No browser wallet/);assert.equal(await c.p.locator('#mobile-wallet-help').isVisible(),true);
 });
 for(const page of ['app.html','deploy-factory.html'])await check(`P1: ${page} disconnect during connection cannot revive an old account`,{initialProvider:true},async c=>{
  await c.open(page);
  await c.p.evaluate(()=>{
   const p=window.ethereum,original=p.request.bind(p);
   p.request=async args=>args.method==='eth_requestAccounts'?new Promise(resolve=>window.releaseAccounts=()=>resolve([p.account])):original(args);
  });
  await c.p.click('#connect');await c.p.waitForFunction(()=>typeof window.releaseAccounts==='function');
  await c.p.evaluate(()=>{window.ethereum.emit('disconnect',{code:4900});window.releaseAccounts();});
  await c.p.waitForFunction(selector=>/changed during connection|account changed/.test(document.querySelector(selector).textContent),page==='app.html'?'#wmsg':'#msg');
  assert.doesNotMatch(await c.p.locator(page==='app.html'?'#wstatus':'#who').innerText(),/^Connected:/);
 });
 for(const oldFails of [false,true])await check(`P2: Builder out-of-order ${oldFails?'failure':'success'} cannot replace latest result`,{},async c=>{
  const gate=c.gate();let count=0;c.read=async(call,normal)=>{if(call.fn==='get_builder_summary'){const index=++count;if(index===1){await gate.promise;if(oldFails)throw Error('old failed');return JSON.stringify(summary(B,'Old Builder'));}return JSON.stringify(summary(A,'New Builder'));}return normal(call);};
  await c.open(`builder.html?builder=${B}`);await until(()=>count===1);await c.p.fill('#builder',A);await c.p.click('#go');await c.p.waitForSelector('.ledger-mobile-title');gate.resolve();await c.p.waitForTimeout(150);
  assert.equal(await c.p.locator('.ledger-mobile-title').innerText(),'New Builder');assert.match(await c.p.locator('#out h2').innerText(),/a1a1/);
 });
 await check('P2: latest failed Builder query stays failed after older success',{},async c=>{
  const gate=c.gate();let count=0;c.read=async(call,normal)=>{if(call.fn==='get_builder_summary'){if(++count===1){await gate.promise;return JSON.stringify(summary(B));}throw Error('latest failed');}return normal(call);};
  await c.open(`builder.html?builder=${B}`);await until(()=>count===1);await c.p.fill('#builder',A);await c.p.click('#go');await c.p.waitForSelector('#out .err');gate.resolve();await c.p.waitForTimeout(150);assert.match(await c.p.locator('#out').innerText(),/latest failed/);assert.equal(await c.p.locator('.ledger-mobile-card').count(),0);
 });
 for(const bad of ['invalid json','invalid timestamp','wrong builder'])await check(`P2: Builder rejects ${bad} without unhandled render errors`,{},async c=>{
  c.data.summary=bad==='invalid timestamp'?{...summary(),milestones:[{...row(),finalized_at:1e20}]}:summary(A);
  if(bad==='invalid json')c.read=async(call,normal)=>call.fn==='get_builder_summary'?'not JSON':normal(call);
  await c.open(`builder.html?builder=${B}`);await c.p.waitForSelector('#out .err');assert.doesNotMatch(await c.p.locator('#out').innerText(),/Reading the record/);
 });
 for(const page of ['workspace','card'])for(const bad of ['null check','history timestamp','history count'])await check(`P2: ${page} handles malformed ${bad}`,{},async c=>{
  c.data.states[M]=state('Malformed',{checks:bad==='null check'?[null]:state().checks,history_count:bad==='history count'?1e20:bad==='history timestamp'?1:0});
  c.read=async(call,normal)=>call.fn==='get_history_json'?JSON.stringify({action:'FINALIZE',timestamp:1e20}):normal(call);
  await c.open(`${page==='workspace'?'app':'card'}.html?address=${M}`);
  await c.p.waitForFunction(target=>/Could not|cannot read/.test(document.querySelector(target).textContent),page==='workspace'?'#loadmsg':'#card');
  if(page==='workspace')assert.equal(await c.p.locator('#b_fin').isDisabled(),true);
 });
 for(const width of [390,768,1440])await check(`P2: Proof Journey fits ${width}px and preserves keyboard/reduced motion`,{width},async c=>{
  await c.p.emulateMedia({reducedMotion:'reduce'});await c.open('index.html');assert.ok(await c.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await c.p.evaluate(()=>scrollTo({left:999,behavior:'instant'}));assert.equal(await c.p.evaluate(()=>scrollX),0);
  await c.p.locator('.pj-node-core').nth(2).focus();await c.p.keyboard.press('Enter');assert.equal(await c.p.locator('#pj-scene').getAttribute('data-scene'),'3');
 });
 for(const factory of [F,''])await check(`P2: creation explains ${factory?'Factory stored-source call':'direct source deployment'}`,{factory},async c=>{
  await c.open();await c.p.click('#newms');const text=await c.p.locator('#setup p.small').innerText();
  assert.match(text,factory?/stored Oracle source/:/code is fetched from this repository|source fetched from this repository/);if(factory)assert.ok(text.includes(getAddress(factory)));
 });
 await check('mobile cards: 100 records survive refresh without XSS, duplication or link drift',{},async c=>{
  c.data.summary={builder:B,created:100,milestones:Array.from({length:100},(_,i)=>({...row(i),title:i===0?'<img src=x onerror="window.bad=1">':row(i).title}))};
  await c.open(`builder.html?builder=${B}`);await c.p.waitForFunction(()=>document.querySelectorAll('.ledger-mobile-card').length===100);
  assert.equal(await c.p.locator('#out img').count(),0);assert.equal(await c.p.evaluate(()=>!!window.bad),false);
  for(let i=0;i<2;i++){await c.p.click('#go');await c.p.waitForFunction(()=>document.querySelectorAll('.ledger-mobile-card').length===100);}
  assert.equal(await c.p.locator('tbody tr').count(),100);assert.equal(await c.p.locator('.ledger-mobile-card').count(),100);
  assert.match(await c.p.locator('.ledger-mobile-view').first().getAttribute('href'),new RegExp('factory='+getAddress(F)));
 });
 for(const width of [390,768,1440])await check(`responsive smoke: workspace, ledger, Factory, card and diagnostics at ${width}px`,{width},async c=>{
  for(const url of [`app.html?address=${M}`,`builder.html?builder=${B}`,'deploy-factory.html',`card.html?address=${M}`,'diagnose.html','probe.html']){
   await c.open(url);
   if(url.startsWith('app'))await c.loaded();
   if(url.startsWith('builder'))await c.p.waitForSelector('.counts');
   if(url.startsWith('card'))await c.p.waitForSelector('#card figure');
   assert.ok(await c.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),url);
  }
 });
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
console.log(`${completed} correctness regressions completed; no signing requests`);
