import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/authContext'
import { AuthBar } from '../../auth/AuthBar'
import { Composer } from '../../composer/Composer'
import { buildCollabConfig } from '../../composer/model/collab/collabConfig'
import { StudioHelpMenu } from '../../studio'
import { ThemeMenu } from '../../theme/ThemeMenu'
import { useProjectStore } from '../projectStoreContext'
import { supportsCollaborationScope } from '../../composer/model/syncingStore'
import type { AppRouteContext } from '../routeContext'
import { backendConfig } from '../../platform/backendConfig'

function destination(pathname: string, location: ReturnType<typeof useLocation>) {
  return { pathname, search: location.search, hash: location.hash }
}

export function StudioRoute() {
  const auth = useAuth()
  const store = useProjectStore()
  const location = useLocation()
  const navigate = useNavigate()
  const {
    authenticated,
    openSignIn,
    signingOut,
    signOut,
    watermarkExports,
  } = useOutletContext<AppRouteContext>()
  const baseCollab = useMemo(
    () =>
      backendConfig.available ? buildCollabConfig({
        search: location.search,
        location: window.location,
        user: auth.status === 'authenticated' ? auth.user : null,
        offlineUser: auth.status === 'offline' ? auth.offlineUser : null,
        relayOverride: import.meta.env?.VITE_COLLAB_URL as string | undefined,
      }) : null,
    [auth.offlineUser, auth.status, auth.user, location.search],
  )
  const collab = useMemo(
    () =>
      baseCollab && supportsCollaborationScope(store)
        ? {
            ...baseCollab,
            loadSerializedBackup: () =>
              store.loadCollaborationBackup(baseCollab),
          }
        : baseCollab,
    [baseCollab, store],
  )
  const composerStore = useMemo(
    () =>
      collab && supportsCollaborationScope(store)
        ? store.forCollaboration(collab)
        : store,
    [collab, store],
  )
  const consumeSharedProject = useCallback(() => {
    void navigate(
      { pathname: location.pathname, search: location.search, hash: '' },
      { replace: true },
    )
  }, [location.pathname, location.search, navigate])

  if (auth.status === 'loading' || auth.status === 'signing-out') {
    return (
      <section
        className="composer-hydration"
        id="composer-main"
        aria-label="Studio"
        aria-busy="true"
        tabIndex={-1}
      >
        <p role="status">Loading Studio...</p>
      </section>
    )
  }
  const persistenceOwner = auth.user?.id ?? auth.offlineUser?.id
  const persistenceIdentity = persistenceOwner
    ? `${auth.status}:${persistenceOwner}`
    : 'local:anonymous'

  return (
    <>
      <Composer
        key={persistenceIdentity}
        options={{
          store: composerStore,
          watermarkExports,
          storeRevision: auth.status,
          recoveryScope: persistenceIdentity,
          sharedProjectHash: location.hash,
          onSharedProjectConsumed: consumeSharedProject,
        }}
        collab={collab}
        canShare={backendConfig.available && authenticated}
        guardNavigation
        utilityControls={
          <>
            <StudioHelpMenu
              backendAvailable={backendConfig.available}
              onNavigate={(pathname) => void navigate(destination(pathname, location))}
            />
            <ThemeMenu />
            <AuthBar
              onShowSignIn={openSignIn}
              onShowProfile={() => void navigate(destination('/profile', location))}
              profileActive={false}
              signingOut={signingOut}
              onSignOut={signOut}
            />
          </>
        }
      />
    </>
  )
}
