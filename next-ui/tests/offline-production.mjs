// Production regression: actual built bundles + shared worker, with the browser
// process restarted and its network disabled. Run npm run test:offline after builds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const mockSource = await readFile(resolve(root, 'next-ui/src/mocks/api/handlers/books.ts'), 'utf8')
const book = runInNewContext(
  '(' + mockSource.split('export const mockBook = ')[1].split(' satisfies BookDto')[0] + ')',
)
book.id = 'offline-book'
book.libraryId = '1'
book.seriesId = '57'
book.media.pagesCount = 2
book.readProgress = { page: 1, completed: false }
const seriesSource = await readFile(
  resolve(root, 'next-ui/src/mocks/api/handlers/series.ts'),
  'utf8',
)
const series = runInNewContext(
  '(' +
    seriesSource
      .split('export const mockSeries1 = ')[1]
      .split(' satisfies SeriesDto')[0]
      .split(' as SeriesDto')[0] +
    ')',
)
const user = {
  id: 'offline-user',
  email: 'offline@example.org',
  roles: ['ADMIN', 'USER', 'FILE_DOWNLOAD', 'PAGE_STREAMING'],
  sharedAllLibraries: true,
  sharedLibrariesIds: [],
  labelsAllow: [],
  labelsExclude: [],
}
const pages = [1, 2].map((number) => ({
  number,
  fileName: `${number}.jpg`,
  mediaType: 'image/jpeg',
  width: 1000,
  height: 1400,
  size: 100,
}))
const image = await readFile(resolve(root, 'next-ui/src/assets/mock-thumbnail.jpg'))
const mime = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}
let failAsset = ''
let holdCatalog = false
let pendingCatalogResponse
let mediaVersion = 'old'
let authorized = true
let unavailable = false
let networkDown = false
const server = createServer(async (req, res) => {
  if (networkDown) {
    req.socket.destroy()
    return
  }
  const path = new URL(req.url, 'http://localhost').pathname
  const json = (value) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(value))
  }
  try {
    if (unavailable === 'hang') return
    if (unavailable) {
      res.writeHead(503)
      res.end()
      return
    }
    if (path === failAsset) {
      res.writeHead(503)
      res.end()
      return
    }
    if (path.startsWith('/api/')) {
      if (path === '/api/logout') {
        authorized = false
        res.writeHead(204)
        res.end()
        return
      }
      if (path.endsWith('/books/list') && holdCatalog) {
        pendingCatalogResponse = () =>
          json({
            content: [book],
            totalElements: 1,
            totalPages: 1,
            last: true,
            first: true,
            number: 0,
            size: 50,
          })
        return
      }
      if (path.endsWith('/users/me')) {
        if (!authorized) {
          res.writeHead(401)
          res.end()
          return
        }
        return json(user)
      }
      if (path.endsWith('/libraries')) return json([{ id: '1', name: 'Comics' }])
      if (
        path.endsWith('/client-settings/user/list') ||
        path.endsWith('/client-settings/global/list')
      )
        return json({})
      if (path.includes('/claim')) return json({ isClaimed: true })
      if (path.endsWith('/pages')) return json(pages)
      if (/\/pages\/\d+$/.test(path)) {
        res.setHeader('Content-Type', 'image/jpeg')
        res.end(mediaVersion === 'old' ? image : Buffer.concat([image, Buffer.from('new')]))
        return
      }
      if (
        /^\/api\/v1\/books\/[^/]+$/.test(path) &&
        !path.endsWith('/list') &&
        !path.endsWith('/ondeck')
      )
        return json({ ...book, id: path.split('/').at(-1) })
      if (path.endsWith('/series/57')) return json(series)
      if (path.endsWith('/sse')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.end()
        return
      }
      if (path.includes('/thumbnail')) {
        res.setHeader('Content-Type', 'image/jpeg')
        res.end(await readFile(resolve(root, 'next-ui/src/assets/mock-thumbnail.jpg')))
        return
      }
      if (path.endsWith('/list') || path.endsWith('/ondeck') || path.endsWith('/updated'))
        return json({
          content: [],
          totalElements: 0,
          totalPages: 0,
          last: true,
          first: true,
          number: 0,
          size: 50,
        })
      return json([])
    }
    const classic = path.startsWith('/classic')
    const isAsset = !!extname(path)
    let content
    if (path === '/service-worker.js')
      content = await readFile(resolve(root, 'komga-webui/public/service-worker.js'))
    else if (isAsset) {
      try {
        content = await readFile(resolve(root, 'next-ui/dist', path.slice(1)))
      } catch {
        content = await readFile(resolve(root, 'komga-webui/dist', path.slice(1)))
      }
    } else
      content = await readFile(
        resolve(root, classic ? 'komga-webui/dist/index.html' : 'next-ui/dist/index.html'),
      )
    // Match Gradle + Thymeleaf: HTML asset URLs are rendered from the resource base.
    if (!isAsset)
      content = Buffer.from(
        content.toString().replace(/(src|href)="((?:js|css|assets)\/[^"]+)"/g, '$1="/$2"'),
      )
    res.setHeader(
      'Content-Type',
      mime[extname(path)] || (isAsset ? 'application/octet-stream' : 'text/html'),
    )
    res.setHeader('Cache-Control', 'no-store')
    res.end(content)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const profile = await mkdtemp(resolve(tmpdir(), 'komga-offline-production-'))
let context
const contexts = []
const status = (page) =>
  page.evaluate(async () => {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('worker readiness timeout')), 5000),
      ),
    ])
    return new Promise((resolve) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = (e) => {
        channel.port1.close()
        resolve(e.data)
      }
      registration.active.postMessage({ type: 'KOMGA_OFFLINE_STATUS' }, [channel.port2])
    })
  })
const waitFor = async (predicate, message, timeout = 45000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(message)
}
try {
  await test('prepare both production app shells and restore a session before navigation', async () => {
    context = await chromium.launchPersistentContext(profile, { headless: true })
    contexts.push(context)
    const page = await context.newPage()
    page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
    await page.goto(base + '/downloads')
    console.log('Loaded', page.url(), (await page.locator('body').innerText()).slice(0, 500))
    await page.getByText('Books saved on this device for offline reading').waitFor()
    await waitFor(async () => {
      const s = await status(page)
      if (s.precache?.done === s.precache?.expected && !s.shellReady) {
        console.log('INCOMPLETE', JSON.stringify(s))
        console.log(
          'MISSING',
          await page.evaluate(async () => {
            const c = await caches.open('komga-shell-v3')
            const r = await c.match('/__komga_offline_status__')
            const s = r && (await r.json())
            return (
              s &&
              Promise.all(s.assets.map(async (a) => ((await c.match(a)) ? null : a))).then((xs) =>
                xs.filter(Boolean),
              )
            )
          }),
        )
        throw new Error('Incomplete shell')
      }
      return s.shellReady
    }, 'Both app shells did not become ready')
    await page.evaluate(async (bookId) => {
      const store = document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
      await store.downloadBook(bookId)
    }, book.id)
    await waitFor(
      async () =>
        page.evaluate(
          (bookId) =>
            document
              .querySelector('#app')
              .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
              .getDownload(bookId)?.status === 'downloaded',
          book.id,
        ),
      'Real book download did not finish',
    )
    await context.close()
  })
  await test('cold process offline: Downloads, book detail, unavailable content, classic handoff', async () => {
    context = await chromium.launchPersistentContext(profile, { headless: true })
    networkDown = true
    await context.setOffline(true)
    contexts.push(context)
    let page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    const logs = []
    page.on('console', (msg) => {
      if (['error', 'warning'].includes(msg.type())) logs.push(msg.text())
    })
    await page.goto(base + '/downloads')
    await page.getByText('Books saved on this device for offline reading').waitFor()
    assert.match(await page.locator('body').innerText(), /You are offline/)
    assert.equal((await status(page)).shellReady, true)
    await page.goto(base + '/book/offline-book')
    await page.getByText(book.metadata.title, { exact: true }).first().waitFor()
    await page.goto(base + '/book/not-cached')
    await page.getByText('Unavailable offline', { exact: true }).waitFor()
    await page.goto(base + '/history')
    await page.getByText('Unavailable offline', { exact: true }).waitFor()
    const classic = await page.goto(base + '/classic/book/offline-book/read?source=nextui')
    assert.match(await classic.text(), /js\/app\./)
    await waitFor(
      async () => (await page.title()).includes(book.metadata.title),
      'Classic reader did not render offline',
      8000,
    ).catch(async (error) => {
      console.log(
        'READER FAILURE',
        page.url(),
        await page.locator('body').innerText(),
        JSON.stringify(errors),
        JSON.stringify(logs),
      )
      throw error
    })
    await waitFor(
      async () =>
        page
          .locator('img')
          .evaluateAll((imgs) =>
            imgs.some((img) => img.src.includes('/pages/') && img.naturalWidth > 0),
          ),
      'Downloaded page image did not render',
    )
    assert.match(page.url(), /\/classic\/book\//)
    await page.reload()
    await waitFor(
      async () =>
        page
          .locator('img')
          .evaluateAll((imgs) =>
            imgs.some((img) => img.src.includes('/pages/') && img.naturalWidth > 0),
          ),
      'Reader reload lost its classic shell',
    )
    assert.equal(errors.length, 0, errors.join('\n'))
    await page.goto(base + '/classic/book/offline-book/read-epub?source=nextui')
    await page.getByText('Unavailable offline', { exact: true }).waitFor()
    await page.goto(base + '/classic/book/offline-book/read?source=nextui')
    await page.evaluate(async () => {
      const cacheName = await new Promise((resolve) => {
        const r = indexedDB.open('komga-offline')
        r.onsuccess = () => {
          const db = r.result
          const req = db
            .transaction('downloads', 'readonly')
            .objectStore('downloads')
            .get('offline-book')
          req.onsuccess = () => {
            db.close()
            resolve(req.result.cacheName)
          }
        }
      })
      const cache = await caches.open(cacheName)
      for (const request of await cache.keys())
        if (new URL(request.url).pathname.endsWith('/pages/1')) await cache.delete(request)
    })
    await context.close()
    context = await chromium.launchPersistentContext(profile, { headless: true })
    contexts.push(context)
    networkDown = true
    await context.setOffline(true)
    page = await context.newPage()
    await page.goto(base + '/classic/book/offline-book/read?source=nextui&page=1')
    await page
      .getByText(/Page 1 is unavailable/)
      .waitFor({ timeout: 5000 })
      .catch(async (error) => {
        console.log(
          'MISSING PAGE STATE',
          await page.locator('body').innerText(),
          await page
            .locator('img')
            .evaluateAll((imgs) => imgs.map((i) => ({ src: i.src, width: i.naturalWidth }))),
          await page.evaluate(() =>
            fetch('/api/v1/books/offline-book/pages/1').then((r) => r.status),
          ),
        )
        throw error
      })
    console.log('Offline routes, classic reader, reload and missing-page recovery verified')
  })
  await test('download requests bypass old cached media; failed assets never report ready', async () => {
    networkDown = false
    await context.setOffline(false)
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(base + '/downloads')
    await page.getByText('Books saved on this device for offline reading').waitFor()
    await page.evaluate(
      async (image) => {
        const db = await new Promise((resolve) => {
          const r = indexedDB.open('komga-offline')
          r.onsuccess = () => resolve(r.result)
        })
        const record = await new Promise((resolve) => {
          const r = db
            .transaction('downloads', 'readonly')
            .objectStore('downloads')
            .get('offline-book')
          r.onsuccess = () => resolve(r.result)
        })
        db.close()
        const cache = await caches.open(record.cacheName)
        await cache.put(
          '/api/v1/books/offline-book/pages/1',
          new Response(new Uint8Array(image), { headers: { 'Content-Type': 'image/jpeg' } }),
        )
      },
      [...image],
    )
    mediaVersion = 'new'
    const values = await page.evaluate(async () => ({
      reader: await fetch('/api/v1/books/offline-book/pages/1')
        .then((r) => r.arrayBuffer())
        .then((b) => b.byteLength),
      download: await fetch('/api/v1/books/offline-book/pages/1', {
        headers: { 'X-Komga-Download': 'network' },
      })
        .then((r) => r.arrayBuffer())
        .then((b) => b.byteLength),
    }))
    assert.deepEqual(values, { reader: image.length, download: image.length + 3 })
    pages[0].fileName = 'updated-page.jpg'
    await page.evaluate(async (bookId) => {
      const store = document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
      await store.downloadBook(bookId)
    }, book.id)
    await waitFor(
      async () =>
        page.evaluate(
          (bookId) =>
            document
              .querySelector('#app')
              .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
              .getDownload(bookId)?.status === 'downloaded',
          book.id,
        ),
      'Updated download did not commit',
    )
    assert.equal(
      await page.evaluate(() =>
        fetch('/api/v1/books/offline-book/pages/1')
          .then((r) => r.arrayBuffer())
          .then((b) => b.byteLength),
      ),
      image.length + 3,
    )

    const manifest = JSON.parse(
      await readFile(resolve(root, 'next-ui/dist/nextui-shell.json'), 'utf8'),
    )
    failAsset = '/' + manifest.files.find((f) => f.url.endsWith('.js')).url
    await page.evaluate(async (path) => {
      const c = await caches.open('komga-shell-v3')
      await c.delete(path)
      navigator.serviceWorker.controller.postMessage({
        type: 'KOMGA_PREPARE_OFFLINE_SHELL',
        pageUrl: location.href,
        assets: [],
        batchId: 'failed-test',
      })
    }, failAsset)
    await waitFor(async () => {
      const s = await status(page)
      return s.precache?.batchId === 'failed-test' && s.precache.done === s.precache.expected
    }, 'Failure batch did not complete')
    const s = await status(page)
    assert.equal(s.shellReady, false)
    assert.ok(s.precache.failed > 0)
    failAsset = ''
    await page.evaluate(() =>
      navigator.serviceWorker.controller.postMessage({
        type: 'KOMGA_PREPARE_OFFLINE_SHELL',
        pageUrl: location.href,
        assets: [],
        batchId: 'retry-test',
      }),
    )
    await waitFor(async () => (await status(page)).shellReady, 'Retry did not repair cache')
    unavailable = true
    await page.goto(base + '/downloads')
    await page.getByText('Books saved on this device for offline reading').waitFor()
    unavailable = false
  })
  await test('Wi-Fi connected with a hanging server still opens the saved app', async () => {
    const page = await context.newPage()
    unavailable = 'hang'
    const start = Date.now()
    await page.goto(base + '/downloads', { timeout: 25000 })
    await page
      .getByText('Books saved on this device for offline reading')
      .waitFor({ timeout: 15000 })
    assert.ok(Date.now() - start < 25000, 'Unreachable server must not hang indefinitely')
    assert.equal(await page.evaluate(() => navigator.onLine), true)
    unavailable = false
    await page.close()
  })
  await test('unsupported EPUB downloads are rejected before queuing', async () => {
    const page = await context.newPage()
    await page.goto(base + '/downloads')
    await page.getByText('Books saved on this device for offline reading').waitFor()
    const error = await page.evaluate(async (book) => {
      const store = document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
      try {
        await store.downloadBooks(
          [
            {
              ...book,
              id: 'unsupported-epub',
              media: { ...book.media, mediaProfile: 'EPUB', epubDivinaCompatible: false },
            },
          ],
          '57',
        )
      } catch (error) {
        return error.message
      }
    }, book)
    assert.match(error, /EPUB.*connection/)
  })
  await test('offline Downloads fits a phone viewport', async () => {
    const page = await context.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    networkDown = true
    await context.setOffline(true)
    await page.goto(base + '/downloads')
    await page.getByText('Books saved on this device for offline reading').waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await page.evaluate(() => {document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('app').drawer = false})
    await page.screenshot({ path: '/tmp/komga-offline-mobile.png' })
    networkDown = false
    await context.setOffline(false)
    await page.close()
  })
  await test('a delayed catalog response cannot populate the next account', async () => {
    const page = await context.newPage()
    await page.goto(base + '/downloads')
    await page.getByText('Books saved on this device for offline reading').waitFor()
    for (const other of context.pages()) if (other !== page) await other.close()
    await waitFor(
      () =>
        page.evaluate(
          () =>
            !document
              .querySelector('#app')
              .__vue_app__.config.globalProperties.$pinia._s.get('offline-library').syncingMetadata,
        ),
      'Initial catalog did not finish',
    )
    try {
      holdCatalog = true
      await page.evaluate(() => {
        const store = document
          .querySelector('#app')
          .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
        window.pendingCatalog = store.syncCatalogMetadata().catch((error) => error.message)
      })
      await waitFor(() => !!pendingCatalogResponse, 'Delayed request was not started')
      await page.evaluate(
        async (user) =>
          document
            .querySelector('#app')
            .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
            .activateAccount({ ...user, id: 'second-user' }),
        user,
      )
      holdCatalog = false
      pendingCatalogResponse()
      pendingCatalogResponse = undefined
      const result = await page.evaluate(() => window.pendingCatalog)
      assert.match(result, /account changed/)
      assert.equal(
        await page.evaluate(() =>
          document
            .querySelector('#app')
            .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
            .getCachedBook('offline-book')
            .then(Boolean),
        ),
        false,
      )
    } finally {
      holdCatalog = false
      pendingCatalogResponse?.()
      pendingCatalogResponse = undefined
      await page.close()
    }
  })
  await test('accounts retain separate downloads; revoked sessions never restore offline', async () => {
    const page = await context.newPage()
    const originalId = user.id
    user.id = 'second-user'
    await page.goto(base + '/downloads')
    await page.getByText('No offline books yet', { exact: true }).waitFor()
    const media = await page.evaluate(() =>
      fetch('/api/v1/books/offline-book/pages/1')
        .then((r) => r.arrayBuffer())
        .then((b) => b.byteLength),
    )
    assert.equal(media, image.length + 3) // network response, no access to the first account's cache
    user.id = originalId
    await page.reload()
    await page.getByText('Super Duck', { exact: true }).first().waitFor()
    for (const other of context.pages()) if (other !== page) await other.close()
    await page.evaluate(() => {document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('app').drawer = true})
    await page.getByText('Logout', { exact: true }).click()
    await page.getByLabel('Email', { exact: true }).waitFor()
    networkDown = true
    await context.setOffline(true)
    await page.goto(base + '/downloads')
    await page.getByText('Connect to get started', { exact: true }).waitFor()
    assert.equal(
      await page.evaluate(() => fetch('/api/v1/books/offline-book/pages/1').then((r) => r.status)),
      503,
    )
  })
} finally {
  await Promise.all(contexts.map((c) => c.close()))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(profile, { recursive: true, force: true })
}
