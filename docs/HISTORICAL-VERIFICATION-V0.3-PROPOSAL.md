# v0.3 historical verification proposal — not implemented or deployed

Status: design only. Existing v0.1.0/v0.2.0 MET/NOT_MET semantics, source bytes, constructors, deployed addresses and historical verdicts stay unchanged. No migration or transaction is part of this change.

## Guarantees

Keep `current_verdict` separate from a new, per-check `historical_status`:

- `VERIFIED_BEFORE_DEADLINE`: an authenticated timestamped commitment binds the exact requirement and evidence identity to a time at or before the deadline.
- `VERIFIED_LATE`: an authenticated commitment establishes the requirement was only satisfied after the deadline under the specified evidence policy.
- `UNKNOWN`: no supported independent timestamp/commitment is available. Current PASS must never upgrade UNKNOWN.

A release's published_at establishes reported release publication only. It does not date present release notes, assets, or arbitrary deliverables. A Git commit's author/committer date is self-declared; a SHA pins bytes, not when they existed. HTTP Last-Modified, user notes, model output and the current page are not independent historical proof.

## Needed before implementation

Choose and document an independent timestamp authority or pre-deadline on-chain evidence commitment mechanism, its authentication, availability and replay/domain policy. Bind the source, requirement, milestone identity and evidence digest; specify canonicalization and time precision. Do not treat a generic HTTPS response as an immutable historical proof. A commitment dates bytes; verifying that those bytes satisfy a requirement is a separate check. No escrow, tokens, payments or custody are needed.

Do not change the existing attestation string in place. A new version must expose the verification mode/policy, source version, per-check temporal status and evidence identity in its attestation. Preserve current-source availability/recheck results separately from historical proof so an outage cannot rewrite established history. Specify how amendments bind a new target without altering prior history or silently replacing the promised criteria.

## Acceptance cases for that future implementation

1. A current page first read after the deadline, even if PASS, has historical UNKNOWN.
2. A mutable file updated after the deadline cannot reuse proof for different bytes.
3. A valid authenticated pre-deadline commitment for the matching bytes and requirement can establish historical verification.
4. Missing, forged, expired-policy, wrong-source, wrong-milestone and post-deadline commitments cannot establish pre-deadline verification.
5. Release publication timestamps do not authenticate subsequently changed content.
6. A disappearing current source produces ERROR/availability information without inventing a historical FAIL.
7. Provisional/final evidence identities and round-specific results remain distinguishable.
8. Old contracts remain readable with their original meaning; unknown policies fail closed.

Executable compatibility tests in `tests/direct/test_evidence_guarantees.py` pin the existing behavior (including late-appearing evidence and changing per-check maps). These are tests of v0.2.0 guarantees, not an implementation or validation of this future historical protocol. The future acceptance cases above remain unimplemented and unrun.

## Factory version proposal

A future factory v0.2 should explicitly identify its implementation/policy and bind an approved child source digest. Approval must be defined independently of the factory's self-reported getter, and clients must authenticate the actual factory implementation and chain identity. Pinning a supplied hash alone is insufficient.

For record consistency additionally require matching final round, FINALIZED phase in the final history row, and matching result maps. These checks strengthen consistency but cannot make malicious source truthful. Retain membership, funder/builder/title checks and duplicate prevention. Resolve the network-finalized-read question through independently reproduced runtime evidence before claiming finalized state guarantees. Provide an exact transaction-specific child identity through a documented, verified runtime return schema or a versioned creation identifier; do not infer it from funder/builder/title.
