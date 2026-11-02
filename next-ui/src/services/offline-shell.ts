import type { Router } from 'vue-router'
import { useQueryCache } from '@pinia/colada'
import { QUERY_KEYS_USERS } from '@/colada/users'
import { logger } from '@/services/logtape'

export const KOMGA_PREPARE_OFFLINE_SHELL = 'KOMGA_PREPARE_OFFLINE_SHELL'
export const KOMGA_OFFLINE_MODE = 'KOMGA_OFFLINE_MODE'
/** Emitted by `scripts/generate-shell-manifest.ts` into `dist/`; served from the resource base. */
export const NEXTUI_SHELL_MANIFEST_FILENAME = 'nextui-shell.json'

const SHELL_LINK_RELATIONS = ['stylesheet', 'icon', 'apple-touch-icon', 'manifest']

/** Minimum delay between shell preparations; navigations fire `prepareOfflineShell` often. */
const PREPARE_MIN_INTERVAL_MS = 30_000

let serviceWorkerRegistration: Promise<ServiceWorkerRegistration | undefined> | undefined
let manifestAssetUrls: string[] | undefined
let manifestRequest: Promise<string[]> | undefined
let lastPrepareAt = 0
let inFlightPrepare: Promise<void> | undefined

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

function resourceBasePath(): string {
  const base = window.resourceBaseUrl || '/'
  return base.endsWith('/') ? base : `${base}/`
}

function shellManifestUrl(): string {
  return new URL(NEXTUI_SHELL_MANIFEST_FILENAME, window.location.origin + resourceBasePath()).href
}

/**
 * Liberal parser for the build-time shell manifest. Accepts the emitted shape
 * `{app, version, files: [{url, size, sha256}]}` as well as plain string
 * arrays, so older/newer manifests degrade to a usable URL list.
 */
export function parseShellManifest(data: unknown): string[] {
  const files = Array.isArray(data)
    ? data
    : typeof data === 'object' &&
        data !== null &&
        Array.isArray((data as { files?: unknown }).files)
      ? (data as { files: unknown[] }).files
      : []
  return files.flatMap((file) => {
    if (typeof file === 'string') return file ? [file] : []
    if (
      typeof file === 'object' &&
      file !== null &&
      typeof (file as { url?: unknown }).url === 'string'
    ) {
      const url = (file as { url: string }).url
      return url ? [url] : []
    }
    return []
  })
}

/** Resolve manifest-relative URLs against the resource base; drop cross-origin/invalid entries. */
export function resolveShellAssetUrls(rawUrls: string[], baseUrl: string): string[] {
  const base = new URL(baseUrl)
  return rawUrls.flatMap((rawUrl) => {
    if (!rawUrl.trim()) return []
    try {
      const resolved = new URL(rawUrl, base)
      return resolved.origin === base.origin ? [resolved.href] : []
    } catch {
      return []
    }
  })
}

/** Merge asset lists, preserving first-seen order. */
export function mergeShellAssets(...lists: string[][]): string[] {
  return [...new Set(lists.flat())]
}

async function loadManifestAssetUrls(): Promise<string[]> {
  if (manifestAssetUrls) return manifestAssetUrls
  if (!manifestRequest) {
    manifestRequest = (async () => {
      try {
        const response = await fetch(shellManifestUrl(), { cache: 'no-store' })
        if (!response.ok) return []
        const urls = resolveShellAssetUrls(
          parseShellManifest(await response.json()),
          window.location.origin + resourceBasePath(),
        )
        manifestAssetUrls = urls
        return urls
      } catch (error: unknown) {
        logger.warn('Komga offline shell manifest fetch failed', { error })
        return []
      } finally {
        manifestRequest = undefined
      }
    })()
  }
  return manifestRequest
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

/** Test-only reset for the module memoization above (registration, manifest, throttle). */
export function resetOfflineShellStateForTests(): void {
  serviceWorkerRegistration = undefined
  manifestAssetUrls = undefined
  manifestRequest = undefined
  lastPrepareAt = 0
  inFlightPrepare = undefined
}

export function prepareOfflineShell(): void {
  if (!('serviceWorker' in navigator) || !navigator.onLine) return
  if (inFlightPrepare) return
  const now = Date.now()
  if (now - lastPrepareAt < PREPARE_MIN_INTERVAL_MS) return
  lastPrepareAt = now
  inFlightPrepare = (async () => {
    try {
      const assets = mergeShellAssets(getOfflineShellAssets(), await loadManifestAssetUrls())
      postToActiveWorker({
        type: KOMGA_PREPARE_OFFLINE_SHELL,
        pageUrl: window.location.href,
        assets,
      })
    } finally {
      inFlightPrepare = undefined
    }
  })()
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
