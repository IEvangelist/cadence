const base = import.meta.env.BASE_URL; // e.g. "/cadence/"

/**
 * Build an internal URL that respects the configured Astro `base` path so links
 * work both locally (astro preview) and under the GitHub Pages sub-path.
 */
export function href(path: string): string {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return base.endsWith('/') ? `${base}${clean}` : `${base}/${clean}`;
}
