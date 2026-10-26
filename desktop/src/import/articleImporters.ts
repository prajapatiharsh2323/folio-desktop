// TXT/HTML importers (02 §6): paragraphs, Devanagari language detect, 3–5 chapter split.
import { detectLanguage } from "./fileDetector";
import {
  paragraphsFromHtml,
  sanitizeHtml,
  splitChapters,
  type ExtractedImage,
} from "./sanitize";
import type { BuilderChapter } from "./clip/epubBuilder";

export interface ArticleImport {
  title: string;
  author: string | null;
  language: "en" | "hi";
  chapters: BuilderChapter[];
  /** sanitized clean/index.html body */
  cleanHtml: string;
  images: ExtractedImage[];
  wordCount: number;
}

function countWords(chapters: BuilderChapter[]): number {
  const text = chapters.map((c) => c.html.replace(/<[^>]+>/g, " ")).join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}

export function chapterHtmlFromParagraphs(paragraphs: string[]): string {
  return paragraphs.map((p) => `<p>${p}</p>`).join("\n");
}

export async function importHtml(
  html: string,
  fallbackTitle: string
): Promise<ArticleImport> {
  const { html: clean, title, images } = await sanitizeHtml(html);
  const paragraphs = paragraphsFromHtml(clean);
  const groups = splitChapters(paragraphs);
  const chapters: BuilderChapter[] = groups.map((g, i) => ({
    title: `Part ${i + 1}`,
    html: chapterHtmlFromParagraphs(g),
  }));
  return {
    title: title || fallbackTitle,
    author: null,
    language: detectLanguage(paragraphs.join("\n")),
    chapters,
    cleanHtml: `<article>${clean}</article>`,
    images,
    wordCount: countWords(chapters),
  };
}

export function importTxt(text: string, fallbackTitle: string): ArticleImport {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const groups = splitChapters(paragraphs);
  const chapters: BuilderChapter[] = groups.map((g, i) => ({
    title: `Part ${i + 1}`,
    html: chapterHtmlFromParagraphs(g.map((p) => escapeHtml(p))),
  }));
  const firstLine = paragraphs[0] ?? "";
  const title = firstLine.length > 0 && firstLine.length <= 80 ? firstLine : fallbackTitle;
  return {
    title,
    author: null,
    language: detectLanguage(text),
    chapters,
    cleanHtml: "",
    images: [],
    wordCount: countWords(chapters),
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
