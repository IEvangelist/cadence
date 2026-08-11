---
layout: ../../layouts/DocsLayout.astro
title: Plugin SDK
description: Author a Cadence composer plugin — contribute instruments, effects, import/export formats, AI providers, commands, and panels through one typed, in-process host.
---

# Plugin SDK

Cadence's composer is built around a small, typed **Plugin SDK**. Everything the
app ships — its instruments, its import/export formats, its AI providers — is a
plugin registered through the *same* host a third-party plugin uses. There is no
privileged built-in path: the core plugin is just a plugin whose manifest is
flagged `builtin: true`.

This page mirrors
[`docs/plugins.md`](https://github.com/IEvangelist/cadence/blob/main/docs/plugins.md)
and is grounded in the SDK source under
[`apps/web/src/composer/plugins/`](https://github.com/IEvangelist/cadence/tree/main/apps/web/src/composer/plugins).

- **Where it lives:** `apps/web/src/composer/plugins/`
- **Public surface:** `import { … } from '../plugins'` — the
  [`index.ts`](https://github.com/IEvangelist/cadence/blob/main/apps/web/src/composer/plugins/index.ts)
  barrel re-exports the contracts, the host, manifest validation, the
  preferences store, keybinding helpers, and the reference example plugin.
- **Runtime dependencies added:** none. Tone/React types are imported
  `type`-only, so nothing heavy is pulled into the SDK bundle.

> **Scope.** This is an in-process, typed *module* plugin model. Remote loading,
> a marketplace, and untrusted-plugin sandboxing are intentionally out of scope
> today — plugins are imported modules compiled into the app and run with full
> app privileges. The current surface is the seam those follow-ups will build on.

## Mental model

A plugin is a **plain module object**: a `manifest` (identity) plus a set of
typed `contributes` (capabilities). You register it with a **host**, the host
validates the manifest, and when the plugin is **activated** its contributions
go live. The composer reads only the contributions of *active* plugins.

```
register(plugin)  →  activate(id)  →  contributions live  →  dispose(id)
     │                                                            │
 validate manifest                                    hidden, still registered
```

The full contract is [`CadencePlugin`](https://github.com/IEvangelist/cadence/blob/main/apps/web/src/composer/plugins/types.ts):

```ts
interface CadencePlugin {
  manifest: PluginManifest
  contributes?: PluginContributions
  activate?: (host: PluginHostApi) => void | Promise<void>
  dispose?: () => void
}
```

There are six extension points, all optional fields on `PluginContributions`:

| Point | Field | What it adds |
|---|---|---|
| Instrument | `instruments` | a selectable voice the audio engine can play |
| Effect | `effects` | a node inserted into the master audio chain |
| Format | `formats` | an exporter and/or importer in the project toolbar |
| AI provider | `aiProviders` | a composition-assistant backend |
| Command | `commands` | an action with an optional keybinding |
| Panel | `panels` | a React surface in the composer sidebar |

## Quick start

The smallest useful plugin — one command:

```ts
import type { CadencePlugin } from '../plugins'

export function createGreeter(): CadencePlugin {
  return {
    manifest: { id: 'acme.greeter', name: 'Greeter', version: '1.0.0' },
    contributes: {
      commands: [
        {
          id: 'acme.greet',
          title: 'Say hello',
          keybinding: 'mod+shift+g',
          run: (api) => api.notify('Hello from a plugin!'),
        },
      ],
    },
  }
}
```

Register it (inactive) with the default host and it appears in the composer's
**Extensions** panel, ready to enable:

```ts
import { defaultPluginHost } from '../plugins'

defaultPluginHost.register(createGreeter())
```

## The manifest

```ts
interface PluginManifest {
  id: string          // stable, unique, e.g. "acme.extra-instruments"
  name: string        // shown in the Extensions panel
  version: string     // semantic version, e.g. "1.0.0"
  description?: string
  author?: string
  builtin?: boolean   // reserved for the always-on core plugin
}
```

`register()` runs
[`validateManifest()`](https://github.com/IEvangelist/cadence/blob/main/apps/web/src/composer/plugins/manifest.ts),
which throws a typed `PluginManifestError` if the `id`/`name` is missing or
`version` isn't a semantic version. There is **no schema library** — the check
is a few lines of hand-rolled validation, so the SDK adds zero runtime
dependencies.

## Extension points

### Instrument

An instrument is metadata (an `InstrumentDefinition`) plus a **voice factory**.
The factory is called only when the engine builds a voice, so importing your
module never touches the audio context.

```ts
import * as Tone from 'tone'
import { pitchToName } from '../../model/project'
import type { InstrumentVoice, InstrumentVoiceContext } from '../plugins'

function createMusicBoxVoice(context: InstrumentVoiceContext): InstrumentVoice {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.005, release: 1.2 },
  }).connect(context.output)          // wire into the master chain
  return {
    trigger: (pitch, duration, time, velocity) =>
      synth.triggerAttackRelease(pitchToName(pitch), duration, time, velocity),
    dispose: () => synth.dispose(),
  }
}

// contributes:
instruments: [
  {
    id: 'music-box',
    name: 'Music Box',
    kind: 'synth',                    // 'synth' | 'drum'
    description: 'A soft sine voice with a gentle bell-like release.',
    polyphonic: true,
    group: 'Keys',                    // optional picker grouping
    createVoice: createMusicBoxVoice,
  },
]
```

Once the plugin is active, the instrument appears in every track's instrument
dropdown and the engine plays it — no other wiring required. The optional
`group` label (`Keys`, `Bass`, `Pads`, …) is purely presentational: the picker
buckets instruments that share a group under an `<optgroup>`.

The core plugin dogfoods this exact seam. Its
[built-in library](https://github.com/IEvangelist/cadence/tree/main/apps/web/src/composer/plugins/builtins)
of **64 instruments** — poly/FM synths, an expanded voice catalog across keys,
guitars/plucked, bass, strings, brass & winds, leads, pads, mallets, and
percussion, plus **5 drum kits** — is registered through `InstrumentContribution`
just like a third-party plugin (see
[`synthVoices.ts`](https://github.com/IEvangelist/cadence/blob/main/apps/web/src/composer/plugins/builtins/synthVoices.ts)
and
[`drumKits.ts`](https://github.com/IEvangelist/cadence/blob/main/apps/web/src/composer/plugins/builtins/drumKits.ts)).

### Effect

An effect returns an `EffectNode` (`input` → effect → `output`). Effects with
`enabledByDefault: true` are inserted into the master chain when the engine is
built.

```ts
import * as Tone from 'tone'
import type { EffectNode } from '../plugins'

effects: [
  {
    id: 'softener',
    name: 'High-Cut Softener',
    description: 'A gentle low-pass filter on the master bus.',
    enabledByDefault: false,
    createNode: (): EffectNode => {
      const filter = new Tone.Filter(8000, 'lowpass')
      return { input: filter, output: filter, dispose: () => filter.dispose() }
    },
  },
]
```

### Format

A format contributes an exporter, an importer, or both. `export` returns a
`string` or `Uint8Array`; `import` parses a project and should throw a typed
error on malformed input.

```ts
import type { Project } from '../../model/project'

formats: [
  {
    id: 'hello-text',
    name: 'Text summary (.txt)',
    extension: '.txt',
    mimeType: 'text/plain',
    export: (project: Project) => projectToText(project), // string | Uint8Array
    // import: (data, options?) => Project    // optional
  },
]
```

Exporters show up in the toolbar's **Export as** menu and importers in the file
picker automatically. The built-in MusicXML and portable-project (`.cadence.json`)
codecs are contributed this way (see
[`formats.ts`](https://github.com/IEvangelist/cadence/blob/main/apps/web/src/composer/plugins/builtins/formats.ts)).

> The v1 format contract targets **synchronous** `string`/`Uint8Array` codecs.
> MIDI (binary import) and WAV (async offline render) remain dedicated toolbar
> controls rather than generic format contributions — see
> [Features](../features/) for the full import/export surface.

### AI / composition provider

Providers wrap the existing `CompositionAssistant` seam. `create` is lazy so
heavy models aren't loaded until the provider is selected.

```ts
import type { CompositionAssistant } from '../../ai/types'

aiProviders: [
  {
    id: 'acme.markov',
    name: 'Markov toy model',
    create: (): CompositionAssistant => new MarkovAssistant(),
  },
]
```

The two built-in providers —
[`magenta`](https://github.com/IEvangelist/cadence/blob/main/apps/web/src/composer/plugins/builtins/aiProviders.ts)
(the in-browser Magenta/TensorFlow assistant) and `mock` (deterministic, used by
tests) — register through this same contract. The assistant resolves its active
provider from the host plus user preferences.

### Commands and panels

A **command** receives a minimal `CommandApi` — it never reaches into React or
the reducer directly:

```ts
export function insertCMajor(api: CommandApi): void {
  const trackId = api.getSelectedTrackId()
  if (!trackId) return api.notify('Select a track first.')
  api.insertNotes(trackId, [60, 64, 67].map((pitch) => ({
    pitch, start: 0, duration: 1, velocity: 0.8,
  })))
  api.notify('Inserted a C-major chord.')
}

commands: [
  { id: 'example.insert-cmajor', title: 'Insert a C-major chord',
    keybinding: 'mod+shift+h', run: insertCMajor },
]
```

A **panel** renders into the composer sidebar and can run commands:

```tsx
panels: [
  {
    id: 'example.about',
    title: 'Example plugin',
    render: (context) => (
      <button type="button" onClick={() => context.runCommand('example.insert-cmajor')}>
        Insert a C-major chord
      </button>
    ),
  },
]
```

Keybindings use `mod+key` grammar, where `mod` is Ctrl on Windows/Linux and ⌘
on macOS (e.g. `mod+shift+h`). The global dispatcher ignores keystrokes while an
input, textarea, or select is focused, and users can rebind any command from the
Extensions panel.

## The host API

`defaultPluginHost` (or a fresh `createPluginHost()`) owns the lifecycle and
exposes typed, active-only views (see
[`host.ts`](https://github.com/IEvangelist/cadence/blob/main/apps/web/src/composer/plugins/host.ts)):

| Method | Purpose |
|---|---|
| `register(plugin, { override? })` | validate + register (inactive); a duplicate id throws `PluginRegistrationError` unless `override` |
| `use(plugin, opts?)` | register **and** activate in one step |
| `activate(id)` / `dispose(id)` | flip contributions on/off (dispose keeps it registered) |
| `unregister(id)` | remove entirely |
| `instruments()` · `effects()` · `formats()` · `aiProviders()` · `commands()` · `panels()` | active-only aggregated views |
| `subscribe(fn)` | observe any lifecycle change (drives the React glue) |

When two active plugins contribute the same contribution id, the
**most-recently-registered wins** — so a plugin can override a built-in. The
instrument registry
([`instruments/registry.ts`](https://github.com/IEvangelist/cadence/blob/main/apps/web/src/composer/instruments/registry.ts))
is a thin facade over this host: `listInstruments()` and `getInstrument(id)`
resolve through `defaultPluginHost.instruments()`, so plugin-provided instruments
appear in the UI automatically.

## Registering, enabling & customization

- **Bundled plugins** are registered with the module-singleton
  `defaultPluginHost`. The core plugin (the built-ins) is registered **active**;
  optional plugins like the reference plugin are registered **inactive** so the
  user opts in.
- **Enabling** a plugin is a user preference. Toggling the checkbox in the
  **Extensions** panel activates or disposes the plugin live.
- **Preferences** (enabled plugins, per-command keybinding overrides, panel
  visibility, selected AI provider) persist through the same versioned
  `localStorage` seam as projects — client-side only, no backend.

## A complete example

The bundled reference plugin
[`helloPlugin.tsx`](https://github.com/IEvangelist/cadence/blob/main/apps/web/src/composer/plugins/examples/helloPlugin.tsx)
exercises four extension points in one small module — a Music Box **instrument**,
a text-summary **format**, an "Insert a C-major chord" **command**, and an about
**panel**. It is registered inactive with the default host, so it shows up in the
Extensions panel disabled; enabling it is what makes its contributions go live.
It's the best starting template for a new plugin.

## Testing your plugin

Plugins are plain objects, so they unit-test without a browser:

```ts
import { createPluginHost } from '../plugins'

const host = createPluginHost()
host.use(createGreeter())
expect(host.commands().map((c) => c.id)).toContain('acme.greet')
```

- Validate your manifest (valid + each malformed case → `PluginManifestError`).
- Assert your contribution appears in the matching host view once active and
  disappears after `dispose`.
- For instruments/effects, mock `tone` — importing it is safe under jsdom; only
  *constructing* nodes needs a real audio context.
