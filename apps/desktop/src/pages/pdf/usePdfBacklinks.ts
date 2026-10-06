import { useEffect, useState } from "react";
import { dirname, pdfBacklinks } from "@granite/core-notes";
import type { PdfBacklinkRef } from "./PdfView";

/**
 * For each PDF (vault-relative paths) the notes that link into it. Rescans when the PDFs shown, the notes in the vault
 * or `tick` (bumped after a save) change. `readNote` gives a note's text, the unsaved text when it is open.
 */
export function usePdfBacklinks(pdfs: string[], notes: string[], tick: number, readNote: (rel: string) => Promise<string>): Record<string, PdfBacklinkRef[]> {
  const [found, setFound] = useState<Record<string, PdfBacklinkRef[]>>({});
  const key = pdfs.join("\n");

  useEffect(() => {
    if (!key) return setFound({});
    const wanted = key.split("\n");
    let dead = false;
    void (async () => {
      const out: Record<string, PdfBacklinkRef[]> = Object.fromEntries(wanted.map((p) => [p, []]));
      for (const note of notes) {
        if (!/\.(md|markdown)$/i.test(note)) continue;
        let text: string;
        try {
          text = await readNote(note);
        } catch {
          continue; // unreadable right now
        }
        if (dead) return;
        if (!text.includes(".pdf")) continue;
        const noteDir = dirname(note) === "." ? "" : dirname(note);
        for (const pdf of wanted) for (const b of pdfBacklinks(text, noteDir, pdf)) out[pdf]!.push({ ...b, note });
      }
      if (!dead) setFound(out);
    })();
    return () => {
      dead = true;
    };
  }, [key, notes, tick, readNote]);

  return found;
}
