/* global self, caches, indexedDB, Response, URL */

const SHELL_CACHE = 'komga-shell-v1'
const LEGACY_MEDIA_CACHE = 'komga-offline-media-v1'
const BOOK_CACHE_PREFIX = 'komga-offline-book-v2-'
const DB_NAME = 'komga-offline'
const DB_VERSION = 1
const SETTINGS_STORE = 'settings'
const DOWNLOADS_STORE = 'downloads'
let offlineMode
const activeDownloads = new Map()

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
    // Per-book caches are versioned snapshots and must not be deleted here.
    // The page-side offline service deletes superseded/orphaned revisions only
    // after a replacement has committed successfully.
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
