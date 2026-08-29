/* global self, caches, indexedDB, Response, Request, URL */

const SHELL_CACHE = 'komga-shell-v2'
const SHELL_CACHE_PREFIX = 'komga-shell-'
const OFFLINE_SHELL_PATH = '__komga_offline_shell__'
const LEGACY_MEDIA_CACHE = 'komga-offline-media-v1'
const BOOK_CACHE_PREFIX = 'komga-offline-book-v2-'
const DB_NAME = 'komga-offline'
const DB_VERSION = 1
const SETTINGS_STORE = 'settings'
const DOWNLOADS_STORE = 'downloads'
let offlineMode
const activeDownloads = new Map()

function offlineShellUrl() {
  return new URL(OFFLINE_SHELL_PATH, self.registration.scope).href
}

function scopeRootUrl() {
  return new URL('./', self.registration.scope).href
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', {keyPath: 'id'})
      if (!db.objectStoreNames.contains('series')) db.createObjectStore('series', {keyPath: 'id'})
      if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', {keyPath: 'bookId'})
      if (!db.objectStoreNames.contains(DOWNLOADS_STORE)) db.createObjectStore(DOWNLOADS_STORE, {keyPath: 'bookId'})
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', {keyPath: 'bookId'})
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, {keyPath: 'key'})
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readStore(storeName, key) {
  const db = await openDatabase()
  return new Promise(resolve => {
    const tx = db.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(undefined)
  })
}

async function readOfflineMode() {
  if (typeof offlineMode === 'boolean') return offlineMode
  try {
    const setting = await readStore(SETTINGS_STORE, 'offlineMode')
    offlineMode = !!(setting && setting.value === true)
  } catch (_) {
    offlineMode = false
  }
  return offlineMode
}

async function downloadRecord(bookId) {
  if (activeDownloads.has(bookId)) return activeDownloads.get(bookId)
  const record = await readStore(DOWNLOADS_STORE, bookId)
  activeDownloads.set(bookId, record || null)
  return record
}

function isApiRequest(url) {
  return url.pathname.includes('/api/')
}

function bookIdFromPage(url) {
  const match = url.pathname.match(/\/api\/v1\/books\/([^/]+)\/pages\/\d+\/?$/)
  return match ? decodeURIComponent(match[1]) : null
}

function bookIdFromThumbnail(url) {
  const match = url.pathname.match(/\/api\/v1\/books\/([^/]+)\/thumbnail\/?$/)
  return match ? decodeURIComponent(match[1]) : null
}

async function cachedBookMedia(bookId, request) {
  const record = await downloadRecord(bookId)
  if (!record || !record.cacheName) return undefined
  const cache = await caches.open(record.cacheName)
  return cache.match(request, {ignoreSearch: true})
}

async function unavailablePage() {
  return new Response('This page is not downloaded for offline reading.', {
    status: 503,
    headers: {'Content-Type': 'text/plain; charset=utf-8'},
  })
}

function isHtmlResponse(response) {
  return response && response.ok && (response.headers.get('content-type') || '').includes('text/html')
}

async function cacheCanonicalShell(cache, response) {
  if (!isHtmlResponse(response)) return false
  await cache.put(new Request(offlineShellUrl()), response.clone())
  return true
}

async function fetchAndCacheShell(url) {
  const cache = await caches.open(SHELL_CACHE)
  const request = new Request(url, {
    credentials: 'include',
    cache: 'no-store',
    redirect: 'follow',
  })
  const response = await fetch(request)
  if (!isHtmlResponse(response)) return false
  await cacheCanonicalShell(cache, response)
  await cache.put(new Request(url, {credentials: 'include'}), response.clone())
  return true
}

async function cacheShellAssets(urls) {
  const cache = await caches.open(SHELL_CACHE)
  for (const assetUrl of urls || []) {
    try {
      const url = new URL(assetUrl, self.registration.scope)
      if (url.origin !== self.location.origin) continue
      const request = new Request(url.href, {credentials: 'include', cache: 'no-store'})
      const response = await fetch(request)
      if (response.ok) await cache.put(new Request(url.href, {credentials: 'include'}), response)
    } catch (_) {
      // One optional icon/font/chunk must not prevent the rest of the shell being cached.
    }
  }
}

async function prepareOfflineShell(pageUrl, assets) {
  let shellReady = false
  const candidates = [pageUrl, scopeRootUrl()].filter(Boolean)
  for (const candidate of candidates) {
    try {
      if (await fetchAndCacheShell(candidate)) {
        shellReady = true
        break
      }
    } catch (_) {
      // Try the next known SPA URL.
    }
  }
  await cacheShellAssets(assets)
  return shellReady
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // This remains a best-effort first attempt. Once the already-loaded app can
    // talk to this worker it sends KOMGA_PREPARE_OFFLINE_SHELL, which performs a
    // verified authenticated shell+asset cache pass.
    try {
      await prepareOfflineShell(scopeRootUrl(), [])
    } catch (_) {
      // The page-side preparation pass will retry once Komga has loaded online.
    }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Per-book caches are versioned snapshots and must not be deleted here.
    // Delete only superseded application-shell caches and the pre-v2 media cache.
    const names = await caches.keys()
    await Promise.all(names
      .filter(name => name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE)
      .map(name => caches.delete(name)))
    await caches.delete(LEGACY_MEDIA_CACHE)
    await self.clients.claim()
    offlineMode = undefined
    activeDownloads.clear()
    await readOfflineMode()
  })())
})

self.addEventListener('message', event => {
  if (!event.data) return
  if (event.data.type === 'KOMGA_OFFLINE_MODE') {
    offlineMode = event.data.enabled === true
  } else if (event.data.type === 'KOMGA_DOWNLOAD_CHANGED' && event.data.bookId) {
    activeDownloads.delete(event.data.bookId)
  } else if (event.data.type === 'KOMGA_PREPARE_OFFLINE_SHELL') {
    event.waitUntil(prepareOfflineShell(event.data.pageUrl, event.data.assets))
  } else if (event.data.type === 'KOMGA_CACHE_ASSETS') {
    event.waitUntil(cacheShellAssets(event.data.assets))
  }
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  const pageBookId = bookIdFromPage(url)
  if (pageBookId) {
    event.respondWith((async () => {
      const cached = await cachedBookMedia(pageBookId, request)
      if (cached) return cached
      if (await readOfflineMode()) return unavailablePage()
      try {
        return await fetch(request)
      } catch (_) {
        return unavailablePage()
      }
    })())
    return
  }

  const thumbnailBookId = bookIdFromThumbnail(url)
  if (thumbnailBookId) {
    event.respondWith((async () => {
      const cached = await cachedBookMedia(thumbnailBookId, request)
      if (cached) return cached
      if (await readOfflineMode()) return new Response('', {status: 503})
      try {
        return await fetch(request)
      } catch (_) {
        return new Response('', {status: 503})
      }
    })())
    return
  }

  if (isApiRequest(url)) {
    event.respondWith((async () => {
      if (await readOfflineMode()) {
        return new Response(JSON.stringify({message: 'Offline mode is enabled'}), {
          status: 503,
          headers: {'Content-Type': 'application/json'},
        })
      }
      try {
        return await fetch(request)
      } catch (_) {
        return new Response(JSON.stringify({message: 'Komga server is unavailable'}), {
          status: 503,
          headers: {'Content-Type': 'application/json'},
        })
      }
    })())
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE)
      try {
        const response = await fetch(request)
        if (response.ok) {
          await cache.put(request, response.clone())
          await cacheCanonicalShell(cache, response)
        }
        return response
      } catch (_) {
        // Every Vue route uses the same HTML entry point. The canonical shell is
        // therefore the most reliable fallback for PWA cold starts and deep links.
        return (await cache.match(offlineShellUrl())) ||
          (await cache.match(request)) ||
          (await cache.match(scopeRootUrl())) ||
          new Response('Komga is unavailable offline until it has been opened online once.', {
            status: 503,
            headers: {'Content-Type': 'text/plain; charset=utf-8'},
          })
      }
    })())
    return
  }

  // Cache application JS/CSS/fonts/icons as they are used. Explicit shell
  // preparation also caches assets that loaded before this worker took control.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE)
    const cached = await cache.match(request)
    if (cached) return cached
    try {
      const response = await fetch(request)
      if (response.ok) await cache.put(request, response.clone())
      return response
    } catch (_) {
      return new Response('', {status: 504})
    }
  })())
})
