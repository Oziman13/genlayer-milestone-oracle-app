/* Informational only. Never requests a wallet connection, chain switch or signature. */
(()=>{
  "use strict";
  const panel=document.getElementById("mobile-wallet-help");
  const copy=document.getElementById("copy-wallet-url");
  const status=document.getElementById("copy-wallet-message");
  if(!panel||!copy||!status)return;
  const isMobile=matchMedia("(max-width: 720px), (pointer: coarse)").matches;
  const injected=!!(window.ethereum&&typeof window.ethereum.request==="function");
  panel.hidden=!isMobile||injected;
  copy.addEventListener("click",async()=>{
    try{
      await navigator.clipboard.writeText(location.href);
      status.textContent="Link copied. Paste it into your wallet's built-in browser.";
    }catch{
      status.textContent="Copy the page address from your browser's address/share menu.";
    }
  });
})();