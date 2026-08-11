/**
 * Active typeface pairing for the marketing site (issue #78).
 *
 * Flip `ACTIVE_TYPEFACE` to change the shipped default in one place: it drives
 * both the `<html data-typeface>` attribute (which selects the --font-* tokens
 * in tokens.css) and the `<link rel="preload">` hints in BaseLayout, so the
 * active display + body woff2 are always the ones that get preloaded.
 *
 * All three pairings are self-hosted (see /public/fonts/fonts.css); only the
 * active pair is preloaded, and the browser never fetches the unreferenced
 * faces. David can approve the default below or pick an alternative key.
 */
export type TypefaceKey = 'bricolage' | 'fraunces' | 'sora';

export interface TypefacePairing {
  /** Human-readable pairing name for docs/PR copy. */
  readonly label: string;
  /** Display (headline + wordmark) woff2 filename under /public/fonts. */
  readonly display: string;
  /** Body (docs + pricing copy) woff2 filename under /public/fonts. */
  readonly body: string;
}

export const TYPEFACES: Record<TypefaceKey, TypefacePairing> = {
  bricolage: {
    label: 'Bricolage Grotesque + Inter',
    display: 'bricolage-grotesque-var-latin.woff2',
    body: 'inter-var-latin.woff2',
  },
  fraunces: {
    label: 'Fraunces + Manrope',
    display: 'fraunces-var-latin.woff2',
    body: 'manrope-var-latin.woff2',
  },
  sora: {
    label: 'Sora + Inter',
    display: 'sora-var-latin.woff2',
    body: 'inter-var-latin.woff2',
  },
};

/** The shipped default. Change this one line to pick an alternative pairing. */
export const ACTIVE_TYPEFACE: TypefaceKey = 'bricolage';
