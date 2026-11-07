import { useOfflineLibraryStore } from '@/offline'
import { isOfflineAccount, offlineAccountToken } from '@/offline/offline-db'

/**
 * An image reused from browser memory need not issue a service-worker request.
 * Revisit successfully loaded covers through fetch so the worker can persist
 * them, including covers shown before the preference or worker became ready.
 */
export function useOfflineCoverCaching() {
  const offline = useOfflineLibraryStore()
  const queue: { url: string; account: number; key: string }[] = []
  const pending = new Set<string>()
  let running = 0
  let disposed = false

  function canCache(): boolean {
    return (
      !disposed &&
      offline.initialized &&
      offline.preferences.cacheCovers &&
      offline.online &&
      !offline.offlineMode &&
      !!navigator.serviceWorker?.controller
    )
  }

  function processQueue(): void {
    while (queue.length && running < 3) {
      const item = queue.shift()!
      if (!canCache() || !isOfflineAccount(item.account)) {
        pending.delete(item.key)
        continue
      }
      running++
      void fetch(item.url, { credentials: 'include' })
        .catch(() => undefined)
        .finally(() => {
          pending.delete(item.key)
          running--
          processQueue()
        })
    }
  }

  function cacheLoadedCover(image: HTMLImageElement): void {
    if (!canCache() || !image.complete || !image.naturalWidth) return
    const url = new URL(image.currentSrc || image.src, window.location.href)
    const base = window.resourceBaseUrl || '/'
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith(base) ||
      !/\/api\/v1\/(books|series)\/[^/]+\/thumbnail\/?$/.test(url.pathname)
    )
      return
    const account = offlineAccountToken()
    const key = `${account}:${url.href}`
    if (pending.has(key)) return
    pending.add(key)
    queue.push({ url: url.href, account, key })
    processQueue()
  }

  function scanLoadedCovers(): void {
    if (canCache()) document.querySelectorAll('img').forEach(cacheLoadedCover)
  }

  function onImageLoad(event: Event): void {
    if (event.target instanceof HTMLImageElement) cacheLoadedCover(event.target)
  }

  watch(
    [
      () => offline.initialized,
      () => offline.preferences.cacheCovers,
      () => offline.online,
      () => offline.offlineMode,
    ],
    scanLoadedCovers,
    { flush: 'post' },
  )
  onMounted(() => {
    document.addEventListener('load', onImageLoad, true)
    navigator.serviceWorker?.addEventListener('controllerchange', scanLoadedCovers)
    scanLoadedCovers()
  })
  onUnmounted(() => {
    disposed = true
    queue.length = 0
    pending.clear()
    document.removeEventListener('load', onImageLoad, true)
    navigator.serviceWorker?.removeEventListener('controllerchange', scanLoadedCovers)
  })
}
