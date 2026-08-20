import os
import tempfile
import unittest
from pathlib import Path

from conflict_cleaner import scanner


class ScannerTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, rel_path: str, content: str = "hello") -> Path:
        p = self.root / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return p


class TestOriginalResolution(ScannerTestCase):
    def test_original_exists(self):
        self.write("note.md", "original")
        self.write("note.sync-conflict-20260101-000000-ABCDEFG.md", "conflict")
        result = scanner.scan(self.root)
        self.assertEqual(len(result.groups), 1)
        self.assertTrue(result.groups[0].original_exists)

    def test_original_missing(self):
        self.write("note.sync-conflict-20260101-000000-ABCDEFG.md", "conflict")
        result = scanner.scan(self.root)
        self.assertEqual(len(result.groups), 1)
        self.assertFalse(result.groups[0].original_exists)

    def test_multiple_conflicts_for_one_original(self):
        self.write("note.md", "original")
        self.write("note.sync-conflict-20260101-000000-ABCDEFG.md", "c1")
        self.write("note.sync-conflict-20260102-000000-HIJKLMN.md", "c2")
        result = scanner.scan(self.root)
        self.assertEqual(len(result.groups), 1)
        self.assertEqual(len(result.groups[0].conflicts), 2)


class TestEdgeCases(ScannerTestCase):
    def test_nested_folders(self):
        self.write("a/b/c/note.md", "original")
        self.write("a/b/c/note.sync-conflict-20260101-000000-ABCDEFG.md", "conflict")
        result = scanner.scan(self.root)
        self.assertEqual(len(result.groups), 1)
        self.assertEqual(result.groups[0].directory, self.root / "a" / "b" / "c")

    def test_non_ascii_filenames(self):
        base = "日記-\U0001f600"  # 日記-😀
        self.write(f"{base}.md", "original")
        self.write(f"{base}.sync-conflict-20260101-000000-ABCDEFG.md", "conflict")
        result = scanner.scan(self.root)
        self.assertEqual(len(result.groups), 1)
        self.assertEqual(result.groups[0].original_name, f"{base}.md")

    def test_identical_content_reports_no_differences(self):
        from conflict_cleaner import differ

        orig = self.write("note.md", "same content\n")
        conf = self.write("note.sync-conflict-20260101-000000-ABCDEFG.md", "same content\n")
        result = differ.unified_diff(orig, conf)
        self.assertTrue(result.identical)
        self.assertEqual(result.lines, [])

    def test_binary_file_detected(self):
        from conflict_cleaner import differ

        p = self.write("image.md", "placeholder")
        p.write_bytes(b"\x89PNG\x00\x01\x02\x03")
        self.assertTrue(differ.is_binary(p))

    def test_empty_directory(self):
        result = scanner.scan(self.root)
        self.assertEqual(result.total_conflicts(), 0)

    def test_directory_with_no_conflicts(self):
        self.write("note.md", "hello")
        self.write("other.md", "world")
        result = scanner.scan(self.root)
        self.assertEqual(result.total_conflicts(), 0)

    def test_ignores_obsidian_and_git_dirs(self):
        self.write(".obsidian/note.sync-conflict-20260101-000000-ABCDEFG.md", "x")
        self.write(".git/note.sync-conflict-20260101-000000-ABCDEFG.md", "x")
        result = scanner.scan(self.root, include_hidden=True)
        self.assertEqual(result.total_conflicts(), 0)

    def test_hidden_dirs_skipped_by_default(self):
        self.write(".hidden/note.sync-conflict-20260101-000000-ABCDEFG.md", "x")
        result = scanner.scan(self.root, include_hidden=False)
        self.assertEqual(result.total_conflicts(), 0)

    def test_include_hidden_flag(self):
        self.write(".hidden/note.sync-conflict-20260101-000000-ABCDEFG.md", "x")
        result = scanner.scan(self.root, include_hidden=True)
        self.assertEqual(result.total_conflicts(), 1)

    def test_symlinked_file_not_followed(self):
        target = self.write("secret_outside.md", "should not be scanned")
        outside = tempfile.TemporaryDirectory()
        try:
            real_target = Path(outside.name) / "real.sync-conflict-20260101-000000-ABCDEFG.md"
            real_target.write_text("x", encoding="utf-8")
            link = self.root / "link.sync-conflict-20260101-000000-ABCDEFG.md"
            try:
                os.symlink(real_target, link)
            except (OSError, NotImplementedError):
                self.skipTest("symlinks not supported on this platform")
            result = scanner.scan(self.root)
            # The symlinked conflict file itself must not be scanned.
            names = [c.filename for g in result.groups for c in g.conflicts]
            self.assertNotIn(link.name, names)
        finally:
            outside.cleanup()


if __name__ == "__main__":
    unittest.main()
