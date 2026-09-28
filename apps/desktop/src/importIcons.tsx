import type { ReactNode } from "react";
import obsidian from "./assets/brands/obsidian.svg";
import evernote from "./assets/brands/evernote.svg";
import notion from "./assets/brands/notion.svg";
import joplin from "./assets/brands/joplin.svg";
import onenote from "./assets/brands/microsoftonenote.svg";

/** Official brand marks (simple-icons, CC0), tinted with each brand's colour. Notion's is black, so it follows the text. */
const BRANDS: Record<string, { svg: string; color: string }> = {
  obsidian: { svg: obsidian, color: "#7C3AED" },
  evernote: { svg: evernote, color: "#00A82D" },
  notion: { svg: notion, color: "var(--h)" },
  joplin: { svg: joplin, color: "#1071D3" },
  onenote: { svg: onenote, color: "#A24BD0" },
};

export function SourceIcon({ kind, size = 14 }: { kind: string; size?: number }) {
  const brand = BRANDS[kind];
  if (!brand) return <UiIcon size={size}>{PATHS.folder}</UiIcon>;
  return (
    <span
      className="brand-icon"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        backgroundColor: brand.color,
        WebkitMaskImage: `url("${brand.svg}")`,
        maskImage: `url("${brand.svg}")`,
      }}
    />
  );
}

const PATHS = {
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  home: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </>
  ),
};

function UiIcon({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function UiGlyph({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return <UiIcon size={size}>{PATHS[name]}</UiIcon>;
}
