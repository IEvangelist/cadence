/** Documentation navigation — single source for the docs sidebar + footer. */
export interface DocLink {
  readonly title: string;
  readonly path: string; // base-relative, passed through href()
}

export const docsNav: readonly DocLink[] = [
  { title: 'Overview', path: '/docs/' },
  { title: 'Getting started', path: '/docs/getting-started/' },
  { title: 'Architecture', path: '/docs/architecture/' },
  { title: 'Features', path: '/docs/features/' },
  { title: 'Self-hosting & deploy', path: '/docs/self-hosting/' },
  { title: 'Authentication', path: '/docs/auth/' },
  { title: 'Versioning policy', path: '/docs/versioning/' },
];
