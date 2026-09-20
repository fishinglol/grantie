import { embedImage, type EmbedImageInput } from "./embedImage.ts";
import type { FileSystem } from "./fs.ts";
import { parseNote } from "./parseNote.ts";
import { dirname, join } from "./path.ts";
import type { ParsedNote } from "./types.ts";

export interface LoadedNote extends ParsedNote {
  path: string;
  /** Raw file text, unmodified. */
  raw: string;
}

export interface InsertImageOptions {
  notePath: string;
  image: EmbedImageInput["image"];
  altText?: string;
  insertAt?: number;
  assetsDirName?: string;
  now?: () => Date;
}

export interface InsertImageResult {
  note: LoadedNote;
  /** The markdown snippet that was inserted. */
  markdown: string;
  /** Absolute/repo path where the image was written (or would be). */
  imagePath: string;
}

/**
 * Thin orchestration layer: combines the pure functions with a {@link FileSystem}
 * adapter. Still platform-agnostic — the only IO goes through `fs`.
 */
export class NoteRepository {
  readonly #fs: FileSystem;

  constructor(fs: FileSystem) {
    this.#fs = fs;
  }

  async load(path: string): Promise<LoadedNote> {
    const raw = await this.#fs.readTextFile(path);
    return { path, raw, ...parseNote(raw) };
  }

  async save(path: string, content: string): Promise<LoadedNote> {
    await this.#fs.writeTextFile(path, content);
    return { path, raw: content, ...parseNote(content) };
  }

  async insertImage(opts: InsertImageOptions): Promise<InsertImageResult> {
    const raw = await this.#fs.readTextFile(opts.notePath);
    const assetsDirName = opts.assetsDirName ?? "assets";

    const result = embedImage({
      content: raw,
      image: opts.image,
      altText: opts.altText,
      insertAt: opts.insertAt,
      assetsDirName,
      now: opts.now,
    });

    const noteDir = dirname(opts.notePath);
    const imagePath = join(noteDir, result.relativeSrc);

    if (result.write) {
      await this.#fs.mkdirp(join(noteDir, assetsDirName));
      await this.#fs.writeBinaryFile(imagePath, result.write.data);
    }
    await this.#fs.writeTextFile(opts.notePath, result.content);

    return {
      note: { path: opts.notePath, raw: result.content, ...parseNote(result.content) },
      markdown: result.markdown,
      imagePath,
    };
  }
}
