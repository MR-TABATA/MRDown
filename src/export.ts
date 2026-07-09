// Turning the rendered preview into a standalone, shareable HTML file.
//
// The stylesheet is not duplicated here: it is read back out of the live
// document at export time and re-scoped from `#output` to `.mrdown`, so an
// exported file can never drift from what the preview shows. Fonts and images
// are embedded as data URIs, because `asset:` URLs only resolve inside the app.

export interface ExportDoc {
  lang: string;
  title: string;
  css: string;
  /** Inline custom properties from <html> — the user's appearance overrides. */
  rootStyle: string;
  body: string;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/** Assemble the final self-contained document. Pure, so it can be unit-tested. */
export function buildExportDocument(d: ExportDoc): string {
  const title = d.title.replace(/[&<>]/g, (c) => ESCAPES[c]);
  return `<!doctype html>
<html lang="${d.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${d.css}
${d.rootStyle ? `:root { ${d.rootStyle} }` : ''}
/* The preview rule set leaves .mrdown hidden and width-bound to the app's
   layout; give the standalone page its own readable column instead. */
body { margin: 0; background: var(--mrd-bg); color: var(--mrd-text); }
.mrdown { display: block; max-width: 760px; margin: 0 auto; padding: 40px 24px 64px; }
</style>
</head>
<body>
<article class="mrdown">
${d.body}
</article>
</body>
</html>
`;
}

/** Fetch a URL and return it as a `data:` URI, so the export stands alone. */
async function toDataUrl(src: string): Promise<string> {
  const res = await fetch(src);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// A KaTeX @font-face lists woff2/woff/ttf; keeping only woff2 avoids tripling
// the embedded payload, and every browser that renders this understands it.
function woff2Only(cssText: string): string {
  return cssText.replace(/src:\s*([^;]+);/, (whole, list: string) => {
    const woff2 = list.split(',').map((s) => s.trim()).find((s) => s.includes('woff2'));
    return woff2 ? `src: ${woff2};` : whole;
  });
}

/**
 * Pull the preview's own rules out of the live stylesheets, re-scoped to
 * `.mrdown`. `:root` carries the appearance tokens; KaTeX's rules and fonts
 * come along only when the document actually contains maths.
 */
export function collectCss(needsKatex: boolean): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRule[];
    try {
      rules = Array.from(sheet.cssRules);
    } catch {
      continue; // cross-origin sheet — nothing we can read
    }
    for (const rule of rules) {
      if (rule instanceof CSSFontFaceRule) {
        if (needsKatex && rule.cssText.includes('KaTeX')) out.push(woff2Only(rule.cssText));
      } else if (rule instanceof CSSStyleRule) {
        const sel = rule.selectorText;
        if (sel === ':root') out.push(rule.cssText);
        else if (sel.includes('#output')) out.push(rule.cssText.replace(/#output/g, '.mrdown'));
        else if (needsKatex && sel.includes('.katex')) out.push(rule.cssText);
      }
      // @media (print rules, etc.) belong to the app, not the export.
    }
  }
  return out.join('\n');
}

/** Replace every `url(...)` in the collected CSS with an embedded data URI. */
export async function inlineCssUrls(css: string): Promise<string> {
  const pattern = /url\((['"]?)([^'")]+)\1\)/g;
  const urls = [...new Set(Array.from(css.matchAll(pattern), (m) => m[2]))].filter(
    (u) => !u.startsWith('data:')
  );
  const embedded = new Map<string, string>();
  await Promise.all(
    urls.map(async (u) => {
      try {
        embedded.set(u, await toDataUrl(u));
      } catch {
        /* leave the original URL in place */
      }
    })
  );
  return css.replace(pattern, (whole, _q, u: string) => {
    const data = embedded.get(u);
    return data ? `url(${data})` : whole;
  });
}

/** Embed each image in the cloned article, so it survives outside the app. */
export async function inlineImages(root: HTMLElement): Promise<void> {
  await Promise.all(
    Array.from(root.querySelectorAll('img')).map(async (img) => {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:')) return;
      try {
        img.setAttribute('src', await toDataUrl(src));
      } catch {
        /* unreachable image — leave the reference as it was */
      }
    })
  );
}

/** Strip the transient find highlights so they don't bake into the export. */
export function stripFindHighlights(root: HTMLElement): void {
  root.querySelectorAll('mark.find-hit').forEach((m) => {
    m.replaceWith(document.createTextNode(m.textContent ?? ''));
  });
}

/**
 * Remove the app's interactive affordances from the copy being exported: the
 * copy buttons are chrome, and a task checkbox has no source to rewrite once
 * the document has left the app.
 */
export function stripInteractive(root: HTMLElement): void {
  root.querySelectorAll('.code-copy').forEach((b) => b.remove());
  root.querySelectorAll('input[type="checkbox"]').forEach((c) => c.setAttribute('disabled', ''));
}
