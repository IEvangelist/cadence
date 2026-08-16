import { createContext, useContext } from 'react'

export interface StudioCommands {
  isPlaying: boolean
  togglePlay(): void
}

export const StudioCommandContext = createContext<StudioCommands | null>(null)

export function useStudioCommands(): StudioCommands {
  const commands = useContext(StudioCommandContext)
  if (!commands) {
    throw new Error('useStudioCommands must be used within StudioCommandProvider')
  }
  return commands
}
