/* global self, caches, indexedDB, Response, Request, URL */

const DEPLOYMENT_SUFFIX = new URL(self.registration.scope).pathname === '/' ? '' : '-' + encodeURIComponent(new URL(self.registration.scope).pathname)
const SHELL_CACHE = 'komga-shell-v3' + DEPLOYMENT_SUFFIX
const OFFLINE_SHELL_PATH = '__komga_offline_shell__'
const LEGACY_MEDIA_CACHE = 'komga-offline-media-v1'
const BOOK_CACHE_PREFIX = 'komga-offline-book-v2-'
const DB_NAME = 'komga-offline' + DEPLOYMENT_SUFFIX
const DB_VERSION = 1
const SETTINGS_STORE = 'settings'
const DOWNLOADS_STORE = 'downloads'
let offlineMode
const activeDownloads = new Map()
// Progress of the latest KOMGA_PREPARE_OFFLINE_SHELL batch, so the page can
// poll KOMGA_OFFLINE_STATUS until the precache set is complete. Reset per
// batch; a worker restart drops it back to null (unknown).
let precacheProgress = null
let preparingShell
const STATUS_PATH = '__komga_offline_status__'
const NETWORK_TIMEOUT_MS = 8000

async function boundedFetch(request) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)
  try {
    return await fetch(request, {signal: controller.signal})
  } finally {
    clearTimeout(timer)
  }
}

function offlineShellUrl(app = '') {
  return new URL(OFFLINE_SHELL_PATH + (app ? '-' + app : ''), self.registration.scope).href
}

function shellApp(url) {
  const relative = new URL(url).pathname.slice(new URL(self.registration.scope).pathname.length)
  return /^(classic|next)(\/|$)/.exec(relative)?.[1] || ''
}

function scopeRootUrl() {
  return new URL('./', self.registration.scope).href
}

function openDatabase(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION)
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
  let db = await openDatabase()
  const pointer = await new Promise(resolve => {
    const request = db.transaction(SETTINGS_STORE, 'readonly').objectStore(SETTINGS_STORE).get('activeDatabase')
    request.onsuccess = () => resolve(request.result?.value)
    request.onerror = () => resolve(undefined)
  })
  if (pointer) { db.close(); db = await openDatabase(pointer) }
  return new Promise(resolve => {
    const tx = db.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).get(key)
    request.onsuccess = () => { db.close(); resolve(request.result) }
    request.onerror = () => { db.close(); resolve(undefined) }
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
  const record = await readStore(DOWNLOADS_STORE, bookId)
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
  const session = await readStore(SETTINGS_STORE, 'sessionUser')
  if (!session?.value) return undefined
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

async function cacheShellAssets(urls, onAssetSettled) {
  const cache = await caches.open(SHELL_CACHE)
  const list = [...new Set(urls || [])]
  let cursor = 0
  async function consume() {
    while (cursor < list.length) {
      const assetUrl = list[cursor++]
      let success = false
      try {
        const url = new URL(assetUrl, self.registration.scope)
        if (url.origin !== self.location.origin) continue
        const request = new Request(url.href, {credentials: 'include'})
        // Hashed assets are immutable; reuse complete cached responses on retries.
        if (await cache.match(request)) success = true
        else {
          const response = await boundedFetch(new Request(request, {cache: 'no-store'}))
          // A SPA fallback or proxy login page is not a JavaScript/CSS asset.
          if (response.ok && !(response.headers.get('content-type') || '').includes('text/html')) {
            await cache.put(request, response)
            success = true
          }
        }
      } catch (_) {
        // Retry failed assets on the next preparation; never report them as ready.
      } finally {
        if (onAssetSettled) onAssetSettled(success)
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(8, list.length)}, consume))
}

async function prepareOfflineShell(pageUrl, assets, batchId) {
  // One worker serves both UIs. Next UI opens the classic reader, so both
  // HTML entries AND both manifests are needed, even before the first read.
  if (preparingShell) await preparingShell
  const run = async () => {
    const cache = await caches.open(SHELL_CACHE)
    const progress = {batchId: batchId || null, expected: 0, done: 0, failed: 0, complete: false, settled: false}
    precacheProgress = progress
    const urls = new Set(assets || [])
    let manifestsReady = true
    await Promise.all(['nextui-shell.json', 'webui-shell.json'].map(async name => {
      try {
        const response = await boundedFetch(new Request(new URL(name, self.registration.scope), {cache: 'no-store'}))
        if (!response.ok) throw new Error('Manifest unavailable')
        const manifest = await response.json()
        const files = Array.isArray(manifest) ? manifest : manifest.files
        if (!Array.isArray(files) || !files.length) throw new Error('Empty manifest')
        for (const file of files) {
          const path = typeof file === 'string' ? file : file.url
          // index.html is a build artifact; the server renders it at /classic/.
          if (!path || path === 'index.html' || path === 'service-worker.js' || path.endsWith('.map')) continue
          const url = new URL(path, self.registration.scope)
          if (url.origin === self.location.origin) urls.add(url.href)
        }
      } catch (_) { manifestsReady = false }
    }))
    progress.expected = urls.size
    const shells = []
    await Promise.all([...new Set([pageUrl, scopeRootUrl(), new URL('next/', self.registration.scope).href,
      new URL('classic/', self.registration.scope).href].filter(Boolean))].map(async url => {
      try {
        const response = await boundedFetch(new Request(url, {credentials: 'include', cache: 'no-store'}))
        if (!isHtmlResponse(response)) throw new Error('Shell unavailable')
        shells.push({url, response})
      } catch (_) { manifestsReady = false }
    }))
    await cacheShellAssets([...urls], success => {
      progress.done += 1
      if (!success) progress.failed += 1
    })
    progress.complete = manifestsReady && progress.failed === 0 && progress.expected > 0
    if (progress.complete) {
      for (const {url, response} of shells) {
        await cache.put(new Request(offlineShellUrl(shellApp(url))), response.clone())
        await cache.put(new Request(url), response.clone())
      }
    }
    progress.settled = true
    await cache.put(new URL(STATUS_PATH, self.registration.scope).href,
      new Response(JSON.stringify({...progress, assets: [...urls]}), {headers: {'Content-Type': 'application/json'}}))
    return progress.complete
  }
  preparingShell = run()
  try { return await preparingShell } finally { preparingShell = undefined }
}

async function offlineStatus() {
  const cache = await caches.open(SHELL_CACHE)
  const stored = await cache.match(new URL(STATUS_PATH, self.registration.scope).href)
  const saved = stored ? await stored.json() : null
  let shellReady = saved?.complete === true
  if (shellReady) {
    const responses = await Promise.all(saved.assets.map(url => cache.match(url)))
    shellReady = responses.every(Boolean) && !!(await cache.match(offlineShellUrl('next'))) &&
      !!(await cache.match(offlineShellUrl('classic')))
  }
  return {
    version: SHELL_CACHE,
    scope: self.registration.scope,
    shellReady,
    precache: precacheProgress || saved,
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Page-side preparation owns manifests and atomically commits complete shells.
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names
      .filter(name => !DEPLOYMENT_SUFFIX && /^komga-shell-v[12]$/.test(name))
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
  if (event.data.type === 'KOMGA_SESSION_CHANGED') {
    activeDownloads.clear()
    offlineMode = undefined
  } else if (event.data.type === 'KOMGA_OFFLINE_MODE') {
    offlineMode = event.data.enabled === true
  } else if (event.data.type === 'KOMGA_DOWNLOAD_CHANGED' && event.data.bookId) {
    activeDownloads.delete(event.data.bookId)
  } else if (event.data.type === 'KOMGA_PREPARE_OFFLINE_SHELL') {
    event.waitUntil(prepareOfflineShell(event.data.pageUrl, event.data.assets, event.data.batchId))
  } else if (event.data.type === 'KOMGA_CACHE_ASSETS') {
    event.waitUntil(cacheShellAssets(event.data.assets))
  } else if (event.data.type === 'KOMGA_OFFLINE_STATUS' && event.ports && event.ports[0]) {
    event.waitUntil(offlineStatus().then(status => event.ports[0].postMessage(status)))
  }
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Staging a revision must bypass the active reader snapshot.
  if (request.headers.get('X-Komga-Download') === 'network') {
    event.respondWith(boundedFetch(request))
    return
  }

  const pageBookId = bookIdFromPage(url)
  if (pageBookId) {
    event.respondWith((async () => {
      const cached = await cachedBookMedia(pageBookId, request)
      if (cached) return cached
      if (await readOfflineMode()) return unavailablePage()
      try {
        return await boundedFetch(request)
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
        return await boundedFetch(request)
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
        return await boundedFetch(request)
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
        if (await readOfflineMode()) throw new Error('Offline mode')
        const response = await boundedFetch(request)
        if (!response.ok) throw new Error('Server unavailable')
        // Commit HTML only with a complete dependency set in prepareOfflineShell.
        return response
      } catch (_) {
        // Every Vue route uses the same HTML entry point. Always prefer the
        // canonical shell for cold starts/deep links, then exact/root fallbacks.
        return (await cache.match(offlineShellUrl(shellApp(request.url)))) ||
          (await cache.match(request)) ||
          new Response('Komga is unavailable offline until it has been opened online once.', {
            status: 503,
            headers: {'Content-Type': 'text/plain; charset=utf-8'},
          })
      }
    })())
    return
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE)
    const cached = await cache.match(request)
    if (cached) return cached
    try {
      const response = await boundedFetch(request)
      if (response.ok) await cache.put(request, response.clone())
      return response
    } catch (_) {
      return new Response('', {status: 504})
    }
  })())
})
