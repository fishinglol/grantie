import unittest

from conflict_cleaner import patterns


class TestSyncthing(unittest.TestCase):
    def test_matches(self):
        m = patterns.match_filename("daily-note.sync-conflict-20260815-093012-ABCDEFG.md")
        self.assertIsNotNone(m)
        self.assertEqual(m.sync_tool, patterns.SYNCTHING)
        self.assertEqual(m.confidence, patterns.HIGH)
        self.assertEqual(m.original_name, "daily-note.md")
        self.assertEqual(m.info["date"], "20260815")
        self.assertEqual(m.info["time"], "093012")
        self.assertEqual(m.info["device_id"], "ABCDEFG")

    def test_no_extension(self):
        m = patterns.match_filename("README.sync-conflict-20260815-093012-ABCDEFG")
        self.assertIsNotNone(m)
        self.assertEqual(m.original_name, "README")


class TestGoogleDrive(unittest.TestCase):
    def test_bare_conflicted_copy(self):
        m = patterns.match_filename("daily-note (Conflicted copy 2026-08-15).md")
        self.assertIsNotNone(m)
        self.assertEqual(m.sync_tool, patterns.GOOGLE_DRIVE)
        self.assertEqual(m.confidence, patterns.HIGH)
        self.assertEqual(m.original_name, "daily-note.md")

    def test_device_named_conflicted_copy(self):
        m = patterns.match_filename("daily-note (SomeDevice's conflicted copy 2026-08-15).md")
        self.assertIsNotNone(m)
        self.assertEqual(m.sync_tool, patterns.GOOGLE_DRIVE)
        self.assertEqual(m.original_name, "daily-note.md")


class TestOneDrive(unittest.TestCase):
    def test_explicit_form(self):
        m = patterns.match_filename("daily-note (DESKTOP-AB12CD3's conflicted copy 2026-08-15).md")
        self.assertIsNotNone(m)
        self.assertEqual(m.sync_tool, patterns.ONEDRIVE_EXPLICIT)
        self.assertEqual(m.confidence, patterns.HIGH)
        self.assertEqual(m.original_name, "daily-note.md")
        self.assertEqual(m.info["device"], "DESKTOP-AB12CD3")

    def test_device_suffix_form_is_low_confidence(self):
        m = patterns.match_filename("daily-note-DESKTOP-AB12CD3.md")
        self.assertIsNotNone(m)
        self.assertEqual(m.sync_tool, patterns.ONEDRIVE_SUFFIX)
        self.assertEqual(m.confidence, patterns.LOW)
        self.assertEqual(m.original_name, "daily-note.md")

    def test_laptop_suffix(self):
        m = patterns.match_filename("ideas-LAPTOP-9988ZZZ.md")
        self.assertIsNotNone(m)
        self.assertEqual(m.sync_tool, patterns.ONEDRIVE_SUFFIX)
        self.assertEqual(m.confidence, patterns.LOW)


class TestMatchOrder(unittest.TestCase):
    def test_syncthing_never_falls_through_to_onedrive_suffix(self):
        # The 7-char device id in a syncthing name must not be
        # misclassified as a low-confidence OneDrive suffix.
        m = patterns.match_filename("note.sync-conflict-20260101-000000-ABCDEFG.md")
        self.assertEqual(m.sync_tool, patterns.SYNCTHING)

    def test_onedrive_explicit_wins_over_google_loose_match(self):
        m = patterns.match_filename("daily-note (DESKTOP-AB12CD3's conflicted copy 2026-08-15).md")
        self.assertEqual(m.sync_tool, patterns.ONEDRIVE_EXPLICIT)


class TestNegatives(unittest.TestCase):
    def test_normal_filenames_do_not_match(self):
        normal_names = [
            "daily-note.md",
            "2026-08-15-journal.md",
            "my-plan-v2.md",
            "todo-list.md",
            "project-DESKTOP.md",  # no 7-char id suffix
            "notes (draft).md",
            "notes (copy).md",
            "README.md",
            "archive.tar.gz",
        ]
        for name in normal_names:
            with self.subTest(name=name):
                self.assertIsNone(patterns.match_filename(name))

    def test_conflict_of_a_conflict(self):
        # A conflict file whose base is itself already a conflict name.
        name = (
            "daily-note.sync-conflict-20260101-000000-AAAAAAA"
            ".sync-conflict-20260102-000000-BBBBBBB.md"
        )
        m = patterns.match_filename(name)
        self.assertIsNotNone(m)
        self.assertEqual(m.sync_tool, patterns.SYNCTHING)
        # The derived "original" is itself a conflict-shaped name --
        # scanner.py is responsible for detecting that on a second pass.
        self.assertIsNotNone(patterns.match_filename(m.original_name))


if __name__ == "__main__":
    unittest.main()
