// Deployment settings read by the landing, builder and card pages.
// FACTORY: MilestoneFactory v0.1.1 deployed on Studionet 2026-10-22 (v0.1.0 at 0x1C9eE0e275D03329a500fc654BD9dF6e90E882d3 could not record: its final-state read timed out) from the funder test account (code hash verified by the deploy page). Without a factory, pages say so honestly
// instead of showing sample numbers. Any page can be pointed at another factory with ?factory=0x...
window.MO_CONFIG = {
  FACTORY: "0x123352e162Fa441Ba1C4252662A7d00EC05fb737",
  // The one milestone that was run live on Studionet (v0.1.0, direct deploy, not part of any factory record).
  EXAMPLE_BUILDER: "0xabF20c3e89d0E1C37DEAeA3B44602F4838661160",
  LIVE_EXAMPLE: "0xDf63AB2C788c452e5E0088E6767Fe78e6e93ce30",
  REPO_CONTRACT: "https://github.com/Oziman13/genlayer-milestone-oracle",
  REPO_APP: "https://github.com/Oziman13/genlayer-milestone-oracle-app",
};
