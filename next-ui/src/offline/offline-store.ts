import { defineStore } from 'pinia'
import { ApiBaseUrl } from '@/api/base'
import { bookPosterUrl } from '@/api/images'
import {
  komgaGetBookById,
  komgaGetBookPages,
  komgaGetBooks,
  komgaGetSeries,
  komgaGetSeriesById,
  komgaMarkBookReadProgress,
  type BookDto,
  type BookSearch,
  type PageDto,
  type ReadProgressUpdateDto,
  type SeriesDto,
  type SeriesSearch,
} from '@/generated/openapi'
import {
  OFFLINE_STORES,
  offlineDelete,
  offlineGet,
  offlineGetAll,
  offlinePut,
  offlinePutMany,
  openOfflineDatabase,
} from './offline-db'
import { OFFLINE_BOOK_CACHE_PREFIX } from './offline-types'
import type {
  CachedPages,
  OfflineDownloadPreferences,
  OfflineDownloadRecord,
  OfflinePage,
  OfflinePageRequest,
  OfflineSetting,
  QueuedProgress,
} from './offline-types'
import { DEFAULT_DOWNLOAD_PREFERENCES } from './offline-types'
import {
  clone,
  conditionMatches,
  dateToken,
  errorMessage,
  fullTextMatches,
  manifestRevision,
  pageFromItems,
  rehydrateDates,
  remapPage,
  selectNextQueuedDownload,
  stableHash,
  summarizeDownloadGroup,
} from './offline-utils'

const DIRECTLY_SUPPORTED_PAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
]

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined'
}

function clampPreferences(preferences: OfflineDownloadPreferences): OfflineDownloadPreferences {
  return {
    ...preferences,
    concurrentBooks: Math.max(1, Math.min(6, preferences.concurrentBooks)),
    concurrentPages: Math.max(1, Math.min(4, preferences.concurrentPages)),
  }
}

/**
 * Offline library store. Faithful port of the classic
 * `OfflineLibraryService` (Vue 2 + Axios) to a Pinia setup store using the
 * generated fetch SDK.
 *
 * The IndexedDB schema is unchanged (`komga-offline`, version 1), so both UIs
 * share one on-device cache.
 */
export const useOfflineLibraryStore = defineStore('offline-library', () => {
  const initialized = ref(false)
  const offlineMode = ref(false)
  const online = ref(isBrowser() ? navigator.onLine : true)
  const syncingMetadata = ref(false)
  const syncingProgress = ref(false)
  const downloads = ref<OfflineDownloadRecord[]>([])
  const cachedBooks = ref(0)
  const cachedSeries = ref(0)
  const preferences = ref<OfflineDownloadPreferences>({ ...DEFAULT_DOWNLOAD_PREFERENCES })

  const activeJobs = new Map<string, AbortController>()
  const cancelledJobs = new Set<string>()
  const notifiedProgress = new Map<string, number>()
  const persistedProgressAt = new Map<string, number>()
  const syncedProgressAt = new Map<string, number>()
  const syncedProgressPercent = new Map<string, number>()
  const notificationCloseTimers = new Map<string, number>()
  const openReaderBooks = new Set<string>()
  const deferredCompletions = new Set<string>()
  let lastQueuedAt = 0
  let processingQueue = false

  function handleOnline(): void {
    online.value = true
    processQueue()
  }

  function handleOffline(): void {
    online.value = false
  }

  if (isBrowser()) {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
  }

  function notifyServiceWorker(bookId?: string): void {
    if (!isBrowser() || !('serviceWorker' in navigator)) return
    const message =
      bookId !== undefined
        ? { type: 'KOMGA_DOWNLOAD_CHANGED', bookId }
        : { type: 'KOMGA_OFFLINE_MODE', enabled: offlineMode.value }
    navigator.serviceWorker.controller?.postMessage(message)
    void navigator.serviceWorker.ready
      .then((registration) => registration.active?.postMessage(message))
      .catch(() => undefined)
  }

  function nextQueuedAt(): string {
    lastQueuedAt = Math.max(Date.now(), lastQueuedAt + 1)
    return new Date(lastQueuedAt).toISOString()
  }

  function getDownload(bookId: string): OfflineDownloadRecord | undefined {
    return downloads.value.find((x) => x.bookId === bookId)
  }

  function isDownloaded(bookId: string): boolean {
    const download = getDownload(bookId)
    return !!download?.cacheName && ['downloaded', 'updating'].includes(download.status)
  }

  async function updateDownload(record: OfflineDownloadRecord): Promise<void> {
    await offlinePut(OFFLINE_STORES.downloads, clone(record))
    const index = downloads.value.findIndex((x) => x.bookId === record.bookId)
    if (index >= 0) downloads.value.splice(index, 1, clone(record))
    else downloads.value.unshift(clone(record))
    notifyServiceWorker(record.bookId)
  }

  async function refreshState(): Promise<void> {
    const [storedDownloads, books, series] = await Promise.all([
      offlineGetAll<OfflineDownloadRecord>(OFFLINE_STORES.downloads),
      offlineGetAll<BookDto>(OFFLINE_STORES.books),
      offlineGetAll<SeriesDto>(OFFLINE_STORES.series),
    ])
    downloads.value = storedDownloads.sort((a, b) =>
      `${b.downloadedAt || ''}`.localeCompare(`${a.downloadedAt || ''}`),
    )
    cachedBooks.value = books.length
    cachedSeries.value = series.length
  }

  async function cleanupOrphanedBookCaches(): Promise<void> {
    if (!isBrowser() || !('caches' in window)) return
    const active = new Set(downloads.value.map((x) => x.cacheName).filter((x): x is string => !!x))
    const names = await caches.keys()
    await Promise.all(
      names
        .filter((name) => name.startsWith(OFFLINE_BOOK_CACHE_PREFIX) && !active.has(name))
        .map((name) => caches.delete(name)),
    )
  }

  async function recoverInterruptedDownloads(): Promise<void> {
    for (const record of downloads.value.filter(
      (x) => x.status === 'downloading' || x.status === 'updating',
    )) {
      record.status = 'queued'
      record.completedPages = 0
      record.bytes = record.cacheName ? record.bytes : 0
      record.queuedAt = new Date().toISOString()
      await updateDownload(record)
    }
  }

  async function closeLegacyDownloadNotifications(): Promise<void> {
    if (!isBrowser() || !('serviceWorker' in navigator)) return
    const registration = await navigator.serviceWorker.ready.catch(() => undefined)
    const notifications = (await registration?.getNotifications()) ?? []
    notifications
      .filter(
        (notification) =>
          notification.tag.startsWith('komga-download-') ||
          notification.tag === 'komga-download-test',
      )
      .forEach((notification) => notification.close())
  }

  async function initialize(): Promise<void> {
    await openOfflineDatabase()
    const setting = await offlineGet<OfflineSetting<boolean>>(
      OFFLINE_STORES.settings,
      'offlineMode',
    )
    const storedPreferences = await offlineGet<OfflineSetting<OfflineDownloadPreferences>>(
      OFFLINE_STORES.settings,
      'downloadPreferences',
    )
    offlineMode.value = setting?.value === true
    preferences.value = clampPreferences({
      ...DEFAULT_DOWNLOAD_PREFERENCES,
      ...(storedPreferences?.value ?? {}),
    })
    await refreshState()
    await recoverInterruptedDownloads()
    await cleanupOrphanedBookCaches()
    initialized.value = true
    notifyServiceWorker()
    processQueue()
    await closeLegacyDownloadNotifications()

    try {
      if (isBrowser() && navigator.storage?.persist) await navigator.storage.persist()
    } catch {
      // Persistence is best-effort; browser storage still works without it.
    }
  }

  const ready = initialize()

  async function whenReady(): Promise<void> {
    await ready
  }

  async function setOfflineMode(enabled: boolean): Promise<void> {
    await ready
    offlineMode.value = enabled
    await offlinePut(OFFLINE_STORES.settings, {
      key: 'offlineMode',
      value: enabled,
    })
    notifyServiceWorker()
    if (!enabled) processQueue()
  }

  async function setDownloadPreferences(
    partial: Partial<OfflineDownloadPreferences>,
  ): Promise<void> {
    await ready
    preferences.value = clampPreferences({ ...preferences.value, ...partial })
    await offlinePut(OFFLINE_STORES.settings, {
      key: 'downloadPreferences',
      value: clone(preferences.value),
    })
    processQueue()
  }

  async function cacheBook(book: BookDto): Promise<void> {
    await offlinePut(OFFLINE_STORES.books, clone(book))
    cachedBooks.value = (await offlineGetAll<BookDto>(OFFLINE_STORES.books)).length
  }

  async function cacheBooks(books: BookDto[]): Promise<void> {
    await offlinePutMany(OFFLINE_STORES.books, books.map(clone))
    cachedBooks.value = (await offlineGetAll<BookDto>(OFFLINE_STORES.books)).length
  }

  async function cacheSeriesItem(series: SeriesDto): Promise<void> {
    await offlinePut(OFFLINE_STORES.series, clone(series))
    cachedSeries.value = (await offlineGetAll<SeriesDto>(OFFLINE_STORES.series)).length
  }

  async function cacheSeries(items: SeriesDto[]): Promise<void> {
    await offlinePutMany(OFFLINE_STORES.series, items.map(clone))
    cachedSeries.value = (await offlineGetAll<SeriesDto>(OFFLINE_STORES.series)).length
  }

  async function cachePages(bookId: string, pages: PageDto[]): Promise<void> {
    await offlinePut(OFFLINE_STORES.pages, {
      bookId,
      pages: clone(pages),
      cachedAt: new Date().toISOString(),
    })
  }

  async function getCachedBook(bookId: string): Promise<BookDto | undefined> {
    // An active download is a coherent snapshot. Prefer its BookDto over newer
    // catalog metadata until that downloaded snapshot is atomically replaced.
    const download = getDownload(bookId)
    const book = download?.cacheName
      ? clone(download.book)
      : await offlineGet<BookDto>(OFFLINE_STORES.books, bookId)
    if (!book) return undefined

    const queued = await offlineGet<QueuedProgress>(OFFLINE_STORES.progress, bookId)
    if (queued?.progress.page) {
      const pagesCount = book.media?.pagesCount ?? 0
      book.readProgress = {
        ...(book.readProgress ?? {}),
        page: queued.progress.page,
        completed:
          queued.progress.completed === true ||
          (pagesCount > 0 && queued.progress.page >= pagesCount),
        readDate: queued.updatedAt,
      } as unknown as BookDto['readProgress']
    }
    return rehydrateDates(book)
  }

  async function getCachedSeries(seriesId: string): Promise<SeriesDto | undefined> {
    const series = await offlineGet<SeriesDto>(OFFLINE_STORES.series, seriesId)
    return series ? rehydrateDates(series) : undefined
  }

  async function getCachedPages(bookId: string): Promise<PageDto[] | undefined> {
    const record = await offlineGet<CachedPages>(OFFLINE_STORES.pages, bookId)
    return record?.pages ? rehydrateDates(record.pages) : undefined
  }

  async function getCachedBooksPage(
    search: BookSearch = {},
    pageRequest?: OfflinePageRequest,
  ): Promise<OfflinePage<BookDto>> {
    const books = await offlineGetAll<BookDto>(OFFLINE_STORES.books)
    const matching = books.filter(
      (book) =>
        conditionMatches(book, search.condition) && fullTextMatches(book, search.fullTextSearch),
    )
    return rehydrateDates(pageFromItems(matching, pageRequest))
  }

  async function getCachedSeriesPage(
    search: SeriesSearch = {},
    pageRequest?: OfflinePageRequest,
  ): Promise<OfflinePage<SeriesDto>> {
    const items = await offlineGetAll<SeriesDto>(OFFLINE_STORES.series)
    const matching = items.filter(
      (item) =>
        conditionMatches(item, search.condition) && fullTextMatches(item, search.fullTextSearch),
    )
    return rehydrateDates(pageFromItems(matching, pageRequest))
  }

  async function getCachedOnDeck(
    libraryIds?: string[],
    pageRequest?: OfflinePageRequest,
  ): Promise<OfflinePage<BookDto>> {
    const books = await offlineGetAll<BookDto>(OFFLINE_STORES.books)
    const matching = books.filter((book) => {
      if (libraryIds?.length && !libraryIds.includes(book.libraryId)) return false
      return !!book.readProgress && book.readProgress.completed === false
    })
    matching.sort(
      (a, b) =>
        new Date(b.readProgress?.readDate ?? 0).getTime() -
        new Date(a.readProgress?.readDate ?? 0).getTime(),
    )
    return rehydrateDates(pageFromItems(matching, pageRequest))
  }

  async function syncCatalogMetadata(): Promise<void> {
    await ready
    if (!online.value || offlineMode.value || syncingMetadata.value) return
    syncingMetadata.value = true
    try {
      const [booksPage, seriesPage] = await Promise.all([
        komgaGetBooks({ body: {}, query: { unpaged: true } }),
        komgaGetSeries({ body: {}, query: { unpaged: true } }),
      ])
      const books = booksPage.content ?? []
      const series = seriesPage.content ?? []
      await Promise.all([cacheBooks(books), cacheSeries(series)])
      await checkDownloadUpdates(books)
    } finally {
      syncingMetadata.value = false
    }
  }

  async function checkDownloadUpdates(serverBooks: BookDto[]): Promise<void> {
    const byId = new Map(serverBooks.map((book) => [book.id, book]))
    for (const record of downloads.value.filter((x) => !!x.cacheName)) {
      const serverBook = byId.get(record.bookId)
      if (!serverBook) {
        if (!record.sourceMissing) {
          record.sourceMissing = true
          await updateDownload(record)
        }
        continue
      }

      record.sourceMissing = false
      const modified = dateToken(serverBook.lastModified)
      const coarseChanged =
        modified !== (record.sourceLastModified || '') ||
        serverBook.media?.pagesCount !== record.totalPages
      if (!coarseChanged) continue

      try {
        const pages = (await komgaGetBookPages({ path: { bookId: record.bookId } })) ?? []
        const revision = manifestRevision(pages)
        if (revision === record.manifestRevision) {
          // Archive conversion or metadata/file timestamp changed, but the
          // extracted comic pages are identical. No media redownload needed.
          record.book = clone(serverBook)
          record.sourceLastModified = modified
          record.updateAvailable = false
          delete record.remoteManifestRevision
          delete record.remotePages
          await updateDownload(record)
        } else {
          record.updateAvailable = true
          record.remoteManifestRevision = revision
          record.remotePages = clone(pages)
          await updateDownload(record)
        }
      } catch {
        // Keep the current snapshot. A later catalog sync will retry the check.
      }
    }
  }

  function downloadPageUrl(bookId: string, page: PageDto): string {
    const url = `${ApiBaseUrl.noSlash}/api/v1/books/${bookId}/pages/${page.number}`
    return DIRECTLY_SUPPORTED_PAGE_TYPES.includes(page.mediaType) ? url : `${url}?convert=jpeg`
  }

  function cacheNameFor(bookId: string, revision: string): string {
    return `${OFFLINE_BOOK_CACHE_PREFIX}${stableHash(bookId)}-${revision}`
  }

  async function deliverNotification(
    title: string,
    options: NotificationOptions,
  ): Promise<boolean> {
    try {
      if (!isBrowser()) return false
      const registration =
        'serviceWorker' in navigator ? await navigator.serviceWorker.ready : undefined
      if (registration) await registration.showNotification(title, options)
      else new Notification(title, options)
      return true
    } catch {
      return false
    }
  }

  function scheduleNotificationClose(tag: string): void {
    if (!isBrowser()) return
    const previous = notificationCloseTimers.get(tag)
    if (previous) window.clearTimeout(previous)
    const timer = window.setTimeout(() => {
      void (async () => {
        const registration = await navigator.serviceWorker.ready.catch(() => undefined)
        const notifications = (await registration?.getNotifications({ tag })) ?? []
        notifications.forEach((notification) => notification.close())
        notificationCloseTimers.delete(tag)
      })()
    }, 5000)
    notificationCloseTimers.set(tag, timer)
  }

  async function persistDownloadProgress(record: OfflineDownloadRecord): Promise<boolean> {
    const now = Date.now()
    const previous = persistedProgressAt.get(record.bookId) ?? 0
    const finished = record.completedPages >= record.totalPages
    if (!finished && now - previous < 500) return false
    persistedProgressAt.set(record.bookId, now)
    await offlinePut(OFFLINE_STORES.downloads, clone(record))
    // Reactive sync is much coarser than the IndexedDB persist, and skips
    // ticks that would not visibly move the bar: the downloads page and
    // every book/series card re-render on each sync, which saturates the
    // main thread (scroll jank) during bulk downloads with high concurrency.
    const synced = syncedProgressAt.get(record.bookId) ?? 0
    const percent = Math.floor((record.completedPages / Math.max(1, record.totalPages)) * 100)
    const lastPercent = syncedProgressPercent.get(record.bookId) ?? -1
    if (!finished && (now - synced < 2000 || percent === lastPercent)) return false
    syncedProgressAt.set(record.bookId, now)
    syncedProgressPercent.set(record.bookId, percent)
    const existing = downloads.value.find((x) => x.bookId === record.bookId)
    if (existing) {
      existing.completedPages = record.completedPages
      existing.bytes = record.bytes
      existing.status = record.status
    } else {
      downloads.value.unshift(clone(record))
    }
    notifyServiceWorker(record.bookId)
    return true
  }

  async function showGroupedDownloadNotification(
    record: OfflineDownloadRecord,
    force = false,
  ): Promise<void> {
    const groupId = record.notificationGroupId ?? record.bookId
    const group = downloads.value.filter(
      (item) => (item.notificationGroupId ?? item.bookId) === groupId,
    )
    const summary = summarizeDownloadGroup(group)
    const previous = notifiedProgress.get(groupId) ?? -10
    if (!force && summary.percent < 100 && summary.percent - previous < 5) return
    notifiedProgress.set(groupId, summary.percent)
    const seriesDownload = !!record.notificationGroupId
    const title = summary.finished
      ? summary.failed > 0
        ? `${record.book.seriesTitle}: finished with errors`
        : `${record.book.seriesTitle}: download finished`
      : `Downloading ${record.book.seriesTitle}`
    const details = [
      `${summary.finished && summary.failed === 0 ? 100 : summary.percent}%`,
      `${summary.downloaded}/${group.length} books`,
      `${summary.completedPages}/${summary.totalPages} pages`,
    ]
    if (summary.active > 0) details.push(`${summary.active} active`)
    if (summary.queued > 0) details.push(`${summary.queued} queued`)
    if (summary.failed > 0) details.push(`${summary.failed} failed`)
    const tag = `komga-${seriesDownload ? 'series' : 'book'}-download-${groupId}`
    await deliverNotification(title, {
      body: details.join(' · '),
      tag,
      icon: `${ApiBaseUrl.slash}android-chrome-192x192.png`,
      badge: `${ApiBaseUrl.slash}android-chrome-192x192.png`,
      silent: !summary.finished,
    })
    if (summary.finished) notifiedProgress.delete(groupId)
    if (summary.finished && summary.failed === 0) scheduleNotificationClose(tag)
  }

  async function showDownloadNotification(record: OfflineDownloadRecord): Promise<void> {
    if (
      !preferences.value.notifyWhenComplete ||
      !isBrowser() ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    )
      return
    await showGroupedDownloadNotification(record, true)
  }

  async function showDownloadProgressNotification(
    record: OfflineDownloadRecord,
    force = false,
  ): Promise<void> {
    if (
      !preferences.value.notifyWhenComplete ||
      !isBrowser() ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    )
      return
    await showGroupedDownloadNotification(record, force)
  }

  async function performDownload(bookId: string, controller: AbortController): Promise<void> {
    const existing = getDownload(bookId)
    if (!existing) return
    const [book, pages] = await Promise.all([
      komgaGetBookById({ path: { bookId }, signal: controller.signal }),
      komgaGetBookPages({ path: { bookId }, signal: controller.signal }),
    ])
    const revision = manifestRevision(pages ?? [])

    // If only the container/archive changed (for example CBR -> CBZ) while the
    // extracted page manifest is identical, update metadata without redownloading.
    if (existing.cacheName && existing.manifestRevision === revision) {
      existing.book = clone(book)
      existing.status = 'downloaded'
      existing.sourceLastModified = dateToken(book.lastModified)
      existing.updateAvailable = false
      existing.sourceMissing = false
      delete existing.remoteManifestRevision
      delete existing.remotePages
      delete existing.error
      await cacheBook(book)
      await updateDownload(existing)
      return
    }

    const series = await komgaGetSeriesById({
      path: { seriesId: book.seriesId },
      signal: controller.signal,
    })
    const stagingCacheName = cacheNameFor(bookId, revision)
    await caches.delete(stagingCacheName)
    const stagingCache = await caches.open(stagingCacheName)

    const hadActiveSnapshot = !!existing.cacheName
    const oldCacheName = existing.cacheName
    const record: OfflineDownloadRecord = hadActiveSnapshot
      ? {
          ...clone(existing),
          status: 'updating',
          totalPages: pages.length,
          completedPages: 0,
          bytes: 0,
          updateAvailable: true,
        }
      : {
          bookId,
          book: clone(book),
          status: 'downloading',
          totalPages: pages.length,
          completedPages: 0,
          bytes: 0,
          notificationGroupId: existing.notificationGroupId,
          autoManaged: existing.autoManaged,
          queuedAt: existing.queuedAt,
        }
    delete record.error
    await updateDownload(record)
    await showDownloadProgressNotification(record, true)

    let cursor = 0
    try {
      const workers = Array.from(
        {
          length: Math.min(preferences.value.concurrentPages, Math.max(1, pages.length)),
        },
        async () => {
          while (cursor < pages.length) {
            if (controller.signal.aborted)
              throw new DOMException('Download cancelled', 'AbortError')
            const page = pages[cursor++]
            if (!page) continue
            const request = new Request(downloadPageUrl(bookId, page), {
              credentials: 'include',
              signal: controller.signal,
            })
            const response = await fetch(request)
            if (!response.ok)
              throw new Error(`Could not download page ${page.number} (${response.status})`)

            const sizeHeader = Number(response.headers.get('content-length') ?? 0)
            const sizePromise =
              sizeHeader > 0
                ? Promise.resolve(sizeHeader)
                : response
                    .clone()
                    .blob()
                    .then((blob) => blob.size)
            await stagingCache.put(request, response)
            record.bytes += await sizePromise
            record.completedPages += 1
            // Notification check rides on the reactive sync points only: the
            // per-page filter+summarize would otherwise run hundreds of times
            // per second during bulk downloads.
            if (await persistDownloadProgress(record)) await showDownloadProgressNotification(record)
          }
        },
      )
      await Promise.all(workers)

      try {
        const posterUrl = bookPosterUrl(bookId)
        if (posterUrl) {
          const thumbnailRequest = new Request(posterUrl, { credentials: 'include' })
          const thumbnail = await fetch(thumbnailRequest)
          if (thumbnail.ok) await stagingCache.put(thumbnailRequest, thumbnail)
        }
      } catch {
        // Poster failure does not invalidate a complete set of readable pages.
      }

      // Atomic commit: only now does this revision become the one the service
      // worker serves. Until this point the old cacheName remained active.
      record.book = clone(book)
      record.status = 'downloaded'
      record.cacheName = stagingCacheName
      record.manifestRevision = revision
      record.sourceLastModified = dateToken(book.lastModified)
      record.downloadedAt = new Date().toISOString()
      record.updateAvailable = false
      record.sourceMissing = false
      delete record.remoteManifestRevision
      delete record.remotePages
      delete record.error

      await Promise.all([cacheBook(book), cacheSeriesItem(series), cachePages(bookId, pages)])
      await updateDownload(record)

      if (oldCacheName && oldCacheName !== stagingCacheName) await caches.delete(oldCacheName)
      await showDownloadNotification(record)
    } catch (e) {
      await caches.delete(stagingCacheName)
      if (cancelledJobs.has(bookId) || !getDownload(bookId)) {
        cancelledJobs.delete(bookId)
      } else if (hadActiveSnapshot && existing) {
        const restored = clone(existing)
        restored.status = 'downloaded'
        restored.updateAvailable = true
        restored.error = errorMessage(e)
        await updateDownload(restored)
      } else if (controller.signal.aborted) {
        record.status = 'paused'
        delete record.cacheName
        delete record.error
        await updateDownload(record)
      } else {
        record.status = 'error'
        delete record.cacheName
        record.error = errorMessage(e)
        await updateDownload(record)
      }
      const failed = getDownload(bookId)
      if (failed?.error) await showDownloadNotification(failed)
      throw e
    }
  }

  function processQueue(): void {
    if (processingQueue || !online.value || offlineMode.value) return
    processingQueue = true
    void Promise.resolve().then(() => {
      try {
        while (activeJobs.size < preferences.value.concurrentBooks) {
          const next = selectNextQueuedDownload(downloads.value, activeJobs)
          if (!next) break
          next.status = 'queued'
          const controller = new AbortController()
          activeJobs.set(next.bookId, controller)
          void performDownload(next.bookId, controller)
            .catch(async (e: unknown) => {
              const record = getDownload(next.bookId)
              if (record?.status === 'queued' && !cancelledJobs.has(next.bookId)) {
                record.status = record.cacheName ? 'downloaded' : online.value ? 'error' : 'queued'
                if (record.cacheName) record.updateAvailable = true
                record.error = errorMessage(e)
                await updateDownload(record)
              }
            })
            .finally(() => {
              activeJobs.delete(next.bookId)
              processQueue()
            })
        }
      } finally {
        processingQueue = false
      }
    })
  }

  async function queueBook(
    book: BookDto,
    autoManaged: boolean,
    notificationGroupId?: string,
    startQueue = true,
  ): Promise<void> {
    const bookId = book.id
    const current = getDownload(bookId)
    const queued: OfflineDownloadRecord = current?.cacheName
      ? {
          ...clone(current),
          status: 'queued',
          queuedAt: nextQueuedAt(),
          autoManaged,
          notificationGroupId,
        }
      : {
          bookId,
          book: clone(book),
          status: 'queued',
          totalPages: book.media?.pagesCount ?? 0,
          completedPages: 0,
          bytes: 0,
          queuedAt: nextQueuedAt(),
          autoManaged,
          notificationGroupId,
        }
    delete queued.error
    await updateDownload(queued)
    if (startQueue) processQueue()
  }

  async function downloadBook(
    bookId: string,
    autoManaged = false,
    notificationGroupId?: string,
  ): Promise<void> {
    await ready
    if (!online.value || offlineMode.value)
      throw new Error('Connect to the server before downloading a book')
    if (!isBrowser() || !('caches' in window))
      throw new Error('This browser does not provide Cache Storage')

    const current = getDownload(bookId)
    if (current && ['queued', 'downloading', 'updating'].includes(current.status)) return
    const book = await komgaGetBookById({ path: { bookId } })
    await queueBook(book, autoManaged, notificationGroupId)
  }

  async function downloadBooks(books: BookDto[], notificationGroupId: string): Promise<void> {
    await ready
    if (!online.value || offlineMode.value)
      throw new Error('Connect to the server before downloading books')
    if (!isBrowser() || !('caches' in window))
      throw new Error('This browser does not provide Cache Storage')
    for (const book of books) await queueBook(book, false, notificationGroupId, false)
    processQueue()
  }

  async function pauseDownload(bookId: string): Promise<void> {
    const record = getDownload(bookId)
    activeJobs.get(bookId)?.abort()
    if (record && record.status === 'queued') {
      record.status = 'paused'
      await updateDownload(record)
    }
  }

  async function resumeDownload(bookId: string): Promise<void> {
    const record = getDownload(bookId)
    if (!record || !['paused', 'error'].includes(record.status)) return
    record.status = 'queued'
    delete record.error
    await updateDownload(record)
    processQueue()
  }

  async function removeDownload(bookId: string): Promise<void> {
    await ready
    const record = getDownload(bookId)
    if (activeJobs.has(bookId)) cancelledJobs.add(bookId)
    activeJobs.get(bookId)?.abort()
    if (record?.cacheName && isBrowser() && 'caches' in window)
      await caches.delete(record.cacheName)
    await offlineDelete(OFFLINE_STORES.downloads, bookId)
    downloads.value = downloads.value.filter((x) => x.bookId !== bookId)
    notifyServiceWorker(bookId)
    // Metadata deliberately remains. Removing a download removes only media.
  }

  async function handleCompletedDownload(bookId: string): Promise<void> {
    const completed = getDownload(bookId)
    if (!completed?.cacheName) return
    if (!preferences.value.removeRead && !preferences.value.autoDownloadNext) return

    let next: BookDto | undefined
    if (preferences.value.autoDownloadNext) {
      const siblings = (
        await getCachedBooksPage(
          { condition: { seriesId: { operator: 'is', value: completed.book.seriesId } } },
          {
            unpaged: true,
            sort: ['metadata.numberSort'],
          },
        )
      ).content
      const index = siblings.findIndex((book) => book.id === bookId)
      const bufferedNext = siblings[index + 1]
      // Rotation starts only with a consecutive two-book buffer: the completed
      // book and the immediately following book must both already be readable.
      if (index >= 0 && bufferedNext && isDownloaded(bufferedNext.id)) {
        next = siblings.slice(index + 1).find((book) => !isDownloaded(book.id))
      }
    }
    if (preferences.value.removeRead) await removeDownload(bookId)
    if (preferences.value.autoDownloadNext && next) {
      if (online.value && !offlineMode.value)
        await downloadBook(next.id, true, completed.book.seriesId)
      else await queueBook(next, true, completed.book.seriesId)
    }
  }

  async function updateReadProgress(
    bookId: string,
    progress: ReadProgressUpdateDto,
  ): Promise<void> {
    await ready
    const activeDownload = getDownload(bookId)
    const normalizedProgress = clone(progress)
    const pagesCount = activeDownload?.book.media?.pagesCount || activeDownload?.totalPages || 0
    if (normalizedProgress.page && pagesCount > 0 && normalizedProgress.page >= pagesCount)
      normalizedProgress.completed = true
    const fromOfflineSnapshot = (offlineMode.value || !online.value) && !!activeDownload?.cacheName
    const queued: QueuedProgress = {
      bookId,
      progress: normalizedProgress,
      updatedAt: new Date().toISOString(),
      pending: true,
      revision: fromOfflineSnapshot ? activeDownload?.manifestRevision : undefined,
    }
    await offlinePut(OFFLINE_STORES.progress, queued)

    if (normalizedProgress.completed === true) {
      if (openReaderBooks.has(bookId)) deferredCompletions.add(bookId)
      else await handleCompletedDownload(bookId)
    }

    if (!online.value || offlineMode.value) return
    try {
      await komgaMarkBookReadProgress({ path: { bookId }, body: normalizedProgress })
      queued.pending = false
      await offlinePut(OFFLINE_STORES.progress, queued)
    } catch {
      // Remains queued and is retried after catalog/revision reconciliation.
    }
  }

  function readerOpened(bookId: string): void {
    openReaderBooks.add(bookId)
  }

  function readerClosed(bookId: string): void {
    openReaderBooks.delete(bookId)
    if (!deferredCompletions.delete(bookId)) return
    void handleCompletedDownload(bookId).catch(() => undefined)
  }

  async function flushProgressQueue(): Promise<void> {
    await ready
    if (!online.value || offlineMode.value || syncingProgress.value) return
    syncingProgress.value = true
    try {
      const entries = await offlineGetAll<QueuedProgress>(OFFLINE_STORES.progress)
      for (const entry of entries.filter((x) => x.pending)) {
        try {
          const outgoing = clone(entry.progress)
          const download = getDownload(entry.bookId)
          if (
            outgoing.page &&
            entry.revision &&
            download?.manifestRevision === entry.revision &&
            download.updateAvailable &&
            download.remotePages?.length
          ) {
            const oldPages = (await getCachedPages(entry.bookId)) ?? []
            outgoing.page = remapPage(oldPages, download.remotePages, outgoing.page)
          }

          await komgaMarkBookReadProgress({ path: { bookId: entry.bookId }, body: outgoing })
          entry.pending = false
          await offlinePut(OFFLINE_STORES.progress, entry)
        } catch {
          break
        }
      }
    } finally {
      syncingProgress.value = false
    }
  }

  async function storageEstimate(): Promise<{ usage: number; quota: number }> {
    if (!isBrowser() || !navigator.storage?.estimate) return { usage: 0, quota: 0 }
    const estimate = await navigator.storage.estimate()
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  }

  return {
    initialized,
    offlineMode,
    online,
    syncingMetadata,
    syncingProgress,
    downloads,
    cachedBooks,
    cachedSeries,
    preferences,
    whenReady,
    setOfflineMode,
    setDownloadPreferences,
    isDownloaded,
    getDownload,
    refreshState,
    cacheBook,
    cacheBooks,
    cacheSeriesItem,
    cacheSeries,
    cachePages,
    getCachedBook,
    getCachedSeries,
    getCachedPages,
    getCachedBooksPage,
    getCachedSeriesPage,
    getCachedOnDeck,
    syncCatalogMetadata,
    downloadBook,
    downloadBooks,
    pauseDownload,
    resumeDownload,
    removeDownload,
    updateReadProgress,
    readerOpened,
    readerClosed,
    flushProgressQueue,
    storageEstimate,
  }
})
