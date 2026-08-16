import type { MixerViewModel } from '../hooks/useMixer'
import { MixerPanel } from './MixerPanel'
import './ToolWorkspaces.css'

interface MixWorkspaceProps {
  mixer: MixerViewModel
}

/** Full-width horizontal host for track channel strips and the master bus. */
export function MixWorkspace({ mixer }: MixWorkspaceProps) {
  return (
    <section className="mix-workspace" aria-label="Mix workspace">
      <MixerPanel mixer={mixer} />
    </section>
  )
}
