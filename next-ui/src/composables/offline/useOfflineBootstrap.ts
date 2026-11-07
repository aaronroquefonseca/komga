import { useQueryCache } from '@pinia/colada'
import { QUERY_KEYS_USERS, useCurrentUser } from '@/colada/users'
import { QUERY_KEYS_LIBRARIES, useLibraries } from '@/colada/libraries'
import {
  cacheOfflineLibraries,
  cacheSessionUser,
  getOfflineLibraries,
  getOfflineSessionUser,
  useOfflineLibraryStore,
} from '@/offline'
import { logger } from '@/services/logtape'

const CATALOG_SYNC_INTERVAL = 5 * 60 * 1000

/**
 * Offline boot wiring for next-ui, mirroring the classic `main.ts` bootstrap.
 *
 * - Restores the last cached session user + libraries into the query cache
 *   when the app boots offline, so auth/library guards can render from cache.
 * - Persists successful online session/libraries fetches for future offline boots.
 * - Reconciles downloaded revisions (catalog sync) before flushing queued
 *   read progress, throttled to 5 minutes like the classic UI.
 */
export function useOfflineBootstrap() {
  let syncScheduled = false
  const offline = useOfflineLibraryStore()
  const queryCache = useQueryCache()
  const router = useRouter()
  const { data: currentUser, isAuthenticated } = useCurrentUser()
  const { data: libraries } = useLibraries()

  void offline
    .whenReady()
    .then(restoreCachedSession)
    .catch(() => undefined)

  // Persist successful online fetches for future offline boots.
  watch(
    currentUser,
    (user) => {
      if (user && offline.online && !offline.offlineMode) {
        void cacheSessionUser(user).catch((error: unknown) =>
          logger.debug('Offline session cache failed', { error }),
        )
      }
    },
    { immediate: true },
  )

  watch(
    libraries,
    (items) => {
      if (items && items.length > 0 && offline.online && !offline.offlineMode) {
        void cacheOfflineLibraries(items).catch((error: unknown) =>
          logger.debug('Offline libraries cache failed', { error }),
        )
      }
    },
    { immediate: true },
  )

  async function restoreCachedSession(): Promise<void> {
    const localOnly = offline.offlineMode || !offline.online
    if (!localOnly) return
    try {
      const [cachedUser, cachedLibraries] = await Promise.all([
        getOfflineSessionUser(),
        getOfflineLibraries(),
      ])
      if (cachedUser && !queryCache.getQueryData(QUERY_KEYS_USERS.currentUser())) {
        queryCache.setQueryData(QUERY_KEYS_USERS.currentUser(), cachedUser)
      }
      if (cachedLibraries.length > 0 && !queryCache.getQueryData(QUERY_KEYS_LIBRARIES.root)) {
        queryCache.setQueryData(QUERY_KEYS_LIBRARIES.root, cachedLibraries)
      }
    } catch (error) {
      logger.debug('Offline session restore failed', { error })
    }
  }

  function syncOfflineState(forceCatalog = false): void {
    if (!isAuthenticated.value || syncScheduled || !offline.online || offline.offlineMode) return
    syncScheduled = true
    const owner = currentUser.value?.id
    offline.resumeDownloads()

    const shouldSyncCatalog =
      forceCatalog ||
      !offline.catalogSyncedAt ||
      Date.now() - Date.parse(offline.catalogSyncedAt) >= CATALOG_SYNC_INTERVAL
    const reconcile = shouldSyncCatalog
      ? offline.syncCatalogMetadata().catch(() => undefined)
      : Promise.resolve()

    // Reconcile downloaded revisions before flushing progress that may have
    // been recorded against an older page numbering.
    reconcile
      .then(() => offline.flushProgressQueue())
      .catch(() => undefined)
      .finally(() => {
        syncScheduled = false
        if (currentUser.value?.id !== owner) syncOfflineState()
      })
  }

  // Storage readiness can precede authentication on a cold load. Retry at the
  // actual authenticated transition, including login and connectivity changes.
  watch(
    [
      isAuthenticated,
      () => currentUser.value?.id,
      () => offline.initialized,
      () => offline.online,
      () => offline.offlineMode,
    ],
    () => {
      if (offline.initialized) syncOfflineState()
    },
    { immediate: true },
  )

  router.afterEach(() => syncOfflineState())
  window.addEventListener('focus', () => syncOfflineState())
  window.addEventListener('online', () => syncOfflineState(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncOfflineState()
  })

  // Initial sync attempt once the store is ready.
  void offline
    .whenReady()
    .then(() => syncOfflineState())
    .catch(() => undefined)
}
