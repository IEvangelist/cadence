---
layout: ../../layouts/DocsLayout.astro
title: Acknowledgements & third-party licenses
description: Third-party open-source components Cadence redistributes — including the LGPL-3.0 LAME MP3 encoder — with credits and pointers to their full license texts.
---

# Acknowledgements & third-party licenses

Cadence is open-source software licensed under the
[MIT License](https://github.com/IEvangelist/cadence/blob/main/LICENSE). It also
builds on third-party open-source projects that it **redistributes** as part of
the app. This page credits those projects and points to their licenses. The
authoritative, complete list — with the full license texts — lives in
[`THIRD-PARTY-NOTICES.md`](https://github.com/IEvangelist/cadence/blob/main/THIRD-PARTY-NOTICES.md)
at the root of the repository.

## Landing site design reference

The landing site's composition and motion language adapt the MIT-licensed
[PowerAI Astro](https://github.com/sitepins/powerai-astro) reference by Sitepins.
Cadence keeps its own brand, product copy, media, fonts, and deployment model.
The complete copyright and permission notice is preserved in
[`THIRD-PARTY-NOTICES.md`](https://github.com/IEvangelist/cadence/blob/main/THIRD-PARTY-NOTICES.md).

## Landing site browser runtime

The deployed landing page redistributes browser code from Astro's island
runtime and React renderer, React and React DOM, Scheduler, Motion and its
Framer Motion packages. Their exact versions, dependency graph, copyright
notices, and complete license terms are preserved in the
[landing site browser runtime notice](https://github.com/IEvangelist/cadence/blob/main/THIRD-PARTY-NOTICES.md#landing-site-browser-runtime).
Build-only packages such as Tailwind CSS and Vite plugins are not shipped to
the browser and are excluded from that runtime notice.

## MP3 export — the LAME encoder

Cadence's **MP3 export** is powered by the **LAME** MP3 encoder, via
[`@breezystack/lamejs`](https://www.npmjs.com/package/@breezystack/lamejs)
(version 1.2.7) — a pure-JavaScript port of LAME. It is used **unmodified** and
is loaded on demand, only when you export an MP3.

- **License:** GNU Lesser General Public License, version 3 or later
  (`LGPL-3.0-or-later`).
- **LAME project:** <https://lame.sourceforge.io/>
- **Package:** <https://www.npmjs.com/package/@breezystack/lamejs> — a fork of
  the original [`zhuker/lamejs`](https://github.com/zhuker/lamejs).

With thanks to the LAME project and its contributors for the encoder that makes
MP3 export possible.

## Licenses

| Component | Version | License |
| --- | --- | --- |
| [`@breezystack/lamejs`](https://www.npmjs.com/package/@breezystack/lamejs) | 1.2.7 | LGPL-3.0-or-later |
| [`react-router-dom`](https://www.npmjs.com/package/react-router-dom) | 7.18.2 | MIT |
| [`@radix-ui/react-dialog`](https://www.npmjs.com/package/@radix-ui/react-dialog) | 1.1.23 | MIT |
| [`@radix-ui/react-dropdown-menu`](https://www.npmjs.com/package/@radix-ui/react-dropdown-menu) | 2.1.24 | MIT |
| [`@radix-ui/react-popover`](https://www.npmjs.com/package/@radix-ui/react-popover) | 1.1.23 | MIT |
| [`@radix-ui/react-tooltip`](https://www.npmjs.com/package/@radix-ui/react-tooltip) | 1.2.16 | MIT |
| [`lucide-react`](https://www.npmjs.com/package/lucide-react) | 1.30.0 | ISC / MIT |
| [`@fontsource-variable/inter`](https://www.npmjs.com/package/@fontsource-variable/inter) | 5.3.0 | OFL-1.1 |
| [`@fontsource-variable/space-grotesk`](https://www.npmjs.com/package/@fontsource-variable/space-grotesk) | 5.3.0 | OFL-1.1 |
| [`@fontsource-variable/jetbrains-mono`](https://www.npmjs.com/package/@fontsource-variable/jetbrains-mono) | 5.3.0 | OFL-1.1 |
| [`astro`](https://www.npmjs.com/package/astro) | 7.1.6 | MIT |
| [`@astrojs/react`](https://www.npmjs.com/package/@astrojs/react) | 6.0.2 | MIT |
| [`react`](https://www.npmjs.com/package/react) | 19.2.8 | MIT |
| [`react-dom`](https://www.npmjs.com/package/react-dom) | 19.2.8 | MIT |
| [`scheduler`](https://www.npmjs.com/package/scheduler) | 0.27.0 | MIT |
| [`motion`](https://www.npmjs.com/package/motion) | 12.43.0 | MIT |
| [`framer-motion`](https://www.npmjs.com/package/framer-motion) | 12.43.0 | MIT |
| [`motion-dom`](https://www.npmjs.com/package/motion-dom) | 12.43.0 | MIT |
| [`motion-utils`](https://www.npmjs.com/package/motion-utils) | 12.39.0 | MIT |

Radix Dialog provides Cadence's accessible project/replacement dialogs.

The web and desktop apps distribute the complete OFL-1.1 text for the bundled
fonts and Lucide's ISC plus Feather MIT notices under `/licenses/`.

The full text of the GNU Lesser General Public License v3.0 and the GNU General
Public License v3.0 (which it supplements) is reproduced in
[`THIRD-PARTY-NOTICES.md`](https://github.com/IEvangelist/cadence/blob/main/THIRD-PARTY-NOTICES.md).
You can also read the canonical texts at
[gnu.org/licenses/lgpl-3.0](https://www.gnu.org/licenses/lgpl-3.0.txt) and
[gnu.org/licenses/gpl-3.0](https://www.gnu.org/licenses/gpl-3.0.txt).
