// Deployment settings read by the landing, builder and card pages.
// FACTORY is empty until a MilestoneFactory has been deployed on Studionet; pages then say so honestly
// instead of showing sample numbers. Any page can be pointed at another factory with ?factory=0x...
window.MO_CONFIG = {
  FACTORY: "",
  // The one milestone that was run live on Studionet (v0.1.0, direct deploy, not part of any factory record).
  LIVE_EXAMPLE: "0xb222ae7ee55C8E71f11A6d97c49932DEA1177786",
  REPO_CONTRACT: "https://github.com/Oziman13/genlayer-milestone-oracle",
  REPO_APP: "https://github.com/Oziman13/genlayer-milestone-oracle-app",
};
