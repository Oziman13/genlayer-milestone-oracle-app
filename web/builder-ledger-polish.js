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
    // A true mobile card renders the same already-escaped, read-only table data.
    // Preserve the original table for desktop and accessible fallback when JS is off.
    const table=out.querySelector(".sheet table");
    if(table){
      let cards=out.querySelector(".ledger-mobile-cards");
      if(!cards){
        cards=document.createElement("div");
        cards.className="ledger-mobile-cards";
        cards.setAttribute("aria-label","Milestone delivery records");
        table.insertAdjacentElement("afterend",cards);
      }
      const rows=[...table.querySelectorAll("tbody tr")];
      if(cards.children.length!==rows.length){
        cards.replaceChildren();
        rows.forEach((row,index)=>{
          const cells=[...row.querySelectorAll("td")];
          if(cells.length<5)return;
          const card=document.createElement("article");
          card.className="ledger-mobile-card";
          const header=document.createElement("div");
          header.className="ledger-mobile-card-header";
          const eyebrow=document.createElement("span");
          eyebrow.className="ledger-mobile-card-number";
          eyebrow.textContent="RECORDED MILESTONE / "+String(index+1).padStart(2,"0");
          const verdict=document.createElement("span");
          verdict.className="ledger-mobile-verdict";
          verdict.textContent=cells[1].textContent.trim();
          verdict.dataset.verdict=verdict.textContent;
          header.append(eyebrow,verdict);
          const title=document.createElement("a");
          title.className="ledger-mobile-title";
          const originalLink=cells[0].querySelector("a");
          if(originalLink){
            title.href=originalLink.getAttribute("href")||"#";
            title.textContent=originalLink.childNodes[0]?.textContent?.trim()||originalLink.textContent.replace("View evidence ↗","").trim();
          }else{
            title.textContent=cells[0].textContent.trim();
            title.removeAttribute("href");
          }
          const dl=document.createElement("dl");
          dl.className="ledger-mobile-facts";
          for(const [label,i] of [["Finalized",2],["Amendments",3],["Funder",4]]){
            const dt=document.createElement("dt");dt.textContent=label;
            const dd=document.createElement("dd");dd.textContent=cells[i].textContent.trim();
            dl.append(dt,dd);
          }
          const view=document.createElement("a");
          view.className="ledger-mobile-view";
          view.href=title.getAttribute("href")||"#";
          view.textContent="View evidence and history ↗";
          card.append(header,title,dl,view);
          cards.appendChild(card);
        });
      }
      table.classList.add("ledger-desktop-table");
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
