import test from "node:test";
import assert from "node:assert/strict";
import {
  htmlToMarkdown,
  parseEnex,
  cleanNotionName,
  cleanNotionMarkdown,
  csvToMarkdownTable,
  cleanJoplinMarkdown,
  convertToMarkdown,
  categorizeFile,
  VaultImporter,
  detectSource,
} from "../src/index.ts";
import type { VaultFileSystem, DirEntry, FileStat } from "@granite/core-cloud";

test("htmlToMarkdown converts headings, lists, formatting, and tables", () => {
  const html = `
    <h1>Main Title</h1>
    <p>This is <b>bold</b> and <i>italic</i> and <s>struck</s>.</p>
    <ul>
      <li>First bullet</li>
      <li>Second bullet</li>
    </ul>
    <table>
      <tr><th>Header 1</th><th>Header 2</th></tr>
      <tr><td>Cell 1</td><td>Cell 2</td></tr>
    </table>
    <blockquote>Quoted text here</blockquote>
    <code>const x = 1;</code>
  `;

  const { markdown, title } = htmlToMarkdown(html);
  assert.equal(title, "Main Title");
  assert.match(markdown, /# Main Title/);
  assert.match(markdown, /\*\*bold\*\*/);
  assert.match(markdown, /\*italic\*/);
  assert.match(markdown, /~~struck~~/);
  assert.match(markdown, /- First bullet/);
  assert.match(markdown, /\| Header 1 \| Header 2 \|/);
  assert.match(markdown, /> Quoted text here/);
  assert.match(markdown, /`const x = 1;`/);
});

test("parseEnex extracts notes, tags, frontmatter, and base64 assets", () => {
  const sampleEnex = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/dml/1.0/dtd/en-export.dtd">
<en-export>
  <note>
    <title>Meeting with Team</title>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
      <en-note>
        <div>Discussion notes</div>
        <en-todo checked="true"/>Task done
        <en-todo checked="false"/>Task pending
        <en-media type="image/png" hash="1234567890abcdef"/>
      </en-note>]]>
    </content>
    <created>20230501T103000Z</created>
    <updated>20230501T110000Z</updated>
    <tag>work</tag>
    <tag>granite</tag>
    <resource>
      <data encoding="base64">SGVsbG8gR3Jhbml0ZQ==</data>
      <mime>image/png</mime>
      <resource-attributes>
        <file-name>diagram.png</file-name>
      </resource-attributes>
    </resource>
  </note>
</en-export>`;

  const notes = parseEnex(sampleEnex);
  assert.equal(notes.length, 1);
  const note = notes[0]!;
  assert.equal(note.title, "Meeting with Team");
  assert.deepEqual(note.tags, ["work", "granite"]);
  assert.equal(note.created, "2023-05-01T10:30:00Z");
  assert.equal(note.assets.length, 1);
  assert.equal(note.assets[0]!.fileName, "diagram.png");
  // Check decoded base64 "Hello Granite"
  const text = new TextDecoder().decode(note.assets[0]!.data);
  assert.equal(text, "Hello Granite");

  // Check markdown output
  assert.match(note.markdown, /title: "Meeting with Team"/);
  assert.match(note.markdown, /- \[x\] Task done/);
  assert.match(note.markdown, /- \[ \] Task pending/);
  assert.match(note.markdown, /!\[diagram\.png\]\(assets\/diagram\.png\)/);
});

test("notionCleaner strips 32-char hex hashes and converts CSV", () => {
  const fileName = "Sprint Backlog a1b2c3d4e5f60718293a4b5c6d7e8f90.md";
  assert.equal(cleanNotionName(fileName), "Sprint Backlog.md");

  const folderName = "Projects 1234567890abcdef1234567890abcdef";
  assert.equal(cleanNotionName(folderName), "Projects");

  const md = "See [Doc](Doc%201234567890abcdef1234567890abcdef.md)";
  const cleaned = cleanNotionMarkdown(md);
  assert.equal(cleaned, "See [Doc](Doc.md)");

  const csv = `Name,Role,Status\n"Alice","Lead","Active"\n"Bob","Dev","Review"`;
  const table = csvToMarkdownTable(csv);
  assert.match(table, /\| Name \| Role \| Status \|/);
  assert.match(table, /\| Alice \| Lead \| Active \|/);
});

test("joplinCleaner extracts metadata block into frontmatter and fixes links", () => {
  const joplinRaw = `# My Joplin Note

This is content.

See [doc](:/1234567890abcdef1234567890abcdef) and image ![pic](_resources/pic.png).

id: 1234567890abcdef1234567890abcdef
parent_id: abcdef1234567890abcdef1234567890
created_time: 2023-01-01T12:00:00.000Z
updated_time: 2023-01-02T12:00:00.000Z
type_: 1`;

  const cleaned = cleanJoplinMarkdown(joplinRaw);
  assert.equal(cleaned.created, "2023-01-01T12:00:00.000Z");
  assert.match(cleaned.markdown, /created: 2023-01-01T12:00:00\.000Z/);
  assert.match(cleaned.markdown, /\(assets\/1234567890abcdef1234567890abcdef\)/);
  assert.match(cleaned.markdown, /\(assets\/pic\.png\)/);
  assert.ok(!cleaned.markdown.includes("parent_id:"));
});

test("convertToMarkdown turns non-.md files into .md files", () => {
  // HTML file -> .md
  const htmlFile = convertToMarkdown("meeting.html", "<h1>Daily Standup</h1><p>Good progress.</p>");
  assert.equal(htmlFile.targetFileName, "meeting.md");
  assert.match(htmlFile.markdown, /# Daily Standup\n\nGood progress\./);

  // Plain text file -> .md
  const txtFile = convertToMarkdown("notes.txt", "Some thoughts on architecture.");
  assert.equal(txtFile.targetFileName, "notes.md");
  assert.match(txtFile.markdown, /# notes\n\nSome thoughts on architecture\./);

  // CSV file -> .md
  const csvFile = convertToMarkdown("data.csv", "A,B\n1,2");
  assert.equal(csvFile.targetFileName, "data.md");
  assert.match(csvFile.markdown, /\| A \| B \|/);

  // Already .md -> kept as .md
  const mdFile = convertToMarkdown("readme.md", "# Hello");
  assert.equal(mdFile.targetFileName, "readme.md");
  assert.equal(mdFile.markdown, "# Hello");
});

test("categorizeFile separates notes, assets, and ignored files", () => {
  assert.equal(categorizeFile("note.md"), "note");
  assert.equal(categorizeFile("page.html"), "note");
  assert.equal(categorizeFile("draft.txt"), "note");
  assert.equal(categorizeFile("photo.png"), "asset");
  assert.equal(categorizeFile("drawing.svg"), "asset");
  assert.equal(categorizeFile(".DS_Store"), "ignore");
  assert.equal(categorizeFile(".git"), "ignore");
});

test("VaultImporter walks folder, converts non-md, and copies assets", async () => {
  // Create an in-memory fake VaultFileSystem
  const files = new Map<string, string | Uint8Array>();
  const dirs = new Set<string>(["/source", "/target"]);

  const memFs: VaultFileSystem = {
    async readTextFile(p: string) {
      const val = files.get(p);
      if (typeof val === "string") return val;
      if (val instanceof Uint8Array) return new TextDecoder().decode(val);
      throw new Error(`File not found: ${p}`);
    },
    async writeTextFile(p: string, content: string) {
      files.set(p, content);
    },
    async readBinaryFile(p: string) {
      const val = files.get(p);
      if (val instanceof Uint8Array) return val;
      if (typeof val === "string") return new TextEncoder().encode(val);
      throw new Error(`Binary file not found: ${p}`);
    },
    async writeBinaryFile(p: string, data: Uint8Array) {
      files.set(p, data);
    },
    async exists(p: string) {
      return files.has(p) || dirs.has(p);
    },
    async mkdirp(p: string) {
      dirs.add(p);
    },
    async listDir(p: string) {
      const entries: DirEntry[] = [];
      const prefix = p.endsWith("/") ? p : `${p}/`;
      const seen = new Set<string>();

      for (const f of files.keys()) {
        if (f.startsWith(prefix)) {
          const rest = f.slice(prefix.length);
          const seg = rest.split("/")[0]!;
          if (!seen.has(seg)) {
            seen.add(seg);
            entries.push({ name: seg, isDirectory: rest.includes("/") });
          }
        }
      }
      return entries;
    },
    async stat(p: string) {
      const val = files.get(p);
      const size = typeof val === "string" ? val.length : (val?.byteLength ?? 0);
      return { size, modifiedMs: Date.now() };
    },
  };

  // Populate source folder with:
  // 1. A markdown note
  // 2. An HTML note (needs conversion to .md!)
  // 3. A text note (needs conversion to .md!)
  // 4. An image asset (needs copying to target/assets/)
  files.set("/source/regular.md", "# Regular Note");
  files.set("/source/webpage.html", "<h2>HTML Title</h2><p>Converted body</p>");
  files.set("/source/todo.txt", "1. buy milk\n2. test granite");
  files.set("/source/pic.png", new Uint8Array([1, 2, 3, 4]));

  const importer = new VaultImporter(memFs);
  const result = await importer.importFolder("/source", "/target", "folder");

  assert.equal(result.notesCount, 3);
  assert.equal(result.assetsCount, 1);
  assert.equal(result.errors.length, 0);

  // Assert target files exist and are all .md
  assert.ok(files.has("/target/regular.md"));
  assert.ok(files.has("/target/webpage.md"));
  assert.ok(files.has("/target/todo.md"));
  assert.ok(files.has("/target/assets/pic.png"));

  // Check converted HTML content
  const convertedHtml = files.get("/target/webpage.md") as string;
  assert.match(convertedHtml, /## HTML Title/);
  assert.match(convertedHtml, /Converted body/);
});

test("detectSource accurately recognizes Obsidian, Notion, Joplin, and Evernote", async () => {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  const fakeFs: VaultFileSystem = {
    async readTextFile(p: string) {
      return files.get(p) ?? "";
    },
    async writeTextFile() {},
    async readBinaryFile() { return new Uint8Array(); },
    async writeBinaryFile() {},
    async exists(p: string) { return files.has(p) || dirs.has(p); },
    async mkdirp(p: string) { dirs.add(p); },
    async listDir(p: string) {
      const prefix = p.endsWith("/") ? p : `${p}/`;
      const entries: DirEntry[] = [];
      for (const [k] of files) {
        if (k.startsWith(prefix)) {
          const name = k.slice(prefix.length).split("/")[0]!;
          if (!entries.some(e => e.name === name)) {
            entries.push({ name, isDirectory: false });
          }
        }
      }
      for (const d of dirs) {
        if (d.startsWith(prefix)) {
          const name = d.slice(prefix.length).split("/")[0]!;
          if (name && !entries.some(e => e.name === name)) {
            entries.push({ name, isDirectory: true });
          }
        }
      }
      return entries;
    },
    async stat() { return { size: 0, modifiedMs: 0 }; }
  };

  // 1. Evernote file
  const enexResult = await detectSource("/downloads/notes.enex", fakeFs);
  assert.equal(enexResult.kind, "evernote");
  assert.equal(enexResult.displayName, "Evernote");

  // 2. Obsidian vault (.obsidian folder)
  dirs.add("/my-vault/.obsidian");
  const obsidianResult = await detectSource("/my-vault", fakeFs);
  assert.equal(obsidianResult.kind, "obsidian");
  assert.equal(obsidianResult.displayName, "Obsidian");

  // 3. Notion export (32 hex hash in filenames)
  files.set("/notion-export/Roadmap 1234567890abcdef1234567890abcdef.md", "# Roadmap");
  const notionResult = await detectSource("/notion-export", fakeFs);
  assert.equal(notionResult.kind, "notion");
  assert.equal(notionResult.displayName, "Notion");

  // 4. Joplin notebook (_resources folder)
  dirs.add("/joplin-notes/_resources");
  const joplinResult = await detectSource("/joplin-notes", fakeFs);
  assert.equal(joplinResult.kind, "joplin");
  assert.equal(joplinResult.displayName, "Joplin");
});

