# Phase D staging image cleanup — code-only review

Issue: #195

## Scope

This change adds a distinct `--phase-d-recovery-execute` mode to the reviewed staging retention script. It is intentionally separate from the consumed Phase C `--batch2-recovery-execute` path.

Pinned Phase D candidates:

- `4a29bc44d34b7f609b223987735507abff68641d`
  - API `sha256:4d2ff2b68cfa70b817188e336f0e7ee5141b8779e46f52d9d3c925b2fec9060c`
  - Worker `sha256:7d5d3c5fd943d7c2d539a2f55468b530da480c1988739bd373d09b23389955e2`
- `4b53315bed756bf5888aa96683454a4add5c7b80`
  - API `sha256:5050682df3ebf4f557ce13196b155e6f6da28c539711a994e014828f39685452`
  - Worker `sha256:cd2d14433275772b3d4dc34efe6935e21558139fe3ab2fae30333188038cacc3`

## Required execution gates

- distinct `STAGING_PHASED_EXECUTE_ENABLED=true`
- distinct owner approval ID beginning `XIAOHAI-195-PHASED-`
- exact approved two-row manifest
- fresh recovery evidence line for snapshot `s-j6cazgfr54fw87udingl` with `accomplished/100%` and source disk `d-j6c6f95ns1nggo7h11io`
- historical failed workflow acknowledgement remains explicit; do not spoof success
- current + two rollback + extra + five HOLD pairs remain protected
- all running/stopped container refs, aliases and bounded deployment configs are checked
- services, volumes, PostgreSQL, Redis, HTTPS, lock, disk and inode gates remain unchanged
- at most two revision pairs; stop if safe capacity target is reached after first pair
- no prune, force, volume/database/snapshot deletion, rollback or silent retry

## Current operational evidence

Phase C completed successfully and consumed its authorization. Root filesystem moved from 81% / 9.1G free to 76% / 12G free. A subsequent read-only plan proposed exactly the two Phase D revisions above. `STAGING_READY=false` remains.

This PR is code-only. It does not install the script or delete any image. Installation and live execution require Fred's current-head review plus the separately scoped Phase D authorization and a fresh on-host preflight.
