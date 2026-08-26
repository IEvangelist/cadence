# UX final gate

Issue #160 is the top of the UX redesign stack. Its authoritative visual
baselines are generated only after #154-#159 are merged into the #159 parent
branch. Until then, final-gate helpers remain isolated under
`apps/web/e2e/final-gate`.

The isolated final-gate servers use web port 4260 and collaboration relay port
4360 with server reuse disabled. Every final-gate Playwright result attaches the
served git HEAD, working-tree dirty state, and base URL so cross-worktree port
contamination is visible. The complete per-test audit is written to
`test-results/final-gate/audit-summary.json`.

## Deterministic capture protocol

- Run the production build through Playwright's `vite preview` server.
- Use Linux Chromium, device scale factor 1, locale `en-US`, timezone `UTC`,
  reduced motion, disabled service workers, and stopped transport.
- Capture 390x844, 768x1024, and 1440x900 in explicit light and dark themes.
- Seed fixed ids, names, notes, colors, account state, entitlements, timestamps,
  stem results, and API responses through `fixtures.ts`.
- Wait for route content, project hydration, `document.fonts.ready`, two animation
  frames, and the absence of busy regions before comparison.
- Prefer deterministic state to masking. Masks are limited to genuinely native
  or external nondeterminism and must never cover workspace chrome, rows,
  editor, inspector, toolbar, focus state, or responsive navigation.

## Regression matrix

| Gate | Required proof |
|---|---|
| Interaction manifest | Every registered interaction and every derived interaction family is observed; rendered controls have registered ids, roles, names, outcomes, and executable behavior coverage. |
| Accessibility | Every route and critical state in `finalGateAxeMatrix` is axe-clean in light/dark; keyboard focus is visible and modal/sheet focus returns correctly. |
| Keyboard | Project creation/open/import, transport, track selection, note editing, Basic AI accept/discard, save/share, route navigation, and shortcut help complete without pointer input. |
| Mobile | 390x844 Project, Tracks, Notes, and Tools tasks cover touch-safe draw/pan/select/edit, transport, save/share, Basic AI, safe areas, reduced motion, and attached-keyboard behavior. |
| Geometry | At 1440x900 and 1280x800 Studio owns 100dvh, document height stays within viewport +1px, piano roll remains visible, and only designated regions scroll. |
| Visual | Intentional core snapshots cover Start Center, Write default/detail, Mix, AI Basic/locked Advanced, four mobile tasks, auth, Profile, Pricing Free/Pro, Stems Free/complete, and Licenses. |
| Audio | Real playback and edited-note output clear the RMS floor; automation silence stays below it; transport is stopped for screenshots. |
| Collaboration | Two editors converge, viewers stay read-only, presence renders, route disposal/reconnect is correct, and local undo does not remove remote edits. |
| PWA/offline | Manifest and service worker are valid, shell and warmed routes reopen offline, and authenticated API responses are never cached. |
| Formats/entitlements | Project, MIDI, MusicXML, WAV, MP3, share, watermark, Free/Pro gating, billing, and stem flows preserve their existing unit/e2e contracts. |
| Desktop/Tauri | Web build precedes Tauri checks; Rust format and Clippy remain green against the final web assets. |
| Bundle | `npm run test:bundle-size --workspace @cadence/web` compares the built entry plus every initial module-preload asset against `ce511e3` (222,450-byte gzip; 244,695-byte +10% ceiling). Growth above the ceiling blocks unless explicitly justified. |

Runtime interaction and bundle reports are written as Playwright attachments or
under ignored `test-results/final-gate`; committed files contain only protocol,
baseline inputs, helpers, and approved Linux snapshots.

The integrated pre-snapshot checkpoint measures 214,823 gzip bytes across the
initial entry and module-preload graph, 3.43% below the 222,450-byte baseline.

## Whole-song loop invariant

For locally authored timeline changes and projects entering through
`load-project`, the reducer maintains `project.loop.end >=
project.lengthBeats`. Cadence exposes Loop as a whole-song toggle rather than an
A/B region, so letting the loop end trail the project would make later notes
inaudible. Timeline growth from a single note, an accepted AI batch, note
resizing, explicit length changes, and stale project loading all grow the loop
as needed.

The executable contract is covered by the existing
[`loop follows the timeline (whole-song loop)` reducer tests](../apps/web/src/composer/model/reducer.test.ts#L116-L216),
including the
[`load-project` repair for stale stored length and loop data](../apps/web/src/composer/model/reducer.test.ts#L179-L204).
`sync-remote` is the deliberate boundary exception: it adopts the converged
CRDT document verbatim to remain echo-safe, as asserted by the
[`sync-remote` convergence test](../apps/web/src/composer/model/reducer.test.ts#L206-L215);
the invariant is restored when that document later enters through
`load-project`.
