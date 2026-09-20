import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { VaultImporter, detectSource } from "@granite/core-importer";
import { NoteRepository } from "@granite/core-notes";
import { nodeFs } from "@granite/core-notes/adapters/node";

const TEST_BASE = "/tmp/granite-e2e-test";

// Simple VaultFileSystem wrapper over nodeFs with directory listing and stat
const testFs = {
  ...nodeFs,
  async listDir(dirPath) {
    if (!fs.existsSync(dirPath)) return [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    }));
  },
  async readBinaryFile(p) {
    return new Uint8Array(fs.readFileSync(p));
  },
  async stat(p) {
    const s = fs.statSync(p);
    return { size: s.size, modifiedMs: s.mtimeMs };
  },
};

const repo = new NoteRepository(testFs);

async function setupFixtures() {
  if (fs.existsSync(TEST_BASE)) {
    fs.rmSync(TEST_BASE, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_BASE, { recursive: true });

  // 1. Real Obsidian Vault fixture
  const obsDir = path.join(TEST_BASE, "fixtures/obsidian_vault");
  fs.mkdirSync(path.join(obsDir, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(obsDir, ".obsidian/config.json"), "{}");
  fs.writeFileSync(path.join(obsDir, "Meeting Notes.md"), "# Team Meeting\n\nDiscussing [[Project Roadmap]]");
  fs.writeFileSync(path.join(obsDir, "Legacy Spec.html"), "<h1>Legacy Spec</h1><p>Important details here.</p>");
  fs.writeFileSync(path.join(obsDir, "diagram.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // 2. Real Evernote ENEX fixture
  const evDir = path.join(TEST_BASE, "fixtures/evernote_export");
  fs.mkdirSync(evDir, { recursive: true });
  const enexXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/dml/1.0/dtd/en-export.dtd">
<en-export>
  <note>
    <title>Evernote Client Meeting</title>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
      <en-note>
        <div>Client requirements discussion</div>
        <en-todo checked="true"/>Send proposal
        <en-todo checked="false"/>Follow up call
        <en-media type="image/png" hash="a1b2c3d4e5f6"/>
      </en-note>]]>
    </content>
    <created>20230615T093000Z</created>
    <tag>clients</tag>
    <resource>
      <data encoding="base64">SGVsbG8gRXZlcm5vdGUgVGVzdA==</data>
      <mime>image/png</mime>
      <resource-attributes>
        <file-name>chart.png</file-name>
      </resource-attributes>
    </resource>
  </note>
</en-export>`;
  fs.writeFileSync(path.join(evDir, "my_notes.enex"), enexXml);

  // 3. Real Notion Export fixture
  const notionDir = path.join(TEST_BASE, "fixtures/notion_export");
  fs.mkdirSync(notionDir, { recursive: true });
  fs.writeFileSync(
    path.join(notionDir, "Sprint Goals 8a2f7c6e1d4b4a9b9a1c2d3e4f5a6b7c.md"),
    "# Sprint Goals\n\nDeliver import feature"
  );
  fs.writeFileSync(
    path.join(notionDir, "Architecture 1234567890abcdef1234567890abcdef.html"),
    "<h2>System Architecture</h2><p>High level overview</p>"
  );
  fs.writeFileSync(
    path.join(notionDir, "Tasks 567890abcdef1234567890abcdef1234.csv"),
    "Task,Assignee,Status\n\"Build UI\",\"Dev\",\"Done\"\n\"Write Tests\",\"QA\",\"InProgress\""
  );

  // 4. Real Joplin Export fixture
  const joplinDir = path.join(TEST_BASE, "fixtures/joplin_export");
  fs.mkdirSync(path.join(joplinDir, "_resources"), { recursive: true });
  fs.writeFileSync(
    path.join(joplinDir, "_resources/1234567890abcdef1234567890abcdef.png"),
    Buffer.from([137, 80, 78, 71])
  );
  fs.writeFileSync(
    path.join(joplinDir, "Weekly Plan.md"),
    `# Weekly Plan\n\nSee image ![attach](:/1234567890abcdef1234567890abcdef)\n\nid: 1234567890abcdef1234567890abcdef\nparent_id: abcdef1234567890abcdef1234567890\ncreated_time: 2023-01-01T12:00:00.000Z\nupdated_time: 2023-01-02T12:00:00.000Z\ntype_: 1`
  );

  // 5. Real OneNote Export fixture
  const oneNoteDir = path.join(TEST_BASE, "fixtures/onenote_export");
  fs.mkdirSync(oneNoteDir, { recursive: true });
  fs.writeFileSync(
    path.join(oneNoteDir, "Lecture Notes.html"),
    `<html><head><meta name="Generator" content="Microsoft OneNote 15"></head><body><h1>Lecture Notes</h1><p>Key concepts explained.</p></body></html>`
  );
}

async function runRealWorkflowTests() {
  console.log("=================================================");
  console.log("🧪 RUNNING REAL END-TO-END WORKFLOW TESTS");
  console.log("=================================================\n");

  await setupFixtures();
  const importer = new VaultImporter(testFs);

  // TEST 1: OBSIDIAN AUTO-SCAN AND IMPORT
  console.log("👉 TEST 1: Testing Obsidian Drag-and-Drop Auto-Scan...");
  const obsSource = path.join(TEST_BASE, "fixtures/obsidian_vault");
  const obsTarget = path.join(TEST_BASE, "vaults/obsidian_vault_imported");
  const obsDetected = await detectSource(obsSource, testFs);
  console.log(`   Scanned source: ${obsSource}`);
  console.log(`   Result: ${obsDetected.badge} ${obsDetected.displayName} (${obsDetected.kind})`);
  assert.equal(obsDetected.kind, "obsidian");

  const obsResult = await importer.importFolder(obsSource, obsTarget, obsDetected.kind);
  console.log(`   Import result: ${obsResult.notesCount} notes, ${obsResult.assetsCount} assets`);
  assert.equal(obsResult.notesCount, 2);
  assert.equal(obsResult.assetsCount, 1);

  // Check that non-.md file "Legacy Spec.html" became "Legacy Spec.md"!
  assert.ok(fs.existsSync(path.join(obsTarget, "Meeting Notes.md")));
  assert.ok(fs.existsSync(path.join(obsTarget, "Legacy Spec.md")));
  assert.ok(!fs.existsSync(path.join(obsTarget, "Legacy Spec.html")), "HTML should not exist; converted to .md!");
  assert.ok(fs.existsSync(path.join(obsTarget, "assets/diagram.png")));

  // Verify Granite note parser parses the converted note cleanly!
  const parsedObsNote = await repo.load(path.join(obsTarget, "Legacy Spec.md"));
  console.log(`   Parsed converted note title: "${parsedObsNote.title}", words: ${parsedObsNote.wordCount}`);
  assert.equal(parsedObsNote.title, "Legacy Spec");
  console.log("   ✅ Test 1 Passed!\n");

  // TEST 2: EVERNOTE ENEX AUTO-SCAN AND IMPORT
  console.log("👉 TEST 2: Testing Evernote .enex Auto-Scan and Import...");
  const enexSource = path.join(TEST_BASE, "fixtures/evernote_export/my_notes.enex");
  const enexTarget = path.join(TEST_BASE, "vaults/evernote_imported");
  const enexDetected = await detectSource(enexSource, testFs);
  console.log(`   Scanned source: ${enexSource}`);
  console.log(`   Result: ${enexDetected.badge} ${enexDetected.displayName} (${enexDetected.kind})`);
  assert.equal(enexDetected.kind, "evernote");

  const enexResult = await importer.importEnexFile(enexSource, enexTarget);
  console.log(`   Import result: ${enexResult.notesCount} notes, ${enexResult.assetsCount} assets`);
  assert.equal(enexResult.notesCount, 1);
  assert.equal(enexResult.assetsCount, 1);

  const importedEnexNote = path.join(enexTarget, "Evernote Client Meeting.md");
  assert.ok(fs.existsSync(importedEnexNote));
  assert.ok(fs.existsSync(path.join(enexTarget, "assets/chart.png")));

  const parsedEnexNote = await repo.load(importedEnexNote);
  console.log(`   Parsed note frontmatter:`, parsedEnexNote.frontmatter);
  assert.equal(parsedEnexNote.title, "Evernote Client Meeting");
  assert.deepEqual(parsedEnexNote.frontmatter.tags, ["clients"]);
  console.log("   ✅ Test 2 Passed!\n");

  // TEST 3: NOTION AUTO-SCAN AND IMPORT
  console.log("👉 TEST 3: Testing Notion Drag-and-Drop Auto-Scan...");
  const notionSource = path.join(TEST_BASE, "fixtures/notion_export");
  const notionTarget = path.join(TEST_BASE, "vaults/notion_imported");
  const notionDetected = await detectSource(notionSource, testFs);
  console.log(`   Scanned source: ${notionSource}`);
  console.log(`   Result: ${notionDetected.badge} ${notionDetected.displayName} (${notionDetected.kind})`);
  assert.equal(notionDetected.kind, "notion");

  const notionResult = await importer.importFolder(notionSource, notionTarget, notionDetected.kind);
  console.log(`   Import result: ${notionResult.notesCount} notes, ${notionResult.assetsCount} assets`);
  assert.equal(notionResult.notesCount, 3);

  // Check that 32-hex hashes were stripped from filenames!
  assert.ok(fs.existsSync(path.join(notionTarget, "Sprint Goals.md")), "Hash stripped from markdown note!");
  assert.ok(fs.existsSync(path.join(notionTarget, "Architecture.md")), "HTML converted to .md with hash stripped!");
  assert.ok(fs.existsSync(path.join(notionTarget, "Tasks.md")), "CSV table converted to .md table with hash stripped!");

  const parsedTasks = await repo.load(path.join(notionTarget, "Tasks.md"));
  console.log(`   CSV converted to Markdown Table preview:\n${parsedTasks.body}`);
  assert.match(parsedTasks.body, /\| Task \| Assignee \| Status \|/);
  console.log("   ✅ Test 3 Passed!\n");

  // TEST 4: JOPLIN AUTO-SCAN AND IMPORT
  console.log("👉 TEST 4: Testing Joplin Drag-and-Drop Auto-Scan...");
  const joplinSource = path.join(TEST_BASE, "fixtures/joplin_export");
  const joplinTarget = path.join(TEST_BASE, "vaults/joplin_imported");
  const joplinDetected = await detectSource(joplinSource, testFs);
  console.log(`   Scanned source: ${joplinSource}`);
  console.log(`   Result: ${joplinDetected.badge} ${joplinDetected.displayName} (${joplinDetected.kind})`);
  assert.equal(joplinDetected.kind, "joplin");

  const joplinResult = await importer.importFolder(joplinSource, joplinTarget, joplinDetected.kind);
  console.log(`   Import result: ${joplinResult.notesCount} notes`);
  assert.equal(joplinResult.notesCount, 1);

  const joplinNotePath = path.join(joplinTarget, "Weekly Plan.md");
  assert.ok(fs.existsSync(joplinNotePath));
  const parsedJoplin = await repo.load(joplinNotePath);
  console.log(`   Joplin frontmatter:`, parsedJoplin.frontmatter);
  assert.equal(parsedJoplin.frontmatter.created, "2023-01-01T12:00:00.000Z");
  assert.ok(!parsedJoplin.body.includes("parent_id:"), "Joplin trailing metadata stripped cleanly!");
  console.log("   ✅ Test 4 Passed!\n");

  // TEST 5: ONENOTE AUTO-SCAN AND IMPORT
  console.log("👉 TEST 5: Testing OneNote Drag-and-Drop Auto-Scan...");
  const oneNoteSource = path.join(TEST_BASE, "fixtures/onenote_export");
  const oneNoteTarget = path.join(TEST_BASE, "vaults/onenote_imported");
  const oneNoteDetected = await detectSource(oneNoteSource, testFs);
  console.log(`   Scanned source: ${oneNoteSource}`);
  console.log(`   Result: ${oneNoteDetected.badge} ${oneNoteDetected.displayName} (${oneNoteDetected.kind})`);
  assert.equal(oneNoteDetected.kind, "onenote");

  const oneNoteResult = await importer.importFolder(oneNoteSource, oneNoteTarget, oneNoteDetected.kind);
  console.log(`   Import result: ${oneNoteResult.notesCount} notes`);
  assert.equal(oneNoteResult.notesCount, 1);

  const oneNotePath = path.join(oneNoteTarget, "Lecture Notes.md");
  assert.ok(fs.existsSync(oneNotePath));
  assert.ok(!fs.existsSync(path.join(oneNoteTarget, "Lecture Notes.html")), "HTML converted to .md!");
  const parsedOneNote = await repo.load(oneNotePath);
  assert.equal(parsedOneNote.title, "Lecture Notes");
  console.log("   ✅ Test 5 Passed!\n");

  console.log("=================================================");
  console.log("🎉 ALL REAL WORKFLOW & IMPORT TESTS PASSED 100%!");
  console.log("=================================================");
}

runRealWorkflowTests().catch((e) => {
  console.error("Test Failed:", e);
  process.exit(1);
});
