#!/usr/bin/env python3
"""Bounded read-only containerd snapshot/content accounting for Issue #195.

Do not run any delete, prune, garbage collection, mount, diff or unpack.
The emitted candidate-exclusive bytes are a *model upper bound*, not a promise
that containerd GC will release exactly this much space after a tag deletion.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

REVISIONS = (
    "1138ce2734533ae64e37eaccb2a833d9fa847515",
    "14d59d3cd209a400f397fdff1880b4f02ab26d54",
)
EXPECTED = {
    ("api", REVISIONS[0]): "sha256:426eca170257042c73941d6920e0828304daa34020f86e3858f375b42b17ea2d",
    ("worker", REVISIONS[0]): "sha256:80f9bebe35e74e43da0cf49ca03f5abef8229ec179e600c0bbc1767ca9c00001",
    ("api", REVISIONS[1]): "sha256:7fcd05927e19fe566301516fdce1d3ab2297c8ef88b27454c16299d2e321fb96",
    ("worker", REVISIONS[1]): "sha256:9d2b3678ad02365397724f7ea1a57fac77e6654e45e57c3c0031314fb728fe7f",
}
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
ROOT = Path("/var/lib/containerd/io.containerd.content.v1.content/blobs/sha256")


def run(args, seconds=25):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=seconds, check=False)
    except (subprocess.TimeoutExpired, OSError) as exc:
        raise RuntimeError(f"read-only command unavailable/timeout: {args[0]} {args[1:3]}") from exc
    if p.returncode:
        raise RuntimeError(f"read-only command failed rc={p.returncode}: {args[0]} {args[1:3]}")
    return p.stdout


def chain_ids(diffids):
    prev = None
    for item in diffids:
        if not isinstance(item, str) or not DIGEST.fullmatch(item):
            raise ValueError("invalid RootFS diffID")
        prev = item if prev is None else "sha256:" + hashlib.sha256((prev + " " + item).encode()).hexdigest()
        yield prev


def snapshot_records(table):
    result = {}
    for row in table.splitlines()[1:]:
        parts = row.split()
        if len(parts) >= 2 and DIGEST.fullmatch(parts[0]):
            parent = parts[1] if DIGEST.fullmatch(parts[1]) else None
            kind = parts[2] if parent and len(parts) > 2 else parts[1]
            result[parts[0]] = (parent, kind)
    return result


def usage_records(table):
    result = {}
    for row in table.splitlines()[1:]:
        parts = row.split()
        if len(parts) >= 3 and DIGEST.fullmatch(parts[0]) and parts[1].isdigit():
            result[parts[0]] = int(parts[1])
    return result


def content_stat(digest):
    if not DIGEST.fullmatch(digest):
        raise ValueError("invalid content digest")
    path = ROOT / digest.split(":")[1]
    stat = path.lstat()
    if not path.is_file() or path.is_symlink():
        raise RuntimeError("content blob is absent, nonregular, or linked")
    # st_blocks tracks allocated disk blocks; st_size is logical blob length.
    return stat.st_blocks * 512


def parse_content_tree(digest, visited, max_nodes=800):
    if digest in visited:
        return
    if len(visited) >= max_nodes:
        raise RuntimeError("bounded OCI graph exceeds 800 blobs")
    visited.add(digest)
    path = ROOT / digest.split(":")[1]
    # Use logical length for the document read cap, not allocated st_blocks:
    # a sparse content blob could have very few allocated blocks.
    content_stat(digest)
    if path.stat().st_size > 1048576:
        # Large compressed layer blobs are data, not OCI manifest documents.
        return
    raw = path.read_bytes()
    try:
        obj = json.loads(raw)
    except (ValueError, UnicodeError):
        return
    if not isinstance(obj, dict):
        return
    next_refs = []
    for desc in obj.get("manifests", []):
        if isinstance(desc, dict):
            next_refs.append(desc.get("digest"))
    config = obj.get("config")
    if isinstance(config, dict):
        next_refs.append(config.get("digest"))
    for desc in obj.get("layers", []):
        if isinstance(desc, dict):
            next_refs.append(desc.get("digest"))
    for ref in next_refs:
        if not isinstance(ref, str) or not DIGEST.fullmatch(ref):
            raise RuntimeError("OCI descriptor has invalid digest")
        parse_content_tree(ref, visited, max_nodes)


def main():
    print("=== containerd physical footprint, read-only ===")
    driver = run(["docker", "info", "--format", "{{json .DriverStatus}}"], 10)
    if "io.containerd.snapshotter.v1" not in driver:
        raise RuntimeError("unexpected Docker image storage mode")
    if not ROOT.is_dir() or ROOT.is_symlink():
        raise RuntimeError("unexpected content store root")

    image_ids = sorted(set(run([
        "docker", "image", "ls", "-a", "--no-trunc", "--format", "{{.ID}}"
    ], 15).split()))
    if not image_ids or len(image_ids) > 500:
        raise RuntimeError("unbounded or empty image inventory")

    images = {}
    tag_to_id = {}
    usage_owners = defaultdict(set)
    for image_id in image_ids:
        obj = json.loads(run(["docker", "image", "inspect", image_id], 10))[0]
        actual_id = obj.get("Id")
        if not DIGEST.fullmatch(actual_id):
            raise RuntimeError("invalid Docker image ID")
        tags = obj.get("RepoTags") or []
        images[actual_id] = tags
        for tag in tags:
            tag_to_id[tag] = actual_id
        layers = (obj.get("RootFS") or {}).get("Layers") or []
        for key in chain_ids(layers):
            usage_owners[key].add(actual_id)

    candidate = set()
    pair_ids = defaultdict(set)
    for (role, rev), expected in EXPECTED.items():
        tag = f"ghcr.io/fredilly/xiaohai-{role}:{rev}"
        if tag_to_id.get(tag) != expected:
            raise RuntimeError(f"candidate exact image ID changed for role={role} revision={rev[:8]}")
        if images[expected] != [tag]:
            raise RuntimeError("candidate has unexpected alias; halt accounting")
        candidate.add(expected)
        pair_ids[rev].add(expected)

    all_containers = run(["docker", "ps", "-aq", "--no-trunc"], 10).split()
    for container_id in all_containers:
        obj = json.loads(run(["docker", "inspect", container_id], 10))[0]
        if obj.get("Image") in candidate:
            raise RuntimeError("a container still references candidate image")
    snapshot_table = run([
        "sudo", "-n", "ctr", "-n", "moby", "snapshots",
        "--snapshotter", "overlayfs", "ls"
    ], 30)
    snapshots = snapshot_records(snapshot_table)
    if not snapshots:
        raise RuntimeError("no containerd overlay snapshot metadata discovered")

    # ctr snapshot Usage for committed keys is stored in snapshot metadata,
    # avoiding per-layer filesystem traversal.
    committed = [k for k, (_,kind) in snapshots.items() if kind.lower() == "committed"]
    snap_sizes = {}
    for i in range(0,len(committed),40):
        batch = committed[i:i+40]
        table = run([
            "sudo", "-n", "ctr", "-n", "moby", "snapshots",
            "--snapshotter", "overlayfs", "usage", "-b", *batch
        ], 35)
        snap_sizes.update(usage_records(table))
    if any(key not in snap_sizes for key in committed):
        raise RuntimeError("incomplete committed snapshot Usage metadata")

    # Any out-of-inventory snapshot child can retain a candidate-only parent.
    children = defaultdict(set)
    for key, (parent, _) in snapshots.items():
        if parent:
            children[parent].add(key)

    def has_external_descendant(key, exclusive, visited=None):
        visited = set() if visited is None else visited
        for child in children[key]:
            if child in visited:
                continue
            visited.add(child)
            if child not in exclusive or has_external_descendant(child, exclusive, visited):
                return True
        return False

    def snapshot_exclusive(selected):
        preliminary = {
            key for key, owners in usage_owners.items()
            if owners and owners <= selected and key in snap_sizes
        }
        return {k for k in preliminary if not has_external_descendant(k, preliminary)}

    print("docker_images=",len(images),"containers=",len(all_containers))
    print("containerd_snapshots=",len(snapshots),"committed_measurements=",len(snap_sizes))
    print("committed_snapshot_bytes=",sum(snap_sizes.values()))
    for rev in REVISIONS:
        exclusive = snapshot_exclusive(pair_ids[rev])
        print("release=",rev[:8],"exclusive_snapshot_layers=",len(exclusive),
              "exclusive_snapshot_bytes=",sum(snap_sizes[x] for x in exclusive))
    combined_snap = snapshot_exclusive(candidate)
    print("two_pair_exclusive_snapshot_layers=",len(combined_snap))
    print("two_pair_exclusive_snapshot_bytes=",sum(snap_sizes[x] for x in combined_snap))
    missing = [k for k in usage_owners if k not in snapshots]
    print("image_chainids_missing_from_snapshot_metadata=",len(missing))
    candidate_missing = [k for k in missing if usage_owners[k] & candidate]
    if candidate_missing:
        raise RuntimeError("candidate chainIDs not accounted for in snapshot metadata")

    # Content blob physical bytes: root metadata file stats, not recursive du.
    blobs = {}
    for entry in ROOT.iterdir():
        if not re.fullmatch(r"[0-9a-f]{64}", entry.name):
            raise RuntimeError("unexpected content store entry")
        digest = "sha256:"+entry.name
        blobs[digest] = content_stat(digest)
        if len(blobs)>10000:
            raise RuntimeError("unexpectedly large content store inventory")
    print("physical_content_blobs=",len(blobs),"allocated_content_blob_bytes=",sum(blobs.values()))

    images_table = run(["sudo","-n","ctr","-n","moby","images","ls"], 30)
    root_by_tag = {}
    for row in images_table.splitlines()[1:]:
        parts = row.split()
        if len(parts)>=3 and DIGEST.fullmatch(parts[2]):
            root_by_tag[parts[0]]=parts[2]
    # The only safe attribution is a complete graph including every ctr image.
    graph_by_root={}
    for tag,digest in root_by_tag.items():
        if digest not in graph_by_root:
            visited=set()
            parse_content_tree(digest,visited)
            graph_by_root[digest]=visited
    if any(
        f"ghcr.io/fredilly/xiaohai-{role}:{rev}" not in root_by_tag
        for role,rev in EXPECTED
    ):
        print("content_attribution=INCOMPLETE (ctr tag metadata missing); exclusive content cannot be claimed")
        return

    other_digests=set()
    for tag,root in root_by_tag.items():
        if tag not in {
            f"ghcr.io/fredilly/xiaohai-{role}:{rev}" for role,rev in EXPECTED
        }:
            other_digests.update(graph_by_root[root])

    def candidate_content(selected):
        found=set()
        for tag in selected:
            found.update(graph_by_root[root_by_tag[tag]])
        return found - other_digests

    tags_by_rev={
        rev:{f"ghcr.io/fredilly/xiaohai-{role}:{rev}" for role in ("api","worker")}
        for rev in REVISIONS
    }
    both_candidate=set().union(*(graph_by_root[root_by_tag[tag]] for tags in tags_by_rev.values() for tag in tags))
    for rev in REVISIONS:
        separate_other=other_digests | (both_candidate - set().union(
            *(graph_by_root[root_by_tag[t]] for t in tags_by_rev[rev])))
        unique=set().union(*(graph_by_root[root_by_tag[t]] for t in tags_by_rev[rev]))-separate_other
        print("release=",rev[:8],"exclusive_content_blobs=",len(unique),
              "exclusive_content_bytes=",sum(blobs[k] for k in unique))
    combined_content=candidate_content(set().union(*tags_by_rev.values()))
    exclusive_snapshot_bytes=sum(snap_sizes[x] for x in combined_snap)
    exclusive_content_bytes=sum(blobs[k] for k in combined_content)
    print("two_pair_exclusive_content_bytes=",exclusive_content_bytes)
    print("two_pair_modeled_MAX_reclaim_bytes=",exclusive_snapshot_bytes+exclusive_content_bytes)
    print("CAUTION: model excludes external leases, garbage-collector timing, and filesystem metadata; deletion must NOT be inferred safe")
    print("guaranteed_reclaim_bytes=0 (GC/leases/active refs may prevent immediate release)")
    print("never infer bytes from docker system df negative reclaimable or apparent image sizes")
    print("READ_ONLY=true deleted=0")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("MEASUREMENT_INCOMPLETE:",str(exc),file=sys.stderr)
        sys.exit(1)
