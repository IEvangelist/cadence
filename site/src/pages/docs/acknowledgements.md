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

The full text of the GNU Lesser General Public License v3.0 and the GNU General
Public License v3.0 (which it supplements) is reproduced in
[`THIRD-PARTY-NOTICES.md`](https://github.com/IEvangelist/cadence/blob/main/THIRD-PARTY-NOTICES.md).
You can also read the canonical texts at
[gnu.org/licenses/lgpl-3.0](https://www.gnu.org/licenses/lgpl-3.0.txt) and
[gnu.org/licenses/gpl-3.0](https://www.gnu.org/licenses/gpl-3.0.txt).
