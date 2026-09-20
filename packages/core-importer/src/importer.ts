import { join } from "@granite/core-notes";
import type { VaultFileSystem } from "@granite/core-cloud";
import { parseEnex } from "./converters/enexToMarkdown.ts";
import { cleanNotionMarkdown, cleanNotionName } from "./converters/notionCleaner.ts";
import { cleanJoplinMarkdown } from "./converters/joplinCleaner.ts";
import { categorizeFile, convertToMarkdown } from "./formatConverter.ts";
import { detectSource, type DetectionResult } from "./detector.ts";

export type ImportSource = "obsidian" | "joplin" | "onenote" | "evernote" | "notion" | "folder";

export interface ImportProgress {
  notesProcessed: number;
  assetsProcessed: number;
  currentFile: string;
}

export interface ImportResult {
  notesCount: number;
  assetsCount: number;
  skippedCount: number;
  errors: Array<{ file: string; error: string }>;
}

export class VaultImporter {
  readonly #fs: VaultFileSystem;

  constructor(fs: VaultFileSystem) {
    this.#fs = fs;
  }

  /**
   * Automatically detects the source app from targetPath, then imports and converts
   * all non-.md files into .md format.
   */
  async autoImport(
    sourcePath: string,
    targetVaultDir: string,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<{ detected: DetectionResult; result: ImportResult }> {
    const detected = await detectSource(sourcePath, this.#fs);
    let result: ImportResult;

    if (detected.kind === "evernote") {
      result = await this.importEnexFile(sourcePath, targetVaultDir, onProgress);
    } else {
      result = await this.importFolder(sourcePath, targetVaultDir, detected.kind, onProgress);
    }

    return { detected, result };
  }

  /**
   * Imports notes and assets from an Evernote .enex file into targetVaultDir.
   */
  async importEnexFile(
    enexFilePath: string,
    targetVaultDir: string,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportResult> {
    const result: ImportResult = { notesCount: 0, assetsCount: 0, skippedCount: 0, errors: [] };
    const assetsDir = join(targetVaultDir, "assets");
    await this.#fs.mkdirp(assetsDir);

    try {
      const xml = await this.#fs.readTextFile(enexFilePath);
      const notes = parseEnex(xml);

      for (const note of notes) {
        try {
          // Write assets
          for (const asset of note.assets) {
            const assetPath = join(assetsDir, asset.fileName);
            await this.#fs.writeBinaryFile(assetPath, asset.data);
            result.assetsCount++;
          }

          // Write note
          const safeTitle = note.title.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";
          const targetNotePath = join(targetVaultDir, `${safeTitle}.md`);
          await this.#fs.writeTextFile(targetNotePath, note.markdown);
          result.notesCount++;

          onProgress?.({
            notesProcessed: result.notesCount,
            assetsProcessed: result.assetsCount,
            currentFile: `${safeTitle}.md`,
          });
        } catch (err) {
          result.errors.push({
            file: note.title,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      result.errors.push({
        file: enexFilePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return result;
  }

  /**
   * Imports an entire folder into targetVaultDir, converting non-.md notes to .md
   * and copying assets to assets/.
   */
  async importFolder(
    sourceDir: string,
    targetVaultDir: string,
    source: ImportSource,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportResult> {
    const result: ImportResult = { notesCount: 0, assetsCount: 0, skippedCount: 0, errors: [] };
    const assetsDir = join(targetVaultDir, "assets");
    await this.#fs.mkdirp(assetsDir);

    const queue: string[] = [sourceDir];

    while (queue.length > 0) {
      const currentDir = queue.shift()!;
      let entries;
      try {
        entries = await this.#fs.listDir(currentDir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory) {
          // Skip internal hidden/config folders (.obsidian, .git, _resources, etc.)
          if (entry.name.startsWith(".") || (source === "obsidian" && entry.name === ".obsidian")) {
            result.skippedCount++;
            continue;
          }
          queue.push(fullPath);
          continue;
        }

        // It's a file
        const category = categorizeFile(entry.name);
        if (category === "ignore") {
          result.skippedCount++;
          continue;
        }

        try {
          if (category === "asset") {
            // Binary asset: copy to assets/
            const cleanName = source === "notion" ? cleanNotionName(entry.name) : entry.name;
            const destPath = join(assetsDir, cleanName);
            const data = await this.#fs.readBinaryFile(fullPath);
            await this.#fs.writeBinaryFile(destPath, data);
            result.assetsCount++;
            onProgress?.({
              notesProcessed: result.notesCount,
              assetsProcessed: result.assetsCount,
              currentFile: cleanName,
            });
            continue;
          }

          // Note file: read and process
          let raw = await this.#fs.readTextFile(fullPath);
          let fileName = entry.name;

          if (source === "notion") {
            fileName = cleanNotionName(fileName);
            raw = cleanNotionMarkdown(raw);
          } else if (source === "joplin") {
            raw = cleanJoplinMarkdown(raw).markdown;
          }

          // Turn into .md file format if not already .md
          const converted = convertToMarkdown(fileName, raw);

          // Calculate relative path inside target vault to preserve subfolder hierarchy if any
          const relDir = currentDir.slice(sourceDir.length).replace(/^\/+/, "");
          const targetDir = relDir ? join(targetVaultDir, relDir) : targetVaultDir;
          await this.#fs.mkdirp(targetDir);

          const destPath = join(targetDir, converted.targetFileName);
          await this.#fs.writeTextFile(destPath, converted.markdown);
          result.notesCount++;

          onProgress?.({
            notesProcessed: result.notesCount,
            assetsProcessed: result.assetsCount,
            currentFile: converted.targetFileName,
          });
        } catch (err) {
          result.errors.push({
            file: fullPath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return result;
  }
}
