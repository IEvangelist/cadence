// @ts-check
import { defineConfig } from 'astro/config';

/**
 * Make code blocks keyboard-focusable so a horizontally-scrollable <pre>
 * (on narrow viewports) can be reached and scrolled with the keyboard —
 * WCAG 2.1.1. Shiki adds this automatically; since we disable Shiki
 * highlighting (for AA contrast), we re-add tabindex="0" ourselves.
 */
function rehypeFocusableCodeBlocks() {
  /** @param {any} tree */
  return (tree) => {
    /** @param {any} node */
    const visit = (node) => {
      if (node.type === 'element' && node.tagName === 'pre') {
        node.properties = node.properties ?? {};
        node.properties.tabIndex = 0;
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}

// GitHub Pages project site: https://ievangelist.github.io/cadence
// `base` keeps the app working under the /cadence sub-path; internal links use
// the href() helper (or Markdown-relative links) so they stay base-correct.
export default defineConfig({
  site: 'https://ievangelist.github.io',
  base: '/cadence',
  trailingSlash: 'ignore',
  // When the Aspire AppHost launches this site it injects the port to listen on
  // via PORT and reaches the dev server through its proxy, so honor PORT (and
  // bind all interfaces so the proxy can connect) whenever it is set. A plain
  // `npm run dev` leaves PORT unset and keeps Astro's defaults; the Playwright
  // suite runs `astro preview --port 4321`, which is unaffected.
  server: process.env.PORT
    ? { host: true, port: Number(process.env.PORT) }
    : {},
  build: {
    // Emit clean directory URLs (docs/getting-started/ -> index.html).
    format: 'directory',
  },
  markdown: {
    // Disable Shiki's editor-theme highlighting: its comment colors fail
    // WCAG-AA contrast. Plain code blocks inherit the high-contrast,
    // token-based `.prose pre` styling instead (neutral-50 on neutral-900).
    syntaxHighlight: false,
    rehypePlugins: [rehypeFocusableCodeBlocks],
  },
});
