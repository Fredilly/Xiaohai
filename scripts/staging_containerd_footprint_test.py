"""Offline parser tests for the read-only containerd footprint inventory."""
import hashlib
import importlib.util
import pathlib
import json
import tempfile
import unittest


path = pathlib.Path(__file__).with_name("staging-containerd-footprint.py")
spec = importlib.util.spec_from_file_location("xiaohai_footprint", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FootprintMetadataTests(unittest.TestCase):
    def test_chain_ids_match_containerd_diffid_chain_algorithm(self):
        a = "sha256:" + "a" * 64
        b = "sha256:" + "b" * 64
        got = list(module.chain_ids([a, b]))
        expected = "sha256:" + hashlib.sha256((a + " " + b).encode()).hexdigest()
        self.assertEqual(got, [a, expected])

    def test_snapshot_metadata_keeps_parents_and_kind(self):
        parent = "sha256:" + "a" * 64
        child = "sha256:" + "b" * 64
        table = f"KEY PARENT KIND\n{parent} Committed\n{child} {parent} Committed\n"
        self.assertEqual(module.snapshot_records(table), {
            parent: (None, "Committed"),
            child: (parent, "Committed"),
        })

    def test_usage_is_exact_byte_count_not_human_display(self):
        key = "sha256:" + "c" * 64
        self.assertEqual(
            module.usage_records(f"KEY SIZE INODES\n{key} 1234567 12\n"),
            {key: 1234567},
        )

    def test_invalid_diffid_is_rejected(self):
        with self.assertRaises(ValueError):
            list(module.chain_ids(["not-a-digest"]))

    def test_image_config_json_is_not_an_oci_manifest(self):
        # Docker image config JSON contains "config": {Env, Cmd...}.
        # It does NOT have a schemaVersion=2 descriptor whose digest is required.
        image_config = {
            "architecture": "amd64",
            "os": "linux",
            "config": {"Env": ["NODE_ENV=test"], "Cmd": ["node", "app.js"]},
            "rootfs": {"type": "layers", "diff_ids": ["sha256:" + "a" * 64]},
        }
        self.assertEqual(module.oci_descriptor_digests(image_config), [])
        with tempfile.TemporaryDirectory() as root:
            raw = json.dumps(image_config).encode()
            digest = "sha256:" + hashlib.sha256(raw).hexdigest()
            blob = pathlib.Path(root) / digest.split(":")[1]
            blob.write_bytes(raw)
            previous = module.ROOT
            try:
                module.ROOT = pathlib.Path(root)
                visited = set()
                module.parse_content_tree(digest, visited)
            finally:
                module.ROOT = previous
            self.assertEqual(visited, {digest})

    def test_absent_oci_descriptor_is_recorded_without_claiming_reclaim(self):
        with tempfile.TemporaryDirectory() as root:
            existing = "sha256:" + "a" * 64
            absent = "sha256:" + "b" * 64
            manifest = {
                "schemaVersion": 2,
                "config": {"digest": absent},
                "layers": [],
            }
            (pathlib.Path(root) / existing.split(":")[1]).write_bytes(
                json.dumps(manifest).encode()
            )
            previous = module.ROOT
            try:
                module.ROOT = pathlib.Path(root)
                visited = set()
                missing = set()
                module.parse_content_tree(existing, visited, missing=missing)
            finally:
                module.ROOT = previous
            self.assertEqual(missing, {absent})
            self.assertEqual(visited, {existing, absent})

    def test_missing_blob_not_mistaken_for_cleared_graph(self):
        with tempfile.TemporaryDirectory() as root:
            missing_digest = "sha256:" + "c" * 64
            previous = module.ROOT
            try:
                module.ROOT = pathlib.Path(root)
                visited = set()
                missing = set()
                module.parse_content_tree(missing_digest, visited, missing=missing)
            finally:
                module.ROOT = previous
            self.assertEqual(missing, {missing_digest})

    def test_real_manifest_and_index_resolve_exact_descriptors(self):
        config = "sha256:" + "a" * 64
        layer = "sha256:" + "b" * 64
        manifest = "sha256:" + "c" * 64
        self.assertEqual(
            module.oci_descriptor_digests({
                "schemaVersion": 2,
                "config": {"digest": config},
                "layers": [{"digest": layer}],
            }),
            [config, layer],
        )
        self.assertEqual(
            module.oci_descriptor_digests({
                "schemaVersion": 2,
                "manifests": [{"digest": manifest, "platform": {"os": "linux"}}],
            }),
            [manifest],
        )

    def test_valid_manifest_missing_digest_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "missing/unsupported digest"):
            module.oci_descriptor_digests({
                "schemaVersion": 2,
                "config": {"mediaType": "application/vnd.oci.image.config.v1+json"},
                "layers": [],
            })
        with self.assertRaisesRegex(RuntimeError, "non-object OCI descriptor"):
            module.oci_descriptor_digests({
                "schemaVersion": 2, "manifests": ["unstructured"],
            })

    def test_candidate_id_allowlist_is_four_fixed_sha256_values(self):
        self.assertEqual(len(module.EXPECTED), 4)
        self.assertTrue(all(module.DIGEST.fullmatch(x) for x in module.EXPECTED.values()))


if __name__ == "__main__":
    unittest.main()
