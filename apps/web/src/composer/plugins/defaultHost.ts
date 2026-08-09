/**
 * The module-level default {@link PluginHost}.
 *
 * A single shared host is created and seeded with the core plugin (built-ins)
 * when this module is first imported. The audio engine, instrument registry
 * facade, format/AI resolvers, and the React `usePlugins` hook all read from
 * this instance, so a plugin registered anywhere is visible everywhere.
 *
 * The core plugin is registered and activated eagerly; its instrument voice
 * factories construct no audio nodes until the engine actually builds a voice,
 * so importing this module stays side-effect free outside the audio path.
 */
import { PluginHost } from './host'
import { createCorePlugin } from './builtins'
import { createExamplePlugin } from './examples/helloPlugin'

/** The shared host the whole composer reads from. */
export const defaultPluginHost = new PluginHost()

defaultPluginHost.use(createCorePlugin())

// The reference plugin ships registered but inactive: it appears in the
// Extensions panel so users can opt in, and `usePlugins` activates it when the
// saved preferences enable it. Registering (not activating) keeps built-in
// behavior unchanged until a user turns it on.
defaultPluginHost.register(createExamplePlugin())
