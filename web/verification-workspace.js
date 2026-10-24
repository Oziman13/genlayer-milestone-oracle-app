/* Verification Workspace — presentation-only enhancement.
   Consumes already-rendered app DOM. No RPC, wallet, storage or contract calls. */
(()=>{
  "use strict";
  const $=id=>document.getElementById(id);
  const source=$("factory-provenance");
  const target=$("network-detail-body");
  if(source&&target){
    target.appendChild(source); // Preserve all existing provenance/limitations verbatim.
  }
  const app=$("app"),checks=$("checks"),phase=$("phase"),round=$("round");
  const summaryCount=$("summary-count"),summaryPhase=$("summary-phase"),summaryRound=$("summary-round");
  if(!app||!checks||!phase||!round||!summaryCount||!summaryPhase||!summaryRound)return;
  const set=(el,value)=>{if(el.textContent!==value)el.textContent=value};
  const update=()=>{
    const rows=[...checks.querySelectorAll(".crow")];
    const examined=rows.filter(row=>row.querySelector(".badge")).length;
    const passed=rows.filter(row=>row.querySelector(".badge.PASS")).length;
    set(summaryCount,rows.length?(examined?passed+" / "+rows.length:"— / "+rows.length):"—");
    set(summaryPhase,phase.textContent.trim()||"—");
    set(summaryRound,round.textContent.trim()||"—");
    app.dataset.verificationReady=String(!app.hidden&&rows.length>0);
  };
  // Observe only source containers to avoid self-triggering the observer.
  const observer=new MutationObserver(update);
  for(const sourceElement of [checks,phase,round]){
    observer.observe(sourceElement,{childList:true,subtree:true,characterData:true});
  }
  update();
})();
