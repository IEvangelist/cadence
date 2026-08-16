import { createContext, useContext } from 'react'
import type { ProjectStore } from '../composer/model/storage'

export const ProjectStoreContext = createContext<ProjectStore | null>(null)

export function useProjectStore(): ProjectStore {
  const store = useContext(ProjectStoreContext)
  if (!store) throw new Error('useProjectStore must be used inside AppProviders')
  return store
}
