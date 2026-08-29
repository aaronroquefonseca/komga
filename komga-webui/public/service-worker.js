/* global self, caches, indexedDB, Response, URL */

const SHELL_CACHE = 'komga-shell-v1'
const MEDIA_CACHE = 'komga-offline-media-v1'
const DB_NAME = 'komga-offline'
const DB_VERSION = 1
const SETTINGS_STORE = 'settings'
let offlineMode

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', {keyPath: 'id'})
      if (!db.objectStoreNames.contains('series')) db.createObjectStore('series', {keyPath: 'id'})
      if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', {keyPath: 'bookId'})
      if (!db.objectStoreNames.contains('downloads')) db.createObjectStore('downloads', {keyPath: 'bookId'})
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', {keyPath: 'bookId'})
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, {keyPath: 'key'})
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readOfflineMode() {
  if (typeof offlineMode === 'boolean') return offlineMode
  try {
    const db = await openDatabase()
    offlineMode = await new Promise(resolve => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly')
      const request = tx.objectStore(SETTINGS_STORE).get('offlineMode')
      request.onsuccess = () => resolve(request.result && request.result.value === true)
      request.onerror = () => resolve(false)
    })
  } catch (_) {
    offlineMode = false
  }
  return offlineMode
}

function isApiRequest(url) {
  return url.pathname.includes('/api/')
}

function isBookPage(url) {
  return /\/api\/v1\/books\/[^/]+\/pages\/\d+\/?$/.test(url.pathname)
}

function isOfflineThumbnail(url) {
  return /\/api\/v1\/(books|series)\/[^/]+\/thumbnail\/?$/.test(url.pathname)
}

async function cachedMedia(request) {
  const cache = await caches.open(MEDIA_CACHE)
  return cache.match(request, {ignoreSearch: true})
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    try {
      await cache.add(new URL('./', self.registration.scope).href)
    } catch (_) {
      // Runtime asset caching below will still make an already-opened PWA usable.
    }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, MEDIA_CACHE])
    const names = await caches.keys()
    await Promise.all(names.filter(name => name.startsWith('komga-') && !keep.has(name)).map(name => caches.delete(name)))
    await self.clients.claim()
    offlineMode = undefined
    await readOfflineMode()
  })())
})

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'KOMGA_OFFLINE_MODE') {
    offlineMode = event.data.enabled === true
  }
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (isBookPage(url)) {
    event.respondWith((async () => {
      const cached = await cachedMedia(request)
      if (cached) return cached
      if (await readOfflineMode()) {
        return new Response('This page is not downloaded for offline reading.', {
          status: 503,
          headers: {'Content-Type': 'text/plain; charset=utf-8'},
        })
      }
      return fetch(request)
    })())
    return
  }

  if (isOfflineThumbnail(url)) {
    event.respondWith((async () => {
      const cached = await cachedMedia(request)
      if (cached) return cached
      if (await readOfflineMode()) return new Response('', {status: 503})
      return fetch(request)
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
      return fetch(request)
    })())
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE)
      try {
        const response = await fetch(request)
        if (response.ok) await cache.put(request, response.clone())
        return response
      } catch (_) {
        return (await cache.match(request)) ||
          (await cache.match(new URL('./', self.registration.scope).href)) ||
          new Response('Komga is unavailable offline until it has been opened online once.', {
            status: 503,
            headers: {'Content-Type': 'text/plain; charset=utf-8'},
          })
      }
    })())
    return
  }

  // Cache application JS/CSS/fonts/icons as they are used. This avoids needing
  // to know Vue CLI's hashed filenames ahead of time and works with context paths.
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
