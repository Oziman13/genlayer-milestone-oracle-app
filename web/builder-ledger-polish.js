/* Builder Ledger presentation enhancement — no RPC, wallet or transaction access. */
(()=>{
  "use strict";
  const disclosure=document.getElementById("builder-network-content");
  const provenance=document.getElementById("factory-provenance");
  // Keep every provenance and finality caveat intact, including custom-factory warnings.
  if(disclosure&&provenance)disclosure.appendChild(provenance);
  const out=document.getElementById("out");
  if(!out)return;
  function enhance(){
    for(const link of out.querySelectorAll("tbody td:first-child a")){
      if(link.querySelector(".ledger-view-evidence"))continue;
      const hint=document.createElement("span");
      hint.className="ledger-view-evidence";
      hint.textContent="View evidence ↗";
      link.appendChild(hint);
    }
    // Set an explicit compact class only when exactly one row is present.
    const sheet=out.querySelector(".sheet");
    if(sheet)sheet.classList.toggle("ledger-single-record",out.querySelectorAll("tbody tr").length===1);
  }
  const observer=new MutationObserver(enhance);
  // The existing reader replaces #out.innerHTML on load; nested enhancements
  // should not themselves retrigger this direct-child observer.
  observer.observe(out,{childList:true});
  enhance();
})();
