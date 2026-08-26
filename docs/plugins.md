# Writing a Cadence plugin

Cadence's composer is built around a small, typed **Plugin SDK**. Everything the
app ships — its instruments, its import/export formats, its AI providers — is a
plugin registered through the same host a third-party plugin uses. This guide
shows how to write one, using the bundled reference plugin
([`helloPlugin.tsx`](../apps/web/src/composer/plugins/examples/helloPlugin.tsx))
as a complete, working example.

- **Where it lives:** `apps/web/src/composer/plugins/`
- **Public surface:** `import { … } from '../plugins'` (the
  [`index.ts`](../apps/web/src/composer/plugins/index.ts) barrel)
- **Runtime deps added:** none. Manifest validation is hand-rolled in the same
  defensive style as `model/persistence.ts`.

## Mental model

A plugin is a **plain module object**: a `manifest` (identity) plus a set of typed
`contributes` (capabilities). You register it with a **host**, the host validates
the manifest, and when the plugin is **activated** its contributions go live. The
composer reads only the contributions of *active* plugins.

```
register(plugin)  →  activate(id)  →  contributions live  →  dispose(id)
     │                                                            │
 validate manifest                                    hidden, still registered
```

There are six extension points, all optional:

| Point | Field | What it adds |
|---|---|---|
| (a) Instrument | `instruments` | a selectable voice the audio engine can play |
| (b) Effect | `effects` | a node inserted into the master audio chain |
| (c) Format | `formats` | an exporter and/or importer in the project toolbar |
| (d) AI provider | `aiProviders` | a composition-assistant backend |
| (e) Command | `commands` | an action (with an optional keybinding) |
| (e) Panel | `panels` | a React surface in the composer sidebar |

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
  id: string        // stable, unique, e.g. "acme.extra-instruments"
  name: string      // shown in the Extensions panel
  version: string   // semantic version, e.g. "1.0.0"
  description?: string
  author?: string
  builtin?: boolean // reserved for the always-on core plugin
}
```

`register()` runs `validateManifest()`, which throws a typed
`PluginManifestError` (mirroring `MidiImportError` / `ProjectFileError`) if the
`id`/`name` is missing or `version` isn't a semantic version. There is **no schema
library** — the check is a few lines of hand-rolled validation, so the SDK adds
zero runtime dependencies. Registration also rejects malformed, duplicate, or
reserved effect parameter descriptors before the plugin becomes visible.

```ts
import { validateManifest, PluginManifestError } from '../plugins'

try {
  validateManifest({ id: 'x', name: 'X', version: 'not-semver' })
} catch (err) {
  err instanceof PluginManifestError // true
}
```

## Extension points

The reference plugin exercises four of the six points (instrument, format,
command, panel) in one small module. The two audio points share the same shape;
all six are shown below.

### (a) Instrument

An instrument is metadata plus a **voice factory**. The factory is called only
when the engine builds a voice, so importing your module never touches the audio
context.

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
    createVoice: createMusicBoxVoice,
  },
]
```

Once the plugin is active, the instrument appears in every track's instrument
dropdown and the engine plays it — no other wiring required.

An instrument may also declare an optional `group` label (e.g. `Keys`, `Bass`,
`Pads`). It's purely presentational: the picker buckets instruments that share a
group under an `<optgroup>`, in first-seen order, and instruments without a
group render as plain options. Omitting it is fully backward compatible.

The core plugin dogfoods this: alongside the original poly/FM synths and drum
kit it now contributes an expanded built-in library — electric piano, organ,
pads, basses, leads, mallets/plucks, and additional drum kits — each registered
through this exact same seam (see `plugins/builtins/synthVoices.ts` and
`plugins/builtins/drumKits.ts`).

### (b) Effect

An effect returns an `EffectNode` (`input` → effect → `output`). Effects with
`enabledByDefault: true` are inserted into the master chain when the engine is
built; the built-in `softener` ships **off** so the default signal path is
unchanged. Mixer inserts may add typed numeric descriptors. Their defaults seed
new `ProjectMixInsert.params`; current sanitized params reach `createNode`, and
`updateParams` applies slider changes to the live node. Every field is optional,
so existing fixed effects remain compatible and render no parameter controls.

```ts
import * as Tone from 'tone'
import type { EffectNode } from '../plugins'

effects: [
  {
    id: 'softener',
    name: 'High-Cut Softener',
    description: 'A gentle low-pass filter on the master bus.',
    enabledByDefault: false,
    parameters: [
      {
        type: 'number',
        id: 'frequency',
        name: 'Cutoff',
        defaultValue: 8000,
        min: 200,
        max: 20000,
        step: 100,
        unit: 'Hz',
      },
    ],
    createNode: ({ params }): EffectNode => {
      const filter = new Tone.Filter(params?.frequency ?? 8000, 'lowpass')
      return {
        input: filter,
        output: filter,
        updateParams: (next) => {
          filter.frequency.value = next.frequency ?? 8000
        },
        dispose: () => filter.dispose(),
      }
    },
  },
]
```

Descriptors are runtime-validated before controls render. Reserved prototype
keys are rejected. Values are finite, clamped to `min`/`max`, and snapped to
`step` through the exported `sanitizeEffectParameterValue` helper. Safe unknown
keys are preserved for plugin evolution, and params for a currently unavailable
plugin survive project load/save unchanged. Factory creation, hydration, live
updates, and `MixerController.setInsertParams` share the same normalizer, so the
factory's `params` and node's `updateParams` callback always receive complete
snapshots—not a single changed key.

### (c) Format

A format contributes an exporter, an importer, or both. `export` returns a
`string` or `Uint8Array`; `import` parses a project and should throw a typed error
on malformed input (like the built-in importers).

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
picker automatically.

### (d) AI / composition provider

Providers wrap the existing `CompositionAssistant` seam. `create` is lazy so heavy
models aren't loaded until the provider is selected.

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

The assistant resolves its active provider from the host + preferences (see
[`resolveAssistant.ts`](../apps/web/src/composer/plugins/resolveAssistant.ts)); the
e2e mock provider swaps in the same way.

### (e) Commands and panels

A **command** receives a minimal `CommandApi` — it never reaches into React or the
reducer directly:

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
      <div className="example-plugin-panel">
        <p className="plugin-desc">This example adds an instrument and a command.</p>
        <button type="button" className="btn btn-sm"
          onClick={() => context.runCommand('example.insert-cmajor')}>
          Insert a C-major chord
        </button>
      </div>
    ),
  },
]
```

Keybindings use `mod+key` grammar, where `mod` is <kbd>Ctrl</kbd> on Windows/Linux
and <kbd>⌘</kbd> on macOS (e.g. `mod+shift+h`). The global dispatcher ignores
keystrokes while an input/textarea/select is focused, and users can rebind any
command from the Extensions panel.

## Registering, enabling, and customization

- **Bundled plugins** are registered with the module-singleton
  `defaultPluginHost`. The core plugin (the built-ins) is registered **active**;
  optional plugins like the reference plugin are registered **inactive** so the
  user opts in.
- **Enabling** a plugin is a user preference. `usePlugins()` reconciles the host
  with the saved preferences on mount: a non-core plugin is activated iff
  `enabledPlugins[id]` is true, and disabled otherwise. Toggling the checkbox in
  the **Extensions** panel flips that preference and activates/disposes the plugin
  live.
- **Preferences** (enabled plugins, per-command keybinding overrides, panel
  visibility, selected AI provider) persist through the same versioned
  `localStorage` seam as projects — see
  [`preferences.ts`](../apps/web/src/composer/plugins/preferences.ts). Parsing is
  defensive and never throws: an unreadable blob coerces to defaults, and the
  `schemaVersion` lets the shape migrate. It is client-side only (no backend).

```ts
import { createPreferencesStore } from '../plugins'

const store = createPreferencesStore()
store.update((p) => ({
  ...p,
  enabledPlugins: { ...p.enabledPlugins, 'acme.greeter': true },
}))
```

## The host API

`defaultPluginHost` (or a fresh `createPluginHost()`) exposes:

| Method | Purpose |
|---|---|
| `register(plugin, { override? })` | validate + register (inactive); duplicate id throws `PluginRegistrationError` unless `override` |
| `use(plugin, opts?)` | register **and** activate in one step |
| `activate(id)` / `dispose(id)` | flip contributions on/off (dispose keeps it registered) |
| `unregister(id)` | remove entirely |
| `instruments()` / `effects()` / `formats()` / `aiProviders()` / `commands()` / `panels()` | active-only aggregated views |
| `subscribe(fn)` | observe any lifecycle change (drives the React glue) |

When two active plugins contribute the same contribution id, the
**most-recently-registered wins** — so a plugin can override a built-in.

## Testing your plugin

Plugins are plain objects, so they unit-test without a browser. The reference
plugin's tests
([`helloPlugin.test.tsx`](../apps/web/src/composer/plugins/examples/helloPlugin.test.tsx))
are a good template:

```ts
import { createPluginHost } from '../plugins'

const host = createPluginHost()
host.use(createGreeter())
expect(host.commands().map((c) => c.id)).toContain('acme.greet')
```

- Validate your manifest (valid + each malformed case → `PluginManifestError`).
- Assert your contribution shows up in the matching host view once active and
  disappears after `dispose`.
- For instruments/effects, mock `tone` (importing it is safe under jsdom; only
  *constructing* nodes needs a real audio context).
- Add a Playwright smoke that enables the plugin and uses its contribution; keep
  any new UI axe-clean. See
  [`plugins.spec.ts`](../apps/web/e2e/plugins.spec.ts) and [`testing.md`](testing.md).

## Scope and follow-ups

This is deliberately an **in-process, typed *module* plugin model** — the MVP that
later efforts (collaboration, billing, stem separation) register their
capabilities through. The following are intentionally **not** built yet; the
current surface is the seam they'll grow from:

- **No remote loading / marketplace.** Plugins are imported modules compiled into
  the app. There is no dynamic download or discovery service.
- **No untrusted-plugin sandbox.** Plugins run with full app privileges. Real
  isolation (a worker/iframe boundary, a capability-scoped host API, permission
  prompts) is required before loading third-party code and is the biggest
  follow-up.
- **Binary/async formats stay dedicated controls.** `export` is synchronous and
  returns `string | Uint8Array`; MIDI (binary import) and WAV (async offline
  render) remain first-class toolbar controls rather than generic contributions.
- **Master-chain runtime toggling.** Master effects are resolved when the engine
  is built. Mixer inserts already support live enable/disable and parameter
  updates; per-session toggling of the separate master chain remains a follow-up.
- **Plugin-instrument persistence.** Saved projects store an instrument by id,
  and the persistence layer's coercion seam is registry-aware: any id the host
  currently knows (built-in or contributed by an active plugin) round-trips
  intact, and only genuinely unknown ids fall back to the default synth. A
  project referencing a plugin-provided instrument therefore still coerces to
  the default when that plugin isn't active; durable per-plugin instrument
  identity across load order is a follow-up.
