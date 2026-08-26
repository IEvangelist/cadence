import { test, expect } from '@playwright/test';

test('hero hierarchy and CTA fit the initial viewport', async ({ page }) => {
  await page.goto('/cadence/', { waitUntil: 'networkidle' });

  const heading = page.getByRole('heading', { level: 1, name: 'Make the idea land.' });
  const primaryCta = page.locator('.hero-actions').getByRole('link', {
    name: 'Open web composer',
  });
  await expect(heading).toBeVisible();
  await expect(primaryCta).toBeVisible();

  const [headingBox, ctaBox, viewport] = await Promise.all([
    heading.boundingBox(),
    primaryCta.boundingBox(),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  ]);
  expect(headingBox).not.toBeNull();
  expect(ctaBox).not.toBeNull();
  expect(ctaBox!.y + ctaBox!.height).toBeLessThanOrEqual(viewport.height);

  const lineCount = await heading.evaluate((element) => {
    const style = getComputedStyle(element);
    return Math.round(element.getBoundingClientRect().height / Number.parseFloat(style.lineHeight));
  });
  expect(lineCount).toBeLessThanOrEqual(2);
});

test('navigation is one line and no taller than 80px on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop navigation contract');
  await page.goto('/cadence/', { waitUntil: 'networkidle' });

  const header = page.locator('.site-header');
  const nav = page.locator('.nav-desktop');
  await expect(nav).toBeVisible();

  const headerBox = await header.boundingBox();
  expect(headerBox).not.toBeNull();
  expect(headerBox!.height).toBeLessThanOrEqual(80);

  const linkCenters = await nav.locator('a').evaluateAll((links) =>
    links.map((link) => {
      const box = link.getBoundingClientRect();
      return Math.round(box.top + box.height / 2);
    }),
  );
  expect(Math.max(...linkCenters) - Math.min(...linkCenters)).toBeLessThanOrEqual(1);

  const webApp = nav.getByRole('link', { name: 'Open web app' });
  await expect(webApp).toHaveAttribute('href', '/cadence/app/');
  expect(await webApp.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
});

test('mobile navigation opens, closes, and restores the collapsed state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile navigation contract');
  await page.goto('/cadence/', { waitUntil: 'networkidle' });

  const menu = page.locator('[data-mobile-nav]');
  const toggle = menu.getByText('Menu', { exact: true });
  await expect(page.locator('.nav-desktop')).toBeHidden();
  await expect(toggle).toBeVisible();

  await toggle.click();
  await expect(menu).toHaveAttribute('open', '');
  await expect(menu.getByRole('navigation', { name: 'Mobile primary' })).toBeVisible();

  await menu.getByRole('link', { name: 'Features' }).click();
  await expect(menu).not.toHaveAttribute('open', '');
  await expect(page).toHaveURL(/#features$/);
});

test('theme preference cycles and persists with the product storage contract', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'theme contract runs once');
  await page.goto('/cadence/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('cadence.v1.theme'));
  await page.reload({ waitUntil: 'networkidle' });

  const toggle = page.locator('[data-interaction="nav.theme"]');
  await expect(toggle).toHaveAccessibleName(/Theme preference: System/);
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAccessibleName(/Theme preference: Light/);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAccessibleName(/Theme preference: Light/);

  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await toggle.click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expect(toggle).toHaveAccessibleName(/Theme preference: System/);
});

test('system theme and reduced motion preferences are honored', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'preference contract runs once');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/cadence/', { waitUntil: 'networkidle' });

  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  const state = await page.locator('[data-reveal]').first().evaluate((element) => ({
    opacity: (element as HTMLElement).style.opacity,
    transform: (element as HTMLElement).style.transform,
    background: getComputedStyle(document.body).backgroundColor,
    orbitAnimation: getComputedStyle(document.querySelector('.hero-orbit--one')!).animationName,
  }));
  expect(state.opacity).toBe('1');
  expect(state.transform).toBe('none');
  expect(state.background).toBe('rgb(14, 10, 26)');
  expect(state.orbitAnimation).toBe('none');
});

test('motion reveals hierarchy as sections enter the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'motion contract runs once');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/cadence/', { waitUntil: 'networkidle' });

  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  const target = page.locator('.ai-copy');
  await target.scrollIntoViewIfNeeded();
  await expect(target).toHaveCSS('opacity', '1');
  await expect(target).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
});

test('FAQ uses keyboard-accessible native disclosure controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'FAQ interaction runs once');
  await page.goto('/cadence/', { waitUntil: 'networkidle' });

  const details = page.locator('.faq-list details').nth(1);
  const summary = details.locator('summary');
  await expect(details).not.toHaveAttribute('open', '');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details.getByText(/Cadence round-trips MIDI/)).toBeVisible();
});

test('landing metadata and base-aware assets preserve the Pages contract', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'metadata contract runs once');
  await page.goto('/cadence/', { waitUntil: 'networkidle' });

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://ievangelist.github.io/cadence/',
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://ievangelist.github.io/cadence/',
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    'https://ievangelist.github.io/cadence/brand/og-image.png',
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    'content',
    'summary_large_image',
  );

  const assetPaths = await page.locator('img').evaluateAll((images) =>
    images.map((image) => new URL((image as HTMLImageElement).src).pathname),
  );
  expect(assetPaths.length).toBeGreaterThanOrEqual(3);
  expect(assetPaths.every((path) => path.startsWith('/cadence/'))).toBe(true);
});

test('deployed acknowledgements expose complete browser runtime notices', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'license content contract runs once');
  await page.goto('/cadence/docs/acknowledgements/', { waitUntil: 'networkidle' });

  await expect(
    page.getByRole('heading', { name: 'Landing site browser runtime' }),
  ).toBeVisible();
  const notice = page.getByRole('link', { name: 'landing site browser runtime notice' });
  await expect(notice).toHaveAttribute(
    'href',
    'https://github.com/IEvangelist/cadence/blob/main/THIRD-PARTY-NOTICES.md#landing-site-browser-runtime',
  );
  await expect(page.getByRole('cell', { name: 'react', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'motion', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'tslib', exact: true })).toHaveCount(0);
});

test('homepage claims match the shipped Free and Pro product surface', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'content contract runs once');
  await page.goto('/cadence/', { waitUntil: 'networkidle' });

  await expect(page.getByRole('heading', { name: 'Free', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pro', exact: true })).toBeVisible();
  await expect(page.getByText('$12', { exact: true })).toBeVisible();
  await expect(page.getByText(/on-device AI beside you/)).toBeVisible();
  await expect(page.getByText(/server-side AI/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Studio', exact: true })).toHaveCount(0);
  await expect(page.getByText('Priority updates', { exact: true })).toHaveCount(0);
});

test('visible copy and repeated CTA intents pass the design copy gate', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'copy gate runs once');
  await page.goto('/cadence/', { waitUntil: 'networkidle' });

  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toMatch(/[—–]/);

  const downloadLabels = await page
    .locator('[data-interaction$=".download"], [data-interaction="download.release"]')
    .allInnerTexts();
  expect(downloadLabels.length).toBeGreaterThanOrEqual(2);
  expect(downloadLabels.every((label) => label.trim() === 'Download')).toBe(true);

  const webAppLinks = page.locator(
    '[data-interaction="hero.web-app"], [data-interaction="nav.web-app"]',
  );
  await expect(webAppLinks).toHaveCount(2);
  await expect(webAppLinks.first()).toHaveAttribute('href', '/cadence/app/');
  await expect(
    page.getByText(/public web app has no hosted backend/i),
  ).toBeVisible();
});

test('landing layout remains stable and interactive work stays below 200ms', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'performance contract runs once');
  await page.addInitScript(() => {
    const metrics = window as Window & { __cadenceCls?: number; __cadenceLcp?: number };
    metrics.__cadenceCls = 0;
    metrics.__cadenceLcp = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntry[]) {
        const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!shift.hadRecentInput) {
          metrics.__cadenceCls! += shift.value ?? 0;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last) metrics.__cadenceLcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.goto('/cadence/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(100);

  const metrics = await page.evaluate(() => {
    const values = window as Window & { __cadenceCls?: number; __cadenceLcp?: number };
    return { cls: values.__cadenceCls ?? 0, lcp: values.__cadenceLcp ?? 0 };
  });
  expect(metrics.cls).toBeLessThan(0.1);
  expect(metrics.lcp).toBeGreaterThan(0);
  expect(metrics.lcp).toBeLessThan(2_500);

  const interactionMs = await page.locator('[data-interaction="nav.theme"]').evaluate(
    async (element) => {
      const start = performance.now();
      (element as HTMLButtonElement).click();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return performance.now() - start;
    },
  );
  expect(interactionMs).toBeLessThan(200);
});
