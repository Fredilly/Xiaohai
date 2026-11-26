# Issue #195 — proposal to graduate temporary HOLD releases (NOT APPROVED)

This is an **independent future retention-policy proposal**, not an operational or code authorization to delete anything. The live retention script and PR #202 continue to protect **all nine presently held API+Worker release pairs**, including all five provisional 2026-11-05 HOLDs. No HOLD expires automatically.

## Two unrelated snapshot classes

- **containerd snapshots**: committed/unpacked filesystem layers referenced by image manifests, other layers, containers or containerd leases. The 335 measured local snapshots are **not** 335 VM backups. Never manually remove containerd filesystem paths, `ctr snapshots rm`, broad Docker `prune` or any infrastructure/unknown image.
- **Alibaba system disk snapshots**: VM recovery backups, separate from containerd. Retain both the existing Oct 30 backup and Nov 5 snapshot `s-j6ccgk5wyg44gmzqgf5v` during this incident. A later independent backup retention decision needs validated restore/recovery coverage.

## Currently mandatory hold set (no changes)

- Current running revision: `e4c1117e99e1d739b002f99be3b97be7ede89121`.
- Extra historical: `e38a1796b7f6eb08a7b10932567c5b781eed606c`.
- Designated rollbacks: `f8e1fe86bbb904a4e7871901442a5b3dac7890e0`, `d79ca0ff400f52f05a140235565b9c981163ead5`.
- Five additional provisional releases: `03f5ee0f3d364597739162ca8661ebc993523ead`, `12091f5d8586809ebb5d43308582797d00b3ba79`, `662ca971de6cae265d810b7e37e74eb1ce836abc`, `ecaea1f231469903e3eaa9dedad437f37d0d78c5`, `ecc03badca74669d85f5c7b69915b81967d39825`.

All nine release pairs are protected now, even if they appear unreferenced. Container references (including stopped), Postgres/Redis/Caddy, unknown, dangling and all named volumes are additionally protected.

## Proposed transition: no automatic expiration

**Phase A — validated successor**: a newer *actually successful*, current-head deployment has completed all CI, pre- and post-disk/inode gates and readiness checks; version/image digest and schema compatibility are independently recorded. A failed workflow that left healthy containers is **not** a successful deployment. Preserve at least two separately proven rollback **release pairs**, distinct from the current and from one additional historically retained release. Verify rollback viability by a separately approved non-destructive rehearsal, not by image presence alone.

**Phase B — independent owner review**: generate a dedicated review-only PR/ADR that identifies *each* proposed provisional HOLD to release, current/rollback/extra protected mapping, all candidate exact API/Worker SHA256 IDs, running/stopped references, aliases, external-config references and the snapshot/database recovery evidence. Report physical exclusive bytes with shared-layer/lease uncertainty. The reviewer must explicitly accept this new policy and an exact-ID deletion plan in separate records. Until then, the five original HOLD pairs remain protected.

**Phase C — explicit rollout**: only a later operational approval, current fresh host health and inventory, a genuine deploy-success record, concurrency lock and verified exact-ID manifest may authorize a bounded single-use removal. Measure real `df` after containerd-managed GC and review the health/inode states after each release pair. Any protected image, DB/volume, unknown image or manifest mismatch is a hard stop.

**Cloud backup retention** must remain a separate owner decision after restore checks, never inferred from the above containerd image lifecycle.

## Success criteria (code-only future PR)

1. Given an unapproved HOLD transition request, fail closed even if the date has passed and no container references it.
2. Given current/rollback missing or non-unique image IDs, reject transition.
3. Given missing independent owner approval or incomplete snapshot/recovery proof, reject transition.
4. Given a real reviewed change with exact IDs but no **separate operational approval**, reject live execution.
5. Given a genuinely approved new protected set, verify all running/stopped container references and infrastructure/unknown tags still survive; no Docker prune or containerd filesystem mutation.

**Current implementation:** the original five provisional HOLD identities remain hard-coded to guard against accidental removal. Do NOT change that allowlist in this PR. A later individually approved policy migration can move it to a versioned manifest with explicit owner signatures and safe defaults, but introducing a new manifest does not, by itself, approve releasing any of the five.
