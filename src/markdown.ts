// Pure Markdown-rendering helpers — no DOM or Tauri dependencies.

/**
 * Build a URL-friendly id from heading text. Keeps unicode letters/numbers
 * (so Japanese headings survive) and collapses whitespace to hyphens.
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '');
}
