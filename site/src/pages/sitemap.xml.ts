import type { APIRoute } from 'astro';
import { docsNav } from '../lib/nav';
import { href } from '../lib/href';

// Static, zero-dependency sitemap for the landing page + every docs route.
// Prerendered at build time so it ships as a plain /cadence/sitemap.xml file on
// GitHub Pages (referenced from public/robots.txt).
export const prerender = true;

// docsNav already includes the `/docs/` overview, so the landing root is the
// only extra route to list.
const paths = ['/', ...docsNav.map((doc) => doc.path)];

export const GET: APIRoute = ({ site }) => {
  const origin = site ?? new URL('https://ievangelist.github.io');
  const lastmod = new Date().toISOString().slice(0, 10);

  const urls = paths
    .map((path) => new URL(href(path), origin).toString())
    .map(
      (loc) =>
        `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
