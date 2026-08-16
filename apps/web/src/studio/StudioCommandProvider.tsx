import { type ReactNode } from 'react'
import { StudioCommandContext, type StudioCommands } from './studioCommands'

interface StudioCommandProviderProps extends StudioCommands {
  children: ReactNode
}

export function StudioCommandProvider({
  children,
  isPlaying,
  togglePlay,
}: StudioCommandProviderProps) {
  return (
    <StudioCommandContext.Provider value={{ isPlaying, togglePlay }}>
      {children}
    </StudioCommandContext.Provider>
  )
}
