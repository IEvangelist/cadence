export type InteractionSurface =
  | 'studio'
  | 'auth'
  | 'profile'
  | 'pricing'
  | 'stems'
  | 'licenses'
  | 'onboarding'

export type InteractionMultiplicity = 'one' | 'repeated'

export interface InteractionAccessibilityExemption {
  reason: string
  alternativeInteractionIds: readonly string[]
}

export interface InteractionManifestEntry {
  id: string
  surface: InteractionSurface
  expectedRole: string
  expectedName: string
  outcome: string
  multiplicity: InteractionMultiplicity
  behaviorSpec: string
  relatedE2e?: string
  notes?: string
  accessibilityExemption?: InteractionAccessibilityExemption
}

type EntryFields = [
  id: string,
  surface: InteractionSurface,
  expectedRole: string,
  expectedName: string,
  outcome: string,
  multiplicity?: InteractionMultiplicity,
  notes?: string,
  accessibilityExemption?: InteractionAccessibilityExemption,
]

function traced(behaviorSpec: string, relatedE2e?: string) {
  return (...fields: EntryFields): InteractionManifestEntry => {
    const [
      id,
      surface,
      expectedRole,
      expectedName,
      outcome,
      multiplicity = 'one',
      notes,
      accessibilityExemption,
    ] = fields
    return {
      id,
      surface,
      expectedRole,
      expectedName,
      outcome,
      multiplicity,
      behaviorSpec,
      ...(relatedE2e ? { relatedE2e } : {}),
      ...(notes ? { notes } : {}),
      ...(accessibilityExemption ? { accessibilityExemption } : {}),
    }
  }
}

const app = traced('src/App.test.tsx', 'e2e/smoke.spec.ts')
const licenses = traced(
  'src/acknowledgements/AcknowledgementsPage.test.tsx',
  'e2e/acknowledgements.spec.ts',
)
const auth = traced('src/auth/AuthBar.test.tsx', 'e2e/auth.spec.ts')
const profile = traced('src/auth/ProfilePage.test.tsx', 'e2e/auth.spec.ts')
const pricing = traced('src/billing/PricingPage.test.tsx', 'e2e/pricing.spec.ts')
const aiStudio = traced('src/composer/components/AiStudioPanel.test.tsx', 'e2e/assistant.spec.ts')
const assistant = traced(
  'src/composer/components/AssistantPanel.test.tsx',
  'e2e/assistant.spec.ts',
)
const automation = traced(
  'src/composer/components/AutomationLane.test.tsx',
  'e2e/automation.spec.ts',
)
const panels = traced('src/composer/components/CollapsiblePanel.test.tsx', 'e2e/composer.spec.ts')
const instrument = traced('src/composer/components/InstrumentPicker.test.tsx')
const midi = traced('src/composer/components/MidiControls.test.tsx', 'e2e/midi.spec.ts')
const mixer = traced('src/composer/components/MixerPanel.test.tsx', 'e2e/automation.spec.ts')
const piano = traced('src/composer/components/PianoRoll.test.tsx', 'e2e/pro-editing.spec.ts')
const plugins = traced('src/composer/components/PluginsPanel.test.tsx', 'e2e/plugins.spec.ts')
const project = traced('src/composer/components/ProjectToolbar.test.tsx', 'e2e/composer.spec.ts')
const quickStart = traced(
  'src/composer/components/QuickStartGallery.test.tsx',
  'e2e/quick-starts.spec.ts',
)
const share = traced(
  'src/composer/components/ShareProjectButton.test.tsx',
  'e2e/collaboration.spec.ts',
)
const track = traced('src/composer/components/TrackPanel.test.tsx', 'e2e/multitrack.spec.ts')
const transport = traced('src/composer/components/TransportBar.test.tsx', 'e2e/audio.spec.ts')
const composer = traced('src/composer/Composer.test.tsx', 'e2e/composer.spec.ts')
const examplePlugin = traced(
  'src/composer/plugins/examples/helloPlugin.test.tsx',
  'e2e/plugins.spec.ts',
)
const onboarding = traced(
  'src/onboarding/OnboardingTour.test.tsx',
  'e2e/onboarding.spec.ts',
)
const stems = traced('src/stems/StemsPage.test.tsx', 'e2e/stems.spec.ts')

export const interactionManifest: readonly InteractionManifestEntry[] = [
  app(
    'app.skip-to-composer',
    'studio',
    'link',
    'Skip to editor',
    'Moves keyboard focus to the composer main region.',
  ),
  app(
    'app.nav.stems',
    'studio',
    'button',
    '/Stems|Back to composer/',
    'Shows the stems surface or returns to the composer.',
  ),
  app(
    'app.nav.pricing',
    'studio',
    'button',
    '/Pricing|Back to composer/',
    'Shows the pricing surface or returns to the composer.',
  ),
  app(
    'app.nav.licenses',
    'studio',
    'button',
    '/Third-party licenses|Back to composer/',
    'Shows the licenses and acknowledgements surface or returns to the composer.',
  ),

  licenses(
    'licenses.external-link',
    'licenses',
    'link',
    '/.+/',
    'Navigates to the selected license, notice, package, or project resource in a new tab.',
    'repeated',
    'Native external links preserve their current targets and rel attributes.',
  ),
  licenses(
    'licenses.close',
    'licenses',
    'button',
    'Back to composer',
    'Returns from licenses and acknowledgements to the composer.',
  ),

  auth(
    'auth.profile.open',
    'auth',
    'button',
    'Profile',
    'Opens the authenticated profile editor and updates the pressed state.',
  ),
  auth('auth.sign-out', 'auth', 'button', 'Sign out', 'Signs out and restores anonymous auth controls.'),
  auth(
    'auth.panel.toggle',
    'auth',
    'button',
    '/Sign in|Close/',
    'Expands or collapses the sign-in panel and updates aria-expanded.',
  ),
  auth(
    'auth.registration.display-name',
    'auth',
    'textbox',
    'Display name',
    'Updates the pending registration display name.',
  ),
  auth(
    'auth.credentials.email',
    'auth',
    'textbox',
    'Email',
    'Updates the credentials email and clears stale registration success.',
  ),
  auth(
    'auth.credentials.password',
    'auth',
    'input',
    'Password',
    'Updates the credentials password submitted for sign-in or registration.',
  ),
  auth(
    'auth.credentials.submit',
    'auth',
    'button',
    '/Sign in|Create account/',
    'Submits credentials and exposes authenticated, success, or error state.',
  ),
  auth(
    'auth.mode.toggle',
    'auth',
    'button',
    '/Create an account|Already have an account/',
    'Switches between sign-in and registration fields and copy.',
  ),
  auth(
    'auth.magic-link.email',
    'auth',
    'textbox',
    'Or get a magic sign-in link',
    'Updates the passwordless sign-in email and clears stale success.',
  ),
  auth(
    'auth.magic-link.submit',
    'auth',
    'button',
    'Email me a link',
    'Requests a magic link and exposes success or error state.',
  ),
  auth(
    'auth.provider.sign-in',
    'auth',
    'link',
    '/.+/',
    'Navigates to the selected external authentication provider.',
    'repeated',
    'Native link behavior.',
  ),

  profile(
    'profile.close',
    'profile',
    'button',
    'Back to composer',
    'Returns from the profile editor to the composer.',
  ),
  profile(
    'profile.display-name',
    'profile',
    'textbox',
    'Display name',
    'Updates the draft display name and clears the saved indicator.',
  ),
  profile(
    'profile.bio',
    'profile',
    'textbox',
    'Bio',
    'Updates the draft biography and clears the saved indicator.',
  ),
  profile(
    'profile.avatar-url',
    'profile',
    'textbox',
    'Avatar URL',
    'Updates the draft avatar URL and clears the saved indicator.',
  ),
  profile(
    'profile.save',
    'profile',
    'button',
    'Save changes',
    'Persists profile fields and exposes saved or error state.',
  ),

  pricing(
    'pricing.close',
    'pricing',
    'button',
    'Back to composer',
    'Returns from pricing to the composer.',
  ),
  pricing(
    'pricing.upgrade',
    'pricing',
    'button',
    'Upgrade to Pro',
    'Starts checkout and navigates to the returned checkout URL or exposes an error.',
  ),
  pricing(
    'pricing.manage',
    'pricing',
    'button',
    'Manage billing',
    'Opens the billing portal URL or exposes an error.',
  ),

  aiStudio(
    'studio.ai.feature.select',
    'studio',
    'radio',
    '/Text to motif|Style transfer|Groove|Auto-master/',
    'Selects an AI Studio feature and displays its controls.',
    'repeated',
  ),
  aiStudio(
    'studio.ai.motif.prompt',
    'studio',
    'textbox',
    'Prompt',
    'Updates the text-to-motif prompt.',
  ),
  aiStudio(
    'studio.ai.motif.length',
    'studio',
    'slider',
    '/Motif length/',
    'Updates motif length and its beat readout.',
  ),
  aiStudio(
    'studio.ai.motif.create',
    'studio',
    'button',
    'Create motif',
    'Creates motif notes on the selected track or exposes validation state.',
  ),
  aiStudio(
    'studio.ai.style.select',
    'studio',
    'combobox',
    '/Style/',
    'Updates the selected style-transfer preset.',
  ),
  aiStudio(
    'studio.ai.style.apply',
    'studio',
    'button',
    'Apply style',
    'Applies the selected style to the current track or remains disabled when locked.',
  ),
  aiStudio(
    'studio.ai.groove.select',
    'studio',
    'combobox',
    '/Groove/',
    'Updates the selected groove preset.',
  ),
  aiStudio(
    'studio.ai.groove.intensity',
    'studio',
    'slider',
    '/Intensity/',
    'Updates groove intensity and its percentage readout.',
  ),
  aiStudio(
    'studio.ai.groove.apply',
    'studio',
    'button',
    'Apply groove',
    'Applies the selected groove and intensity to the current track.',
  ),
  aiStudio(
    'studio.ai.mastering.analyze',
    'studio',
    'button',
    'Analyze mix',
    'Analyzes the mix and renders the mastering report or locked state.',
  ),

  assistant(
    'studio.assistant.action.select',
    'studio',
    'radio',
    '/Continue|Generate|Harmonize/',
    'Selects the assistant action and updates parameter availability.',
    'repeated',
  ),
  assistant(
    'studio.assistant.temperature',
    'studio',
    'slider',
    '/Temperature/',
    'Updates generation temperature and its readout.',
  ),
  assistant(
    'studio.assistant.length',
    'studio',
    'slider',
    '/Length/',
    'Updates generation length and its beat readout.',
  ),
  assistant(
    'studio.assistant.generate',
    'studio',
    'button',
    '/Generate|Cancel/',
    'Starts generation or cancels the active request and updates status.',
  ),
  assistant(
    'studio.assistant.preview',
    'studio',
    'button',
    'Preview',
    'Auditions the generated suggestion.',
  ),
  assistant(
    'studio.assistant.accept',
    'studio',
    'button',
    'Accept',
    'Commits the generated suggestion to the selected track.',
  ),
  assistant(
    'studio.assistant.discard',
    'studio',
    'button',
    'Discard',
    'Removes the generated suggestion from the panel.',
  ),

  automation(
    'studio.automation.add-point',
    'studio',
    'button',
    'Add point',
    'Writes the current automation value at the playhead.',
    'repeated',
  ),
  automation(
    'studio.automation.clear',
    'studio',
    'button',
    '/Clear .+ automation/',
    'Removes every point from the selected automation lane.',
    'repeated',
  ),
  automation(
    'studio.automation.lane',
    'studio',
    'presentation',
    '',
    'Writes an automation point at the pointer-derived beat and value.',
    'repeated',
    'Known pointer-only baseline gap.',
    {
      reason:
        'The SVG intentionally remains role=presentation with no accessible name in the current UX.',
      alternativeInteractionIds: ['studio.automation.add-point'],
    },
  ),
  automation(
    'studio.automation.remove-point',
    'studio',
    'button',
    '/Remove .+ point at beat/',
    'Removes the selected automation point.',
    'repeated',
  ),

  panels(
    'studio.panel.toggle',
    'studio',
    'button',
    '/Tracks|Quick starts|AI Assistant|AI Studio|Mixer|Extensions/',
    'Expands or collapses the selected composer panel and updates aria-expanded.',
    'repeated',
  ),
  instrument(
    'studio.track.instrument',
    'studio',
    'combobox',
    '/Instrument for .+/',
    'Changes the repeated track family instrument assignment.',
    'repeated',
  ),
  midi(
    'studio.midi.device',
    'studio',
    'combobox',
    'MIDI device',
    'Selects the active native MIDI input device.',
  ),
  midi(
    'studio.midi.arm',
    'studio',
    'button',
    'Record',
    'Arms or disarms MIDI recording and updates aria-pressed.',
  ),
  midi(
    'studio.midi.quantize',
    'studio',
    'checkbox',
    'Quantize',
    'Enables or disables quantization for recorded MIDI notes.',
  ),

  mixer(
    'studio.mixer.track.gain',
    'studio',
    'slider',
    '/Gain/',
    'Updates track gain and its decibel readout.',
    'repeated',
  ),
  mixer(
    'studio.mixer.track.pan',
    'studio',
    'slider',
    '/Pan/',
    'Updates track pan and its left, center, or right readout.',
    'repeated',
  ),
  mixer(
    'studio.mixer.track.mute',
    'studio',
    'button',
    'Mute',
    'Mutes or unmutes the track and updates aria-pressed.',
    'repeated',
  ),
  mixer(
    'studio.mixer.track.solo',
    'studio',
    'button',
    'Solo',
    'Solos or unsolos the track and updates aria-pressed.',
    'repeated',
  ),
  mixer(
    'studio.mixer.insert.toggle',
    'studio',
    'checkbox',
    '/.+/',
    'Enables or disables the selected insert effect.',
    'repeated',
  ),
  mixer(
    'studio.mixer.insert.remove',
    'studio',
    'button',
    '/Remove .+ from .+/',
    'Removes the selected insert effect from its track.',
    'repeated',
  ),
  mixer(
    'studio.mixer.insert.select',
    'studio',
    'combobox',
    '/Add insert to .+/',
    'Selects the insert effect to add to a track.',
    'repeated',
  ),
  mixer(
    'studio.mixer.insert.add',
    'studio',
    'button',
    'Add',
    'Adds the selected insert effect to a track.',
    'repeated',
  ),
  mixer(
    'studio.mixer.master.gain',
    'studio',
    'slider',
    '/Gain/',
    'Updates master gain and its decibel readout.',
  ),
  mixer(
    'studio.mixer.master.limiter',
    'studio',
    'checkbox',
    'Limiter',
    'Enables or disables the master limiter.',
  ),
  mixer(
    'studio.mixer.master.ceiling',
    'studio',
    'slider',
    '/Ceiling/',
    'Updates the limiter ceiling and its decibel readout.',
  ),

  piano(
    'studio.piano-roll.zoom.time-out',
    'studio',
    'button',
    'Zoom out horizontally (time)',
    'Decreases horizontal piano-roll zoom and updates the zoom readout.',
  ),
  piano(
    'studio.piano-roll.zoom.time-in',
    'studio',
    'button',
    'Zoom in horizontally (time)',
    'Increases horizontal piano-roll zoom and updates the zoom readout.',
  ),
  piano(
    'studio.piano-roll.zoom.pitch-out',
    'studio',
    'button',
    'Zoom out vertically (pitch)',
    'Decreases vertical piano-roll zoom and updates the zoom readout.',
  ),
  piano(
    'studio.piano-roll.zoom.pitch-in',
    'studio',
    'button',
    'Zoom in vertically (pitch)',
    'Increases vertical piano-roll zoom and updates the zoom readout.',
  ),
  piano(
    'studio.piano-roll.zoom.reset',
    'studio',
    'button',
    'Reset zoom',
    'Restores default horizontal and vertical piano-roll zoom.',
  ),
  piano(
    'studio.piano-roll.quantize.strength',
    'studio',
    'slider',
    'Quantize strength',
    'Updates quantize strength and its percentage readout.',
  ),
  piano(
    'studio.piano-roll.quantize.apply',
    'studio',
    'button',
    '/Quantize .+ to the current snap grid/',
    'Quantizes selected or all notes and updates note positions.',
  ),
  piano(
    'studio.piano-roll.velocity.toggle',
    'studio',
    'button',
    'Toggle velocity lane',
    'Shows or hides the velocity lane and updates aria-pressed.',
  ),
  piano(
    'studio.piano-roll.grid',
    'studio',
    'application',
    '/Note grid/',
    'Adds notes by pointer or keyboard and supports caret, selection, movement, resizing, and deletion.',
    'one',
    'Custom keyboard and pointer surface.',
  ),
  piano(
    'studio.piano-roll.note',
    'studio',
    'button',
    '/[A-G][#b]?\\d at beat/',
    'Selects or drags a note and updates its pressed state and position.',
    'repeated',
    'Pointer drag and native button keyboard activation.',
  ),
  piano(
    'studio.piano-roll.note.resize-start',
    'studio',
    'none',
    '',
    'Resizes the note from its start edge.',
    'repeated',
    'Aria-hidden pointer handle.',
    {
      reason: 'The resize handle is aria-hidden and the containing note button owns keyboard access.',
      alternativeInteractionIds: ['studio.piano-roll.note'],
    },
  ),
  piano(
    'studio.piano-roll.note.resize-end',
    'studio',
    'none',
    '',
    'Resizes the note from its end edge.',
    'repeated',
    'Aria-hidden pointer handle.',
    {
      reason: 'The resize handle is aria-hidden and the containing note button owns keyboard access.',
      alternativeInteractionIds: ['studio.piano-roll.note'],
    },
  ),
  piano(
    'studio.piano-roll.velocity.note',
    'studio',
    'button',
    '/Velocity for .+ at beat/',
    'Adjusts one note velocity by pointer drag or keyboard.',
    'repeated',
  ),
  piano(
    'studio.piano-roll.velocity.selected',
    'studio',
    'slider',
    '/Velocity/',
    'Updates the selected note velocity and numeric readout.',
  ),

  plugins(
    'studio.plugins.keybinding.record',
    'studio',
    'button',
    '/Shortcut for command/',
    'Enters keybinding capture, persists the next shortcut, or clears it with Escape.',
    'repeated',
    'Custom keyboard capture surface.',
  ),
  plugins(
    'studio.plugins.plugin.toggle',
    'studio',
    'checkbox',
    '/.+/',
    'Enables or disables a non-built-in plugin.',
    'repeated',
  ),
  plugins(
    'studio.plugins.command.run',
    'studio',
    'button',
    '/.+/',
    'Runs the selected contributed plugin command.',
    'repeated',
  ),
  plugins(
    'studio.plugins.panel.toggle',
    'studio',
    'checkbox',
    '/.+/',
    'Shows or hides the selected contributed plugin panel.',
    'repeated',
  ),

  project(
    'studio.project.name',
    'studio',
    'textbox',
    'Project name',
    'Renames the current project and updates project state.',
  ),
  project('studio.project.new', 'studio', 'button', 'New', 'Creates a fresh empty project.'),
  project('studio.project.demo', 'studio', 'button', 'Demo', 'Loads the bundled demo project.'),
  project(
    'studio.project.save',
    'studio',
    'button',
    'Save',
    'Persists the project and exposes save status.',
  ),
  project(
    'studio.project.open',
    'studio',
    'combobox',
    'Open project',
    'Loads the selected saved project.',
  ),
  project(
    'studio.project.import.trigger',
    'studio',
    'button',
    'Import file',
    'Opens the hidden project or MusicXML file chooser.',
    'one',
    'Trigger for studio.project.import.file.',
  ),
  project(
    'studio.project.import.file',
    'studio',
    'button',
    'Import project or MusicXML file',
    'Reads the selected file and imports a project, MusicXML, or plugin package.',
    'one',
    'Visually hidden native file input.',
  ),
  project(
    'studio.project.export',
    'studio',
    'combobox',
    'Export as',
    'Downloads the project in the selected export format or exposes an error.',
  ),
  project(
    'studio.project.share',
    'studio',
    'button',
    'Share',
    'Copies a share payload or downloads a fallback snapshot and exposes status.',
  ),
  project(
    'studio.project.midi-import.trigger',
    'studio',
    'button',
    'Import MIDI',
    'Opens the hidden MIDI file chooser.',
    'one',
    'Trigger for studio.project.midi-import.file.',
  ),
  project(
    'studio.project.midi-import.file',
    'studio',
    'button',
    'Import MIDI file',
    'Reads the selected MIDI file into the current project.',
    'one',
    'Visually hidden native file input.',
  ),
  project(
    'studio.project.midi-export',
    'studio',
    'button',
    'Export MIDI',
    'Downloads the current project as a MIDI file.',
  ),

  quickStart(
    'studio.quick-start.load',
    'studio',
    'button',
    '/.+/',
    'Loads the selected quick-start template as the current project.',
    'repeated',
  ),
  share(
    'studio.share.toggle',
    'studio',
    'button',
    'Share',
    'Expands or collapses share-link controls and loads existing links.',
  ),
  share(
    'studio.share.create-editor',
    'studio',
    'button',
    'Create editor link',
    'Creates, displays, and copies a new editor link.',
  ),
  share(
    'studio.share.create-viewer',
    'studio',
    'button',
    'Create viewer link',
    'Creates, displays, and copies a new viewer link.',
  ),
  share(
    'studio.share.copy',
    'studio',
    'button',
    '/Copy link|Copied/',
    'Copies the repeated share link and changes its button text to Copied.',
    'repeated',
  ),
  share(
    'studio.share.revoke',
    'studio',
    'button',
    'Revoke',
    'Revokes and removes the repeated share link.',
    'repeated',
  ),

  track(
    'studio.track.visibility-all',
    'studio',
    'button',
    '/Show all tracks|Show only selected/',
    'Shows all tracks or only the selected track on the piano roll.',
  ),
  track('studio.track.add', 'studio', 'button', '/Add track/', 'Adds and selects a new track.'),
  track(
    'studio.track.select',
    'studio',
    'button',
    '/Select|Selected/',
    'Selects the repeated track for editing and updates aria-pressed.',
    'repeated',
  ),
  track(
    'studio.track.name',
    'studio',
    'textbox',
    'Track name',
    'Renames the repeated track.',
    'repeated',
  ),
  track(
    'studio.track.visibility',
    'studio',
    'button',
    '/Show|Hide|is shown/',
    'Shows or hides the repeated non-selected track on the piano roll.',
    'repeated',
  ),
  track(
    'studio.track.mute',
    'studio',
    'button',
    '/Mute|Muted/',
    'Mutes or unmutes the repeated track and updates aria-pressed.',
    'repeated',
  ),
  track(
    'studio.track.delete',
    'studio',
    'button',
    '/Delete .+/',
    'Deletes the repeated track unless it is the only track.',
    'repeated',
  ),

  transport(
    'studio.transport.play',
    'studio',
    'button',
    '/Play|Pause/',
    'Starts or pauses playback and updates aria-pressed.',
  ),
  transport(
    'studio.transport.stop',
    'studio',
    'button',
    '/Stop/',
    'Stops playback and resets position.',
  ),
  transport(
    'studio.transport.tempo',
    'studio',
    'spinbutton',
    'Tempo',
    'Updates project tempo within the native numeric range.',
  ),
  transport(
    'studio.transport.loop',
    'studio',
    'button',
    '/Loop/',
    'Enables or disables loop playback and updates aria-pressed.',
  ),
  transport(
    'studio.transport.snap',
    'studio',
    'combobox',
    'Snap',
    'Updates the editor snap interval.',
  ),

  composer(
    'studio.empty.load-demo',
    'studio',
    'button',
    'Load a demo pattern',
    'Loads the demo pattern from the empty composer state.',
  ),
  examplePlugin(
    'studio.plugins.example.run-command',
    'studio',
    'button',
    'Insert a C-major chord',
    'Runs the example plugin command and inserts its chord.',
  ),

  onboarding(
    'onboarding.launch',
    'onboarding',
    'button',
    'Take a tour',
    'Opens the onboarding dialog and moves focus to its primary action.',
  ),
  onboarding(
    'onboarding.dismiss-backdrop',
    'onboarding',
    'button',
    'Dismiss onboarding tour',
    'Closes onboarding and restores launcher focus.',
  ),
  onboarding(
    'onboarding.dialog.keyboard',
    'onboarding',
    'dialog',
    '/Welcome to Cadence|.+/',
    'Traps focus and handles Escape and arrow-key tour navigation.',
    'one',
    'Custom modal keyboard surface.',
  ),
  onboarding(
    'onboarding.close',
    'onboarding',
    'button',
    'Close onboarding tour',
    'Closes onboarding and restores launcher focus.',
  ),
  onboarding(
    'onboarding.step.select',
    'onboarding',
    'button',
    '/Go to step/',
    'Moves directly to the selected onboarding step and updates aria-current.',
    'repeated',
  ),
  onboarding(
    'onboarding.skip',
    'onboarding',
    'button',
    'Skip tour',
    'Marks onboarding complete and closes the dialog.',
  ),
  onboarding(
    'onboarding.back',
    'onboarding',
    'button',
    'Back',
    'Moves to the previous onboarding step.',
  ),
  onboarding(
    'onboarding.next',
    'onboarding',
    'button',
    '/Next|Get started/',
    'Moves to the next step or completes onboarding on the final step.',
  ),

  stems(
    'stems.close',
    'stems',
    'button',
    'Back to composer',
    'Returns from stems to the composer.',
  ),
  stems(
    'stems.upgrade',
    'stems',
    'button',
    'See Pro plans',
    'Opens pricing from the free-tier stems gate.',
  ),
  stems(
    'stems.upload.file',
    'stems',
    'button',
    'Choose a mix to separate',
    'Stores the selected native audio file and clears stale errors.',
    'one',
    'Native file input.',
  ),
  stems(
    'stems.separate',
    'stems',
    'button',
    '/Separate stems|Uploading/',
    'Uploads the mix and renders the resulting separation job or error.',
  ),
  stems(
    'stems.preview',
    'stems',
    'audio',
    '/.+ stem preview/',
    'Uses native media controls to play, pause, seek, or adjust a repeated stem preview.',
    'repeated',
    'Native media controls.',
  ),
  stems(
    'stems.download',
    'stems',
    'link',
    '/Download .+/',
    'Downloads the repeated generated stem as a named WAV file.',
    'repeated',
    'Native download link.',
  ),
]

export const interactionIds = new Set(interactionManifest.map(({ id }) => id))
