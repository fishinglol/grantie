/** Structured view of a parsed markdown note. All fields are derived purely from the raw file text. */

export type FrontmatterValue = string | number | boolean | null | Array<string | number | boolean | null>;

export interface Frontmatter {
  [key: string]: FrontmatterValue;
}

export interface Heading {
  level: number;
  text: string;
  /** 0-based line index within the body (frontmatter excluded). */
  line: number;
}

export interface ImageRef {
  alt: string;
  /** src exactly as written in the markdown, e.g. "assets/2026-photo.png". */
  src: string;
  line: number;
  /** false when src is an http(s) or data: URL. */
  isLocal: boolean;
}

export interface LinkRef {
  text: string;
  href: string;
  line: number;
  isExternal: boolean;
}

export interface ParsedNote {
  frontmatter: Frontmatter;
  /** Markdown body with the frontmatter block stripped. */
  body: string;
  /** frontmatter.title, else the first H1, else null. */
  title: string | null;
  headings: Heading[];
  images: ImageRef[];
  links: LinkRef[];
  /** Rough word count of the body, for note lists / previews. */
  wordCount: number;
}
