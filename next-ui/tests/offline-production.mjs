// Production regression: actual built bundles + shared worker, with the browser
// process restarted and its network disabled. Run npm run test:offline after builds.
import { test } from 'node:test'
import { createHash } from 'node:crypto'
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
const catalogBooks = [
  book,
  ...Array.from({ length: 200 }, (_, i) => ({
    ...book,
    id: `catalog-${i}`,
    name: `Catalog ${i}`,
    metadata: { ...book.metadata, title: `Catalog only book ${i}` },
  })),
]
const catalogRequests = []
const deltaRequests = []
const manifestStatuses = []
const shellRequests = []
let failDelta = false
let shellPatch = ''
let seriesRemoved = false
const revision = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
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
  if (path.endsWith('.js') || path.endsWith('.css') || ['/next/', '/classic/'].includes(path))
    shellRequests.push(path)
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
      if (path === '/api/v1/offline/catalog') {
        const manifest = {
          books: Object.fromEntries(catalogBooks.map((item) => [item.id, revision(item)])),
          series: seriesRemoved ? {} : { [series.id]: revision(series) },
        }
        if (holdCatalog) {
          pendingCatalogResponse = () => json(manifest)
          return
        }
        const etag = '"' + revision(manifest) + '"'
        res.setHeader('ETag', etag)
        if (req.headers['if-none-match'] === etag) {
          manifestStatuses.push(304)
          res.writeHead(304)
          res.end()
          return
        }
        manifestStatuses.push(200)
        return json(manifest)
      }
      if (/^\/api\/v1\/offline\/catalog\/(books|series)$/.test(path)) {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const ids = JSON.parse(Buffer.concat(chunks).toString())
        deltaRequests.push({ path, ids })
        if (failDelta === true || (failDelta === 'last-batch' && ids.length === 1)) {
          res.writeHead(503)
          res.end()
          return
        }
        const source = path.endsWith('/books') ? catalogBooks : [series]
        return json(source.filter((item) => ids.includes(item.id)))
      }
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
        await new Promise((resolve) => setTimeout(resolve, 150))
        if (!authorized) {
          res.writeHead(401)
          res.end()
          return
        }
        return json(user)
      }
      if (path.endsWith('/libraries'))
        return json([
          { id: '1', name: 'Comics' },
          { id: '2', name: 'Other library' },
        ])
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
      if (path === '/api/v1/books/list' || path === '/api/v1/series/list') {
        const query = new URL(req.url, 'http://localhost').searchParams
        if (query.get('unpaged') === 'true') {
          res.writeHead(503)
          res.end()
          return
        }
        const number = Number(query.get('page') || 0),
          size = Number(query.get('size') || 50)
        const items = path.includes('/books/') ? catalogBooks : [series]
        catalogRequests.push({ path, number, size })
        return json({
          content: items.slice(number * size, (number + 1) * size),
          totalElements: items.length,
          totalPages: Math.ceil(items.length / size),
          last: (number + 1) * size >= items.length,
          first: number === 0,
          number,
          size,
        })
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
    if (path === '/nextui-shell.json' && shellPatch) {
      const manifest = JSON.parse(content.toString())
      manifest.revision = revision([manifest.revision, shellPatch])
      const layer = manifest.files.find((file) => file.url === 'layers.css')
      layer.sha256 = createHash('sha256')
        .update(await readFile(resolve(root, 'next-ui/dist/layers.css')))
        .update(shellPatch)
        .digest('hex')
      content = Buffer.from(JSON.stringify(manifest))
    }
    if (path === '/layers.css' && shellPatch)
      content = Buffer.concat([content, Buffer.from(shellPatch)])
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
      if (s.precache?.settled && s.precache.done === s.precache.expected && !s.shellReady) {
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
    await waitFor(
      () =>
        page.evaluate(
          () =>
            !!document
              .querySelector('#app')
              .__vue_app__.config.globalProperties.$pinia._s.get('offline-library').catalogSyncedAt,
        ),
      'Automatic full catalog sync never completed after authentication',
    )
    assert.ok(
      deltaRequests.some((r) => r.path.endsWith('/books') && r.ids.length === 200) &&
        deltaRequests.some((r) => r.path.endsWith('/books') && r.ids.length === 1),
    )
    assert.equal(
      await page.evaluate(
        () =>
          document
            .querySelector('#app')
            .__vue_app__.config.globalProperties.$pinia._s.get('offline-library').cachedBooks,
      ),
      201,
    )
    await context.close()
  })
  await test('unchanged shells do no setup downloads; new revisions and evicted assets repair only changed files', async () => {
    context = await chromium.launchPersistentContext(profile, { headless: true })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(base + '/downloads')
    await page.getByText('Books saved on this device for offline reading').waitFor()
    const before = await status(page)
    const prepare = async (batchId) => {
      await page.evaluate(async (batchId) => {
        const worker = (await navigator.serviceWorker.ready).active
        worker.postMessage({
          type: 'KOMGA_PREPARE_OFFLINE_SHELL',
          batchId,
          pageUrl: location.href,
          assets: [],
        })
      }, batchId)
      await waitFor(
        async () =>
          (await status(page)).precache?.batchId === batchId &&
          (await status(page)).precache?.settled,
        'Shell check did not finish',
      )
    }
    shellRequests.length = 0
    await prepare('same-shell')
    assert.equal((await status(page)).revision, before.revision)
    assert.deepEqual(shellRequests, [], 'An unchanged shell must not fetch HTML or assets again')
    shellPatch = '/* changed offline shell */'
    await prepare('changed-shell')
    assert.notEqual((await status(page)).revision, before.revision)
    assert.equal(shellRequests.filter((url) => url === '/layers.css').length, 1)
    assert.equal(shellRequests.filter((url) => url.endsWith('.js')).length, 0)
    assert.ok(
      await page.evaluate(async () =>
        (await (await caches.open('komga-shell-v3')).match('/layers.css'))
          .text()
          .then((text) => text.includes('changed offline shell')),
      ),
    )
    shellPatch = ''
    await prepare('restored-shell')
    const missing = await page.evaluate(async () => {
      const cache = await caches.open('komga-shell-v3')
      const key = (await cache.keys()).find((key) => /assets\/index-[^/]+\.js$/.test(key.url))
      await cache.delete(key)
      return new URL(key.url).pathname
    })
    shellRequests.length = 0
    await prepare('repaired-shell')
    assert.equal((await status(page)).shellReady, true)
    assert.deepEqual(
      shellRequests.filter((url) => url.endsWith('.js')),
      [missing],
    )
    await context.close()
  })
  await test('catalog sync transfers only changes, removes deletions, repairs missing rows and retries interruptions', async () => {
    context = await chromium.launchPersistentContext(profile, { headless: true })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(base + '/downloads')
    await page.getByText('Books saved on this device for offline reading').waitFor()
    await waitFor(
      () =>
        page.evaluate(
          () =>
            !document
              .querySelector('#app')
              .__vue_app__.config.globalProperties.$pinia._s.get('offline-library').syncingMetadata,
        ),
      'Catalog check did not finish',
    )
    const sync = () =>
      page.evaluate(() =>
        document
          .querySelector('#app')
          .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
          .syncCatalogMetadata(),
      )
    const original = [...catalogBooks]
    try {
      deltaRequests.length = 0
      await sync()
      assert.equal(manifestStatuses.at(-1), 304)
      assert.deepEqual(deltaRequests, [])
      const changed = catalogBooks.findIndex((item) => item.id === 'catalog-10')
      catalogBooks[changed] = {
        ...catalogBooks[changed],
        metadata: { ...catalogBooks[changed].metadata, title: 'Changed offline title' },
        readProgress: { completed: true, page: 2 },
      }
      catalogBooks.splice(
        catalogBooks.findIndex((item) => item.id === 'catalog-11'),
        1,
      )
      catalogBooks.push({ ...book, id: 'delta-added' })
      await sync()
      assert.deepEqual(deltaRequests.flatMap((request) => request.ids).sort(), [
        'catalog-10',
        'delta-added',
      ])
      assert.equal(
        await page.evaluate(async () => {
          const store = document
            .querySelector('#app')
            .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
          return (
            !(await store.getCachedBook('catalog-11')) &&
            (await store.getCachedBook('catalog-10')).metadata.title === 'Changed offline title' &&
            !!(await store.getCachedBook('delta-added'))
          )
        }),
        true,
      )
      const checkpoint = await page.evaluate(
        () =>
          document
            .querySelector('#app')
            .__vue_app__.config.globalProperties.$pinia._s.get('offline-library').catalogSyncedAt,
      )
      catalogBooks[changed] = { ...catalogBooks[changed], name: 'Changed again' }
      failDelta = true
      await assert.rejects(sync(), /503/)
      assert.equal(
        await page.evaluate(
          () =>
            document
              .querySelector('#app')
              .__vue_app__.config.globalProperties.$pinia._s.get('offline-library').catalogSyncedAt,
        ),
        checkpoint,
      )
      failDelta = false
      deltaRequests.length = 0
      await sync()
      assert.deepEqual(
        deltaRequests.flatMap((request) => request.ids),
        ['catalog-10'],
      )
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open('komga-offline')
            request.onsuccess = () => {
              const db = request.result
              const tx = db.transaction('books', 'readwrite')
              tx.objectStore('books').delete('catalog-199')
              tx.oncomplete = () => {
                db.close()
                resolve()
              }
              tx.onerror = () => reject(tx.error)
            }
          }),
      )
      deltaRequests.length = 0
      await sync()
      assert.equal(manifestStatuses.at(-1), 304)
      assert.deepEqual(
        deltaRequests.flatMap((request) => request.ids),
        ['catalog-199'],
      )
      catalogBooks.splice(
        0,
        catalogBooks.length,
        ...catalogBooks.map((item) => ({ ...item, name: item.name + ' batch changed' })),
      )
      failDelta = 'last-batch'
      deltaRequests.length = 0
      await assert.rejects(sync(), /503/)
      assert.equal(deltaRequests[0].ids.length, 200)
      const failedIds = deltaRequests.at(-1).ids
      failDelta = false
      deltaRequests.length = 0
      await sync()
      assert.deepEqual(
        deltaRequests.flatMap((request) => request.ids),
        failedIds,
        'A retry should not fetch the already saved first batch again',
      )
      seriesRemoved = true
      catalogBooks.splice(0)
      await sync()
      assert.equal(
        await page.evaluate(async () => {
          const store = document
            .querySelector('#app')
            .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
          return (
            (await store.getCachedBooksPage()).totalElements === 0 &&
            (await store.getCachedSeriesPage()).totalElements === 0 &&
            store.getDownload('offline-book').sourceMissing
          )
        }),
        true,
      )
      networkDown = true
      await context.setOffline(true)
      await page.goto(base + '/classic/book/offline-book/read?source=nextui')
      await waitFor(
        () =>
          page
            .locator('img')
            .evaluateAll((imgs) =>
              imgs.some((img) => img.src.includes('/pages/') && img.naturalWidth > 0),
            ),
        'A downloaded book must remain readable after its series is deleted',
      )
      networkDown = false
      await context.setOffline(false)
      await page.goto(base + '/downloads')
      await page.getByText('Books saved on this device for offline reading').waitFor()
    } finally {
      failDelta = false
      seriesRemoved = false
      networkDown = false
      await context.setOffline(false)
      catalogBooks.splice(0, catalogBooks.length, ...original)
      await sync()
      await context.close()
    }
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
    await page.goto(base + '/book/catalog-199')
    await page.getByText('Catalog only book 199', { exact: true }).first().waitFor()
    await page.goto(base + '/libraries/all/books')
    await page
      .getByText('1 - Catalog only book 0', { exact: true })
      .first()
      .waitFor({ timeout: 5000 })
      .catch(async (error) => {
        console.log(
          'CATALOG LIST FAILURE',
          page.url(),
          await page.locator('body').innerText(),
          JSON.stringify(errors),
        )
        throw error
      })
    assert.match(page.url(), /\/libraries\/all\/books/)
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
    assert.equal(
      await page.getByRole('link', { name: 'Open Downloads', exact: true }).getAttribute('href'),
      '/next/downloads',
    )
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
  await test('offline boot survives failed non-critical assets', async () => {
    networkDown = false
    await context.setOffline(false)
    const page = await context.newPage()
    await page.goto(base + '/downloads')
    await page.getByText('Books saved on this device for offline reading').waitFor()
    await waitFor(async () => (await status(page)).shellReady, 'Shell never became ready')
    // Offline cold boot works before anything is evicted.
    await context.setOffline(true)
    await page.goto(base + '/downloads')
    await page.getByText('Books saved on this device for offline reading').waitFor()
    await context.setOffline(false)
    // Evict one non-critical icon, every committed shell, and every cached
    // navigation, so only the next preparation can restore offline boot:
    // without the fix the failed batch commits nothing and the app falls
    // through to the "unavailable offline" text.
    const victim = '/maskable_icon.png'
    const evicted = await page.evaluate(async (path) => {
      const cache = await caches.open('komga-shell-v3')
      const keys = await cache.keys()
      const exact = [
        location.href,
        location.origin + '/',
        location.origin + '/next/',
        location.origin + '/classic/',
      ]
      const doomed = keys.filter(
        (request) =>
          request.url.endsWith(path) ||
          request.url.includes('__komga_offline_shell__') ||
          exact.includes(request.url),
      )
      await Promise.all(doomed.map((request) => cache.delete(request)))
      return doomed.length
    }, victim)
    assert.ok(evicted > 0, 'eviction removed nothing, test setup is broken')
    failAsset = victim
    await page.evaluate(
      (batchId) =>
        navigator.serviceWorker.controller.postMessage({
          type: 'KOMGA_PREPARE_OFFLINE_SHELL',
          pageUrl: location.href,
          assets: [],
          batchId,
        }),
      'boot-survives-failure',
    )
    await waitFor(async () => {
      const s = await status(page)
      return s.precache?.batchId === 'boot-survives-failure' && s.precache.settled === true
    }, 'Failure batch did not settle')
    const afterFailure = await status(page)
    assert.equal(afterFailure.shellReady, false)
    assert.ok(afterFailure.precache.failed > 0)
    const shells = await page.evaluate(async () => {
      const cache = await caches.open('komga-shell-v3')
      return Promise.all(
        ['', '-next', '-classic'].map(async (suffix) => {
          const key = `${location.origin}/__komga_offline_shell__${suffix}`
          return Boolean(await cache.match(key))
        }),
      )
    })
    assert.deepEqual(shells, [true, true, true])
    await context.setOffline(true)
    await page.goto(base + '/downloads')
    const body = await page.locator('body').innerText()
    assert.ok(
      !body.includes('unavailable offline'),
      'Offline boot fell through to the unavailable page',
    )
    await page.getByText('Books saved on this device for offline reading').waitFor()
    await context.setOffline(false)
    // Heal for the suites that follow: the icon downloads fine again.
    failAsset = ''
    await page.evaluate(
      (batchId) =>
        navigator.serviceWorker.controller.postMessage({
          type: 'KOMGA_PREPARE_OFFLINE_SHELL',
          pageUrl: location.href,
          assets: [],
          batchId,
        }),
      'boot-survives-retry',
    )
    await waitFor(async () => (await status(page)).shellReady, 'Retry did not repair cache')
    await page.close()
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
    await page.evaluate(() => {
      document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('app').drawer = false
    })
    await page.waitForFunction(() => {
      const drawer = document.querySelector('.v-navigation-drawer')
      return !drawer || drawer.getBoundingClientRect().right <= 1
    })
    await page.screenshot({ path: '/tmp/komga-offline-mobile.png', animations: 'disabled' })
    networkDown = false
    await context.setOffline(false)
    await page.close()
  })
  await test('downloaded book and series cards retain reading status', async () => {
    const originalProgress = book.readProgress
    const originalSeries = { ...series }
    const page = await context.newPage()
    try {
      book.readProgress = { page: 2, completed: true }
      await page.goto(base + '/libraries/all/books')
      const card = page
        .locator('.v-card')
        .filter({
          has: page.getByRole('link', { name: '1 - ' + book.metadata.title, exact: true }),
        })
        .first()
      await card.getByRole('img', { name: 'Read', exact: true }).waitFor()
      await card.getByRole('img', { name: 'Available offline', exact: true }).waitFor()
      await page.evaluate((bookId) => {
        document
          .querySelector('#app')
          .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
          .getDownload(bookId).updateAvailable = true
      }, book.id)
      await card.getByRole('img', { name: 'Downloaded; update available', exact: true }).waitFor()
      await card.getByRole('img', { name: 'Read', exact: true }).waitFor()
      await page.evaluate((bookId) => {
        document
          .querySelector('#app')
          .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
          .getDownload(bookId).updateAvailable = false
      }, book.id)

      await page.goto(base + '/libraries/all/series')
      const seriesCard = page
        .locator('.v-card')
        .filter({
          has: page.getByRole('link', { name: series.metadata.title, exact: true }),
        })
        .first()
      await seriesCard.getByRole('img', { name: 'Available offline', exact: true }).waitFor()
      await seriesCard.getByText('4', { exact: true }).waitFor()
      Object.assign(series, {
        booksReadCount: series.booksCount,
        booksUnreadCount: 0,
        booksInProgressCount: 0,
      })
      await page.reload()
      await seriesCard.getByRole('img', { name: 'Read', exact: true }).waitFor()
      await seriesCard.getByRole('img', { name: 'Available offline', exact: true }).waitFor()
    } finally {
      book.readProgress = originalProgress
      Object.assign(series, originalSeries)
      await page.close()
    }
  })
  await test('home covers already shown before enabling caching survive an offline cold start', async () => {
    await context.close()
    context = await chromium.launchPersistentContext(profile, { headless: true })
    contexts.push(context)
    let page = await context.newPage()
    await page.goto(base + '/libraries/all/overview')
    const coverSelector =
      'img.v-img__img:not(.v-img__img--preload)[src*="/books/catalog-0/thumbnail"]'
    await page.getByText('Keep Reading', { exact: true }).first().waitFor()
    await waitFor(
      () =>
        page
          .locator(coverSelector)
          .first()
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      'Home cover did not load online',
    )
    await page.evaluate(() =>
      document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/downloads'),
    )
    await page.getByText('Books saved on this device for offline reading').waitFor()
    await page.evaluate(async () => {
      const app = document.querySelector('#app').__vue_app__
      await app.config.globalProperties.$pinia._s
        .get('offline-library')
        .setDownloadPreferences({ cacheCovers: true })
      await app.config.globalProperties.$router.push('/libraries/all/overview')
    })
    await page.getByText('Keep Reading', { exact: true }).first().waitFor()
    await waitFor(
      async () =>
        page.evaluate(async () => {
          const names = (await caches.keys()).filter((n) => n.startsWith('komga-offline-covers-'))
          for (const name of names) {
            if (await (await caches.open(name)).match('/api/v1/books/catalog-0/thumbnail'))
              return true
          }
          return false
        }),
      'A cover already loaded on Home was never saved after enabling cover caching',
      10000,
    )
    const seriesCover = 'img.v-img__img:not(.v-img__img--preload)[src*="/series/57/thumbnail"]'
    await page.getByText('Recently Added Series', { exact: true }).first().scrollIntoViewIfNeeded()
    await waitFor(
      () =>
        page
          .locator(seriesCover)
          .first()
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      'A series cover did not load on Home',
    )
    await waitFor(
      async () =>
        page.evaluate(async () => {
          const names = (await caches.keys()).filter((n) => n.startsWith('komga-offline-covers-'))
          for (const name of names) {
            if (await (await caches.open(name)).match('/api/v1/series/57/thumbnail')) return true
          }
          return false
        }),
      'A series cover shown on Home was never saved',
      10000,
    )
    assert.equal(
      await page.evaluate(async () => {
        const names = (await caches.keys()).filter((n) => n.startsWith('komga-offline-covers-'))
        for (const name of names) {
          if (await (await caches.open(name)).match('/api/v1/books/catalog-199/thumbnail'))
            return true
        }
        return false
      }),
      false,
      'An unbrowsed catalog cover should not be downloaded',
    )
    await context.close()
    context = await chromium.launchPersistentContext(profile, { headless: true })
    contexts.push(context)
    networkDown = true
    await context.setOffline(true)
    page = await context.newPage()
    await page.goto(base + '/libraries/all/overview')
    await page.getByText('Keep Reading', { exact: true }).first().waitFor()
    await waitFor(
      () =>
        page
          .locator(coverSelector)
          .first()
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      'Home cover did not survive an offline cold start',
      10000,
    )
    await page.getByText('Recently Added Series', { exact: true }).first().scrollIntoViewIfNeeded()
    await waitFor(
      () =>
        page
          .locator(seriesCover)
          .first()
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      'Home series cover did not survive an offline cold start',
      10000,
    )
    await page.evaluate(() =>
      document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
        .setDownloadPreferences({ cacheCovers: false }),
    )
    networkDown = false
    await context.setOffline(false)
    await page.close()
  })
  await test('cover caching is optional and account-local', async () => {
    const page = await context.newPage()
    await page.goto(base + '/downloads')
    await page.getByText('Books saved on this device for offline reading').waitFor()
    const result = await page.evaluate(async () => {
      const store = document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
      const defaultValue = store.preferences.cacheCovers
      await fetch('/api/v1/series/57/thumbnail?off-test=1')
      const before = (await caches.keys()).filter((n) => n.startsWith('komga-offline-covers-'))
      await store.setDownloadPreferences({ cacheCovers: true })
      await fetch('/api/v1/series/57/thumbnail?on-test=1')
      await fetch('/api/v1/books/catalog-199/thumbnail')
      return { defaultValue, before }
    })
    assert.equal(result.defaultValue, false)
    assert.equal(result.before.length, 0)
    networkDown = true
    await context.setOffline(true)
    assert.equal(
      await page.evaluate(() => fetch('/api/v1/series/57/thumbnail').then((r) => r.status)),
      200,
    )
    assert.equal(
      await page.evaluate(() => fetch('/api/v1/books/catalog-199/thumbnail').then((r) => r.status)),
      200,
    )
    await page.evaluate(() =>
      document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('offline-library')
        .setDownloadPreferences({ cacheCovers: false }),
    )
    assert.equal(
      await page.evaluate(() => fetch('/api/v1/books/catalog-199/thumbnail').then((r) => r.status)),
      503,
    )
    assert.equal(
      await page.evaluate(() =>
        fetch('/api/v1/books/offline-book/thumbnail').then((r) => r.status),
      ),
      200,
    )
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
    await page.evaluate(() => {
      document
        .querySelector('#app')
        .__vue_app__.config.globalProperties.$pinia._s.get('app').drawer = true
    })
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
