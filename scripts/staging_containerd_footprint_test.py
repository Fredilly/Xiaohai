"""Offline parser tests for the read-only containerd footprint inventory."""
import hashlib
import importlib.util
import pathlib
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

    def test_candidate_id_allowlist_is_four_fixed_sha256_values(self):
        self.assertEqual(len(module.EXPECTED), 4)
        self.assertTrue(all(module.DIGEST.fullmatch(x) for x in module.EXPECTED.values()))


if __name__ == "__main__":
    unittest.main()
