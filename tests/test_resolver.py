import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from conflict_cleaner import cli, resolver


class ResolverTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.backup_dir = self.root / ".conflict-cleaner-backup"

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, rel_path: str, content: str = "hello") -> Path:
        p = self.root / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return p


class TestDryRunWritesNothing(ResolverTestCase):
    def test_dry_run_default_makes_no_changes(self):
        self.write("note.md", "original")
        conflict = self.write("note.sync-conflict-20260101-000000-ABCDEFG.md", "conflict")

        before = {p.name: p.read_bytes() for p in self.root.iterdir()}
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main([str(self.root)])
        self.assertEqual(rc, 0)

        after = {p.name: p.read_bytes() for p in self.root.iterdir()}
        self.assertEqual(before, after)
        self.assertFalse(self.backup_dir.exists())

    def test_json_flag_also_writes_nothing(self):
        self.write("note.md", "original")
        self.write("note.sync-conflict-20260101-000000-ABCDEFG.md", "conflict")

        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main([str(self.root), "--json", "--apply"])
        self.assertEqual(rc, 0)
        self.assertFalse(self.backup_dir.exists())


class TestBackupBeforeDelete(ResolverTestCase):
    def test_backup_exists_before_conflict_deleted(self):
        self.write("note.md", "original")
        conflict = self.write("note.sync-conflict-20260101-000000-ABCDEFG.md", "conflict")

        resolver.keep_original(self.root, "note.md", conflict.name, self.backup_dir, self.root)

        self.assertFalse(conflict.exists())
        backup_path = self.backup_dir / conflict.name
        self.assertTrue(backup_path.exists())
        self.assertEqual(backup_path.read_text(), "conflict")

    def test_backup_exists_before_original_overwritten(self):
        original = self.write("note.md", "original")
        conflict = self.write("note.sync-conflict-20260101-000000-ABCDEFG.md", "conflict")

        resolver.keep_conflict(self.root, "note.md", conflict.name, True, self.backup_dir, self.root)

        self.assertEqual(original.read_text(), "conflict")
        self.assertTrue((self.backup_dir / "note.md").exists())
        self.assertEqual((self.backup_dir / "note.md").read_text(), "original")


class TestKeepBoth(ResolverTestCase):
    def test_renamed_file_uses_clean_original_base_not_mangled_name(self):
        self.write("n.md", "orig")
        conflict = self.write("n (Conflicted copy 2026-08-15).md", "conf")

        new_name = resolver.keep_both(self.root, "n.md", conflict.name, self.backup_dir, self.root)

        self.assertEqual(new_name, "n-conflict-1.md")
        self.assertTrue((self.root / "n-conflict-1.md").exists())
        self.assertFalse(conflict.exists())


class TestLastCopyRefusal(ResolverTestCase):
    def test_refuses_to_delete_only_remaining_copy(self):
        # No original on disk -- the conflict file is the only copy.
        conflict = self.write("note.sync-conflict-20260101-000000-ABCDEFG.md", "only copy")

        with self.assertRaises(resolver.RefusedError):
            resolver.keep_original(self.root, "note.md", conflict.name, self.backup_dir, self.root)

        # Nothing was touched.
        self.assertTrue(conflict.exists())
        self.assertFalse(self.backup_dir.exists())

    def test_rename_to_original_refuses_if_original_appeared(self):
        original = self.write("note.md", "original")
        conflict = self.write("note.sync-conflict-20260101-000000-ABCDEFG.md", "conflict")

        with self.assertRaises(resolver.RefusedError):
            resolver.rename_to_original(self.root, "note.md", conflict.name, self.backup_dir, self.root)

        self.assertTrue(original.exists())
        self.assertTrue(conflict.exists())


if __name__ == "__main__":
    unittest.main()
