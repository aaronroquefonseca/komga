import type { Router } from 'vue-router'
import { useQueryCache } from '@pinia/colada'
import { QUERY_KEYS_USERS } from '@/colada/users'
import { logger } from '@/services/logtape'

export const KOMGA_PREPARE_OFFLINE_SHELL = 'KOMGA_PREPARE_OFFLINE_SHELL'
export const KOMGA_OFFLINE_MODE = 'KOMGA_OFFLINE_MODE'
export const KOMGA_OFFLINE_STATUS = 'KOMGA_OFFLINE_STATUS'
/** Emitted by `scripts/generate-shell-manifest.ts` into `dist/`; served from the resource base. */
export const NEXTUI_SHELL_MANIFEST_FILENAME = 'nextui-shell.json'

const SHELL_LINK_RELATIONS = ['stylesheet', 'icon', 'apple-touch-icon', 'manifest']

/** Minimum delay between shell preparations; navigations fire `prepareOfflineShell` often. */
const PREPARE_MIN_INTERVAL_MS = 30_000

/** How often the precache poll asks the worker for KOMGA_OFFLINE_STATUS. */
const PREPARE_POLL_INTERVAL_MS = 2_000
/** Give up polling a precache batch after this long; the shell keeps preparing in the worker. */
const PREPARE_POLL_TIMEOUT_MS = 60_000
/** Single STATUS round-trip budget inside the poll loop. */
const STATUS_QUERY_TIMEOUT_MS = 5_000

export interface OfflineShellPrecacheStatus {
  batchId: string | null
  expected: number
  done: number
}

export interface OfflineShellStatus {
  shellReady?: boolean
  precache?: OfflineShellPrecacheStatus | null
}

let serviceWorkerRegistration: Promise<ServiceWorkerRegistration | undefined> | undefined
let manifestAssetUrls: string[] | undefined
let manifestRequest: Promise<string[]> | undefined
let lastPrepareAt = 0
let inFlightPrepare: Promise<void> | undefined
let precacheBatchCounter = 0
let trackingPrecache: Promise<void> | undefined
let precacheTracker = 0

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
  precacheBatchCounter = 0
  precacheTracker += 1
  trackingPrecache = undefined
}

/**
 * Ask the active worker for its offline status over the existing
 * KOMGA_OFFLINE_STATUS message channel. Resolves undefined when no worker
 * answers in time.
 */
export function queryOfflineShellStatus(
  timeoutMs = STATUS_QUERY_TIMEOUT_MS,
): Promise<OfflineShellStatus | undefined> {
  if (!('serviceWorker' in navigator) || typeof MessageChannel === 'undefined') {
    return Promise.resolve(undefined)
  }
  return getRegistration().then(
    (registration) =>
      new Promise<OfflineShellStatus | undefined>((resolve) => {
        const worker = registration?.active ?? navigator.serviceWorker.controller
        if (!worker) {
          resolve(undefined)
          return
        }
        let settled = false
        const channel = new MessageChannel()
        const finish = (status: OfflineShellStatus | undefined) => {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          channel.port1.onmessage = null
          resolve(status)
        }
        const timer = window.setTimeout(() => finish(undefined), timeoutMs)
        channel.port1.onmessage = (event: MessageEvent) =>
          finish(event.data as OfflineShellStatus | undefined)
        try {
          worker.postMessage({ type: KOMGA_OFFLINE_STATUS }, [channel.port2])
        } catch {
          finish(undefined)
        }
      }),
  )
}

/** True once the worker reports this batch fully cached. Pure and unit-tested. */
export function isPrecacheCompleteForBatch(
  status: OfflineShellStatus | undefined,
  batchId: string,
): boolean {
  const precache = status?.precache
  return !!precache && precache.batchId === batchId && precache.done >= precache.expected
}

export interface WaitForPrecacheOptions {
  queryStatus?: () => Promise<OfflineShellStatus | undefined>
  delay?: (ms: number) => Promise<void>
  timeoutMs?: number
  intervalMs?: number
  isCancelled?: () => boolean
  onProgress?: (precache: { expected: number; done: number }) => void
}

/**
 * Poll the worker until our PREPARE batch is fully cached or the timeout
 * elapses. Replies from older batches (or a restarted worker reporting null)
 * are ignored. Injectable for unit tests.
 */
export async function waitForPrecacheCompletion(
  batchId: string,
  expected: number,
  options?: WaitForPrecacheOptions,
): Promise<{ complete: boolean; precache: { expected: number; done: number } }> {
  const queryStatus = options?.queryStatus ?? (() => queryOfflineShellStatus())
  const delay =
    options?.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const timeoutMs = options?.timeoutMs ?? PREPARE_POLL_TIMEOUT_MS
  const intervalMs = options?.intervalMs ?? PREPARE_POLL_INTERVAL_MS
  const deadline = Date.now() + timeoutMs
  let precache = { expected, done: 0 }
  while (options?.isCancelled?.() !== true && Date.now() < deadline) {
    await delay(intervalMs)
    let status: OfflineShellStatus | undefined
    try {
      status = await queryStatus()
    } catch {
      status = undefined
    }
    if (status?.precache?.batchId === batchId) {
      precache = { expected: status.precache.expected, done: status.precache.done }
      options?.onProgress?.(precache)
      if (isPrecacheCompleteForBatch(status, batchId)) return { complete: true, precache }
    }
  }
  return { complete: false, precache }
}

/**
 * Publish precache progress to the offline store. Dynamically imported so
 * this service module stays free of the store's dependency chain; failures
 * (no Pinia yet, unit tests) keep the default `unknown` state.
 */
function publishShellReadiness(
  readiness: 'unknown' | 'preparing' | 'ready',
  precache: { expected: number; done: number },
): void {
  void import('@/offline/offline-store')
    .then((module) => {
      try {
        module.useOfflineLibraryStore().setShellReadiness(readiness, precache)
      } catch {
        // Pinia is not installed yet; the store keeps its default state.
      }
    })
    .catch(() => undefined)
}

function trackPrecacheBatch(batchId: string, expected: number): void {
  if (trackingPrecache) return
  const tracker = ++precacheTracker
  const isCancelled = () => tracker !== precacheTracker
  publishShellReadiness('preparing', { expected, done: 0 })
  trackingPrecache = waitForPrecacheCompletion(batchId, expected, {
    isCancelled,
    onProgress: (precache) => publishShellReadiness('preparing', precache),
  }).then(
    ({ complete, precache }) => {
      trackingPrecache = undefined
      if (complete && !isCancelled()) publishShellReadiness('ready', precache)
    },
    () => {
      trackingPrecache = undefined
    },
  )
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
      precacheBatchCounter += 1
      const batchId = `komga-shell-${now}-${precacheBatchCounter}`
      postToActiveWorker({
        type: KOMGA_PREPARE_OFFLINE_SHELL,
        batchId,
        pageUrl: window.location.href,
        assets,
      })
      trackPrecacheBatch(batchId, assets.length)
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
