import { test, expect } from '@playwright/test';

// Crawl every same-origin page reachable from the landing page and assert each
// navigation (and every asset it pulls in) returns < 400. This catches broken
// internal links — including base-path and Markdown-relative-link mistakes —
// and missing assets. Runs once (desktop only); the graph is base-agnostic.
test.describe('internal links & assets', () => {
  test('all internal links resolve and assets load', async ({ page, baseURL }, testInfo) => {
    // Crawl the graph once; it is base-agnostic across viewports.
    test.skip(testInfo.project.name !== 'desktop', 'crawl the link graph a single time');
    const origin = new URL(baseURL!).origin;
    const start = '/cadence/';
    const queue: string[] = [start];
    const seen = new Set<string>(queue);
    const badResponses: string[] = [];

    page.on('response', (res) => {
      if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`);
    });
    page.on('requestfailed', (req) => {
      badResponses.push(`FAILED ${req.url()} (${req.failure()?.errorText ?? '?'})`);
    });

    let visited = 0;
    while (queue.length > 0) {
      const path = queue.shift()!;
      const res = await page.goto(path, { waitUntil: 'networkidle' });
      expect(res, `no response for ${path}`).not.toBeNull();
      expect(res!.status(), `status for ${path}`).toBeLessThan(400);

      const hrefs = await page.$$eval('a[href]', (as) =>
        as.map((a) => (a as HTMLAnchorElement).href),
      );
      for (const h of hrefs) {
        if (!h.startsWith(origin)) continue; // skip external links
        const pathname = new URL(h).pathname; // drop hash + query
        // The composer is overlaid during Pages artifact assembly and has its
        // own deployment suite; Astro preview intentionally serves only site/.
        if (pathname.startsWith('/cadence/app/')) continue;
        if (!seen.has(pathname)) {
          seen.add(pathname);
          queue.push(pathname);
        }
      }

      if (++visited > 50) break; // safety valve; the site is small
    }

    expect(visited, 'expected to crawl the landing + docs pages').toBeGreaterThanOrEqual(8);
    expect(badResponses, `bad responses:\n${badResponses.join('\n')}`).toEqual([]);
  });
});
