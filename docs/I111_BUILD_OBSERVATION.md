# I111 offline build observations (not a runtime attestation)

`scripts/i111-build-attestation.mjs` is a read-only **review aid**. It records the
checked-out Git HEAD/tree, SHA-256 digests of a fixed allowlist of tracked
I111 source/toolchain inputs and *all files* under `apps/api/dist` and
`apps/worker/dist`, together with the observing Node version and platform.

It never builds, loads environment files, contacts external services, verifies
owner approval or authorizes an operation. It does not expose an executable
I111 coordinator, provider call or runtime admission port.

To obtain two observations, use separate, clean, isolated worktrees built by
independently controlled offline procedures. After each build, import
`observeI111BuildArtifacts(canonicalAbsoluteRootPath, { head, tree })`, where
`head` and `tree` are the **externally reviewed, immutable** expected Git
identities, not values derived from the candidate checkout. Pass a canonical
`realpath()` for the root (on macOS the temp directory may resolve from `/var`
to `/private/var`). Retain each returned JSON outside the worktree. Then
compare the results using
`compareI111BuildObservations(first, second)`.

Both returned verdicts are deliberately limited:

- `OBSERVED_ONLY`: the local snapshot was read successfully.
- `MATCHING_OBSERVATIONS_ONLY`: two supplied snapshots report the same checked
  out HEAD/tree and the same source/dist bytes and metadata.
- `STOP`: the current observation failed or the two snapshots differ.

**None** of these means a trusted build or a permitted paid run. The observer
does not prove that `dist` was produced from the recorded Git tree. Its source
allowlist is not a complete dependency graph; untracked/ignored inputs,
dependency cache, build-time environment, and a compromised observer are not
independently ruled out. The `pnpm` version is only declared in tracked
`package.json`, not independently measured here. An attacker can forge
two internally self-consistent observations or tamper with compiled code after
observation. The comparator validates the JSON schema and recomputes its
digest, but does not authenticate who created the JSON. Both source and dist
are sampled twice with Git identity/clean-status checks before and after;
these are *not* an atomic filesystem snapshot and cannot eliminate a brief
substitution that is restored between samples. A second
independent reviewer must check immutable input/lockfile provenance, offline
clean builds, trusted toolchain and artifact custody, and exact runtime
artifact identity separately.

`paidExecutionAuthorized` and `verifiedBuildProvenance` are always `false`.
This module is not connected to `i111-readonly-runtime-preflight.mjs` or to a
live coordinator. All four existing I111 unconditional STOP conditions remain
in force. Never use matching observations to bypass grants, locks, trusted
snapshots, private BOS, retry guarantees, pricing, or independent final evidence.
