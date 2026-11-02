import type { Router } from 'vue-router'
import { useQueryCache } from '@pinia/colada'
import { QUERY_KEYS_USERS } from '@/colada/users'
import { logger } from '@/services/logtape'

export const KOMGA_PREPARE_OFFLINE_SHELL = 'KOMGA_PREPARE_OFFLINE_SHELL'
export const KOMGA_OFFLINE_MODE = 'KOMGA_OFFLINE_MODE'

const SHELL_LINK_RELATIONS = ['stylesheet', 'icon', 'apple-touch-icon', 'manifest']

let serviceWorkerRegistration: Promise<ServiceWorkerRegistration | undefined> | undefined

function getRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(undefined)
  if (!serviceWorkerRegistration) {
    // index.html registers the worker before the bundles execute; ready
    // resolves once an active worker exists for this scope.
    serviceWorkerRegistration = navigator.serviceWorker.ready.catch(() => undefined)
  }
  return serviceWorkerRegistration
}

function postToActiveWorker(message: object): void {
  void getRegistration()
    .then((registration) => {
      registration?.active?.postMessage(message)
    })
    .catch((error: unknown) =>
      logger.warn('Komga offline service worker message failed', { error }),
    )
}

export function getOfflineShellAssets(): string[] {
  const assets = new Set<string>()
  document.querySelectorAll<HTMLScriptElement>('script[src]').forEach((element) => {
    if (element.src) assets.add(element.src)
  })
  document.querySelectorAll<HTMLLinkElement>('link[href]').forEach((element) => {
    if (SHELL_LINK_RELATIONS.includes(element.rel.toLocaleLowerCase()) && element.href) {
      assets.add(element.href)
    }
  })
  return [...assets]
}

export function prepareOfflineShell(): void {
  if (!('serviceWorker' in navigator) || !navigator.onLine) return
  postToActiveWorker({
    type: KOMGA_PREPARE_OFFLINE_SHELL,
    pageUrl: window.location.href,
    assets: getOfflineShellAssets(),
  })
}

/**
 * Report offline-mode state to the shared service worker. The full state
 * lives in the offline data layer; this is only the transport. The worker
 * also reads the persisted value from IndexedDB on activate, so this call
 * only needs to cover in-memory transitions (and the boot default).
 */
export function setServiceWorkerOfflineMode(enabled: boolean): void {
  if (!('serviceWorker' in navigator)) return
  postToActiveWorker({ type: KOMGA_OFFLINE_MODE, enabled })
}

function isAuthenticated(): boolean {
  try {
    return !!useQueryCache().getQueryData(QUERY_KEYS_USERS.currentUser())
  } catch {
    return false
  }
}

/**
 * Mirror the classic UI shell-caching triggers: cache the shell once the app
 * is loaded, refresh it whenever connectivity returns, and refresh it after
 * authenticated navigations (new chunks may have been fetched since login).
 */
export function setupOfflineShell(router: Router): void {
  if (!('serviceWorker' in navigator)) return

  const prepareWhenLoaded = () => prepareOfflineShell()
  if (document.readyState === 'complete') prepareWhenLoaded()
  else window.addEventListener('load', prepareWhenLoaded, { once: true })

  window.addEventListener('online', () => prepareOfflineShell())

  router.afterEach(() => {
    if (isAuthenticated()) prepareOfflineShell()
  })

  // Default until the offline data layer pushes the real state.
  setServiceWorkerOfflineMode(false)
}
