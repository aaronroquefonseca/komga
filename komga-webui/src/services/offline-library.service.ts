import Vue from 'vue'
import {AxiosInstance} from 'axios'
import {BookDto, PageDto, ReadProgressUpdateDto} from '@/types/komga-books'
import {SeriesDto} from '@/types/komga-series'
import {BookSearch, SeriesSearch} from '@/types/komga-search'
import {bookPageUrl, bookThumbnailUrl} from '@/functions/urls'
import {
  OFFLINE_STORES,
  offlineDelete,
  offlineGet,
  offlineGetAll,
  offlinePut,
  offlinePutMany,
  openOfflineDatabase,
} from '@/services/offline-db'

export const OFFLINE_MEDIA_CACHE = 'komga-offline-media-v1'

export type OfflineDownloadStatus = 'downloading' | 'downloaded' | 'error'

export interface OfflineDownloadRecord {
  bookId: string
  book: BookDto
  status: OfflineDownloadStatus
  totalPages: number
  completedPages: number
  bytes: number
  downloadedAt?: string
  error?: string
}

interface CachedPages {
  bookId: string
  pages: PageDto[]
  cachedAt: string
}

interface QueuedProgress {
  bookId: string
  progress: ReadProgressUpdateDto
  updatedAt: string
  pending: boolean
}

interface OfflineSetting<T> {
  key: string
  value: T
}

export interface OfflineLibraryState {
  initialized: boolean
  offlineMode: boolean
  online: boolean
  syncingMetadata: boolean
  syncingProgress: boolean
  downloads: OfflineDownloadRecord[]
  cachedBooks: number
  cachedSeries: number
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function getPath(value: any, path: string): any {
  return path.split('.').reduce((current, part) => current == null ? undefined : current[part], value)
}

function readStatus(item: any): string {
  if (!item.readProgress) return 'UNREAD'
  return item.readProgress.completed ? 'READ' : 'IN_PROGRESS'
}

function operatorMatches(actual: any, operator: any): boolean {
  if (!operator || typeof operator !== 'object') return true
  switch (operator.operator) {
    case 'is':
      if (Array.isArray(actual)) return actual.includes(operator.value)
      return actual === operator.value
    case 'isNot':
      if (Array.isArray(actual)) return !actual.includes(operator.value)
      return actual !== operator.value
    case 'isTrue': return actual === true
    case 'isFalse': return actual === false
    case 'isNull': return actual == null
    case 'isNotNull': return actual != null
    case 'before': return actual != null && new Date(actual).getTime() < new Date(operator.dateTime).getTime()
    case 'after': return actual != null && new Date(actual).getTime() > new Date(operator.dateTime).getTime()
    case 'beginsWith': return `${actual || ''}`.toLocaleLowerCase().startsWith(`${operator.value || ''}`.toLocaleLowerCase())
    case 'doesNotBeginWith': return !`${actual || ''}`.toLocaleLowerCase().startsWith(`${operator.value || ''}`.toLocaleLowerCase())
    default: return true
  }
}

function conditionMatches(item: any, condition: any, series: boolean): boolean {
  if (!condition || Object.keys(condition).length === 0) return true
  if (Array.isArray(condition.allOf)) return condition.allOf.every((x: any) => conditionMatches(item, x, series))
  if (Array.isArray(condition.anyOf)) return condition.anyOf.some((x: any) => conditionMatches(item, x, series))

  return Object.entries(condition).every(([key, operator]) => {
    switch (key) {
      case 'libraryId': return operatorMatches(item.libraryId, operator)
      case 'seriesId': return operatorMatches(item.seriesId, operator)
      case 'readStatus': return operatorMatches(readStatus(item), operator)
      case 'mediaStatus': return operatorMatches(item.media?.status, operator)
      case 'mediaProfile': return operatorMatches(item.media?.mediaProfile, operator)
      case 'oneShot': return operatorMatches(item.oneshot, operator)
      case 'deleted': return operatorMatches(item.deleted, operator)
      case 'tag': return operatorMatches(item.metadata?.tags || [], operator)
      case 'genre': return operatorMatches(item.metadata?.genres || [], operator)
      case 'language': return operatorMatches(item.metadata?.language, operator)
      case 'publisher': return operatorMatches(item.metadata?.publisher, operator)
      case 'seriesStatus': return operatorMatches(item.metadata?.status, operator)
      case 'complete': return operatorMatches(item.metadata?.status === 'ENDED', operator)
      case 'releaseDate': return operatorMatches(item.metadata?.releaseDate, operator)
      case 'sharingLabel': return operatorMatches(item.metadata?.sharingLabels || [], operator)
      case 'titleSort': return operatorMatches(item.metadata?.titleSort || item.metadata?.title, operator)
      default:
        // Unknown filters are left permissive offline. This is preferable to
        // hiding cached entries because a newly-added server filter has no local
        // implementation yet.
        return true
    }
  })
}

function fullTextMatches(item: any, query?: string): boolean {
  if (!query?.trim()) return true
  const q = query.trim().toLocaleLowerCase()
  const values = [
    item.name,
    item.seriesTitle,
    item.metadata?.title,
    item.metadata?.titleSort,
    ...(item.metadata?.authors || []).map((x: any) => x.name),
    ...(item.metadata?.tags || []),
  ]
  return values.some(value => `${value || ''}`.toLocaleLowerCase().includes(q))
}

function pageFromItems<T>(items: T[], pageRequest?: any): Page<T> {
  const sort = Array.isArray(pageRequest?.sort) ? pageRequest.sort : []
  const sorted = [...items]
  if (sort.length > 0) {
    const [field, direction = 'asc'] = `${sort[0]}`.split(',')
    sorted.sort((a: any, b: any) => {
      const av = getPath(a, field)
      const bv = getPath(b, field)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const result = typeof av === 'string'
        ? av.localeCompare(`${bv}`, undefined, {numeric: true, sensitivity: 'base'})
        : av < bv ? -1 : av > bv ? 1 : 0
      return direction.toLowerCase() === 'desc' ? -result : result
    })
  }

  const unpaged = pageRequest?.unpaged === true
  const size = unpaged ? Math.max(1, sorted.length) : Number(pageRequest?.size ?? 20)
  const number = unpaged ? 0 : Number(pageRequest?.page ?? 0)
  const start = unpaged ? 0 : number * size
  const content = unpaged ? sorted : sorted.slice(start, start + size)
  const totalPages = sorted.length === 0 ? 0 : Math.ceil(sorted.length / size)

  return {
    content,
    totalElements: sorted.length,
    totalPages,
    number,
    size,
    first: number === 0,
    last: unpaged || number >= totalPages - 1,
    empty: content.length === 0,
    numberOfElements: content.length,
  } as Page<T>
}

export default class OfflineLibraryService {
  private http: AxiosInstance
  private ready: Promise<void>
  state: OfflineLibraryState

  constructor(http: AxiosInstance) {
    this.http = http
    this.state = Vue.observable({
      initialized: false,
      offlineMode: false,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      syncingMetadata: false,
      syncingProgress: false,
      downloads: [],
      cachedBooks: 0,
      cachedSeries: 0,
    }) as OfflineLibraryState

    this.ready = this.initialize()
    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)
  }

  private handleOnline = () => {
    this.state.online = true
    if (!this.state.offlineMode) this.flushProgressQueue()
  }

  private handleOffline = () => {
    this.state.online = false
  }

  private async initialize(): Promise<void> {
    await openOfflineDatabase()
    const setting = await offlineGet<OfflineSetting<boolean>>(OFFLINE_STORES.settings, 'offlineMode')
    this.state.offlineMode = setting?.value === true
    await this.refreshState()
    this.state.initialized = true
    this.notifyServiceWorker()

    try {
      if (navigator.storage?.persist) await navigator.storage.persist()
    } catch (_) {
      // Persistence is best-effort; browser storage still works without it.
    }

    if (this.state.online && !this.state.offlineMode) this.flushProgressQueue()
  }

  async whenReady(): Promise<void> {
    await this.ready
  }

  private notifyServiceWorker(): void {
    if (!('serviceWorker' in navigator)) return
    const message = {type: 'KOMGA_OFFLINE_MODE', enabled: this.state.offlineMode}
    navigator.serviceWorker.controller?.postMessage(message)
    navigator.serviceWorker.ready.then(registration => registration.active?.postMessage(message)).catch(() => undefined)
  }

  async setOfflineMode(enabled: boolean): Promise<void> {
    await this.ready
    this.state.offlineMode = enabled
    await offlinePut(OFFLINE_STORES.settings, {key: 'offlineMode', value: enabled} as OfflineSetting<boolean>)
    this.notifyServiceWorker()
    if (!enabled && this.state.online) this.flushProgressQueue()
  }

  isDownloaded(bookId: string): boolean {
    return this.state.downloads.some(x => x.bookId === bookId && x.status === 'downloaded')
  }

  getDownload(bookId: string): OfflineDownloadRecord | undefined {
    return this.state.downloads.find(x => x.bookId === bookId)
  }

  async refreshState(): Promise<void> {
    const [downloads, books, series] = await Promise.all([
      offlineGetAll<OfflineDownloadRecord>(OFFLINE_STORES.downloads),
      offlineGetAll<BookDto>(OFFLINE_STORES.books),
      offlineGetAll<SeriesDto>(OFFLINE_STORES.series),
    ])
    this.state.downloads = downloads.sort((a, b) => `${b.downloadedAt || ''}`.localeCompare(`${a.downloadedAt || ''}`))
    this.state.cachedBooks = books.length
    this.state.cachedSeries = series.length
  }

  async cacheBook(book: BookDto): Promise<void> {
    await offlinePut(OFFLINE_STORES.books, clone(book))
    this.state.cachedBooks = Math.max(this.state.cachedBooks, 1)
  }

  async cacheBooks(books: BookDto[]): Promise<void> {
    await offlinePutMany(OFFLINE_STORES.books, books.map(clone))
    this.state.cachedBooks = (await offlineGetAll<BookDto>(OFFLINE_STORES.books)).length
  }

  async cacheSeriesItem(series: SeriesDto): Promise<void> {
    await offlinePut(OFFLINE_STORES.series, clone(series))
    this.state.cachedSeries = Math.max(this.state.cachedSeries, 1)
  }

  async cacheSeries(series: SeriesDto[]): Promise<void> {
    await offlinePutMany(OFFLINE_STORES.series, series.map(clone))
    this.state.cachedSeries = (await offlineGetAll<SeriesDto>(OFFLINE_STORES.series)).length
  }

  async cachePages(bookId: string, pages: PageDto[]): Promise<void> {
    await offlinePut(OFFLINE_STORES.pages, {
      bookId,
      pages: clone(pages),
      cachedAt: new Date().toISOString(),
    } as CachedPages)
  }

  async getCachedBook(bookId: string): Promise<BookDto | undefined> {
    const book = await offlineGet<BookDto>(OFFLINE_STORES.books, bookId)
    if (!book) return undefined
    const queued = await offlineGet<QueuedProgress>(OFFLINE_STORES.progress, bookId)
    if (queued) {
      const pagesCount = book.media?.pagesCount || 0
      ;(book as any).readProgress = {
        ...(book as any).readProgress,
        page: queued.progress.page,
        completed: pagesCount > 0 && queued.progress.page >= pagesCount,
        readDate: queued.updatedAt,
      }
    }
    return book
  }

  async getCachedSeries(seriesId: string): Promise<SeriesDto | undefined> {
    return offlineGet<SeriesDto>(OFFLINE_STORES.series, seriesId)
  }

  async getCachedPages(bookId: string): Promise<PageDto[] | undefined> {
    const record = await offlineGet<CachedPages>(OFFLINE_STORES.pages, bookId)
    return record?.pages
  }

  async getCachedBooksPage(search: BookSearch = {}, pageRequest?: any): Promise<Page<BookDto>> {
    const books = await offlineGetAll<BookDto>(OFFLINE_STORES.books)
    const matching = books.filter(book =>
      conditionMatches(book, search.condition, false) && fullTextMatches(book, search.fullTextSearch),
    )
    return pageFromItems(matching, pageRequest)
  }

  async getCachedSeriesPage(search: SeriesSearch = {}, pageRequest?: any): Promise<Page<SeriesDto>> {
    const series = await offlineGetAll<SeriesDto>(OFFLINE_STORES.series)
    const matching = series.filter(item =>
      conditionMatches(item, search.condition, true) && fullTextMatches(item, search.fullTextSearch),
    )
    return pageFromItems(matching, pageRequest)
  }

  async getCachedOnDeck(libraryIds?: string[], pageRequest?: any): Promise<Page<BookDto>> {
    const books = await offlineGetAll<BookDto>(OFFLINE_STORES.books)
    const matching = books.filter(book => {
      if (libraryIds?.length && !libraryIds.includes(book.libraryId)) return false
      return !!book.readProgress && book.readProgress.completed === false
    })
    matching.sort((a: any, b: any) => new Date(b.readProgress?.readDate || 0).getTime() - new Date(a.readProgress?.readDate || 0).getTime())
    return pageFromItems(matching, pageRequest)
  }

  async syncCatalogMetadata(): Promise<void> {
    await this.ready
    if (!this.state.online || this.state.offlineMode || this.state.syncingMetadata) return
    this.state.syncingMetadata = true
    try {
      const [books, series] = await Promise.all([
        this.http.post('/api/v1/books/list', {}, {params: {unpaged: true}}),
        this.http.post('/api/v1/series/list', {}, {params: {unpaged: true}}),
      ])
      await Promise.all([
        this.cacheBooks(books.data.content || []),
        this.cacheSeries(series.data.content || []),
      ])
    } finally {
      this.state.syncingMetadata = false
    }
  }

  private downloadPageUrl(bookId: string, page: PageDto): string {
    // Store the format Komga would normally hand to broadly-supported browsers.
    // The service worker matches page cache entries ignoring the query string,
    // so a cached converted response can still satisfy the reader's canonical URL.
    const directlySupported = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']
    return directlySupported.includes(page.mediaType)
      ? bookPageUrl(bookId, page.number)
      : bookPageUrl(bookId, page.number, 'jpeg')
  }

  private async updateDownload(record: OfflineDownloadRecord): Promise<void> {
    await offlinePut(OFFLINE_STORES.downloads, clone(record))
    const index = this.state.downloads.findIndex(x => x.bookId === record.bookId)
    if (index >= 0) this.state.downloads.splice(index, 1, clone(record))
    else this.state.downloads.unshift(clone(record))
  }

  async downloadBook(bookId: string): Promise<void> {
    await this.ready
    if (!this.state.online || this.state.offlineMode) throw new Error('Connect to the server before downloading a book')
    if (!('caches' in window)) throw new Error('This browser does not provide Cache Storage')

    const [bookResponse, pagesResponse] = await Promise.all([
      this.http.get(`/api/v1/books/${bookId}`),
      this.http.get(`/api/v1/books/${bookId}/pages`),
    ])
    const book = bookResponse.data as BookDto
    const pages = pagesResponse.data as PageDto[]
    await Promise.all([this.cacheBook(book), this.cachePages(bookId, pages)])

    const record: OfflineDownloadRecord = {
      bookId,
      book: clone(book),
      status: 'downloading',
      totalPages: pages.length,
      completedPages: 0,
      bytes: 0,
    }
    await this.updateDownload(record)

    const cache = await caches.open(OFFLINE_MEDIA_CACHE)
    let cursor = 0
    try {
      const workers = Array.from({length: Math.min(3, Math.max(1, pages.length))}, async () => {
        while (cursor < pages.length) {
          const page = pages[cursor++]
          const url = this.downloadPageUrl(bookId, page)
          const request = new Request(url, {credentials: 'include'})
          const response = await fetch(request)
          if (!response.ok) throw new Error(`Could not download page ${page.number} (${response.status})`)

          const sizeHeader = Number(response.headers.get('content-length') || 0)
          const sizePromise = sizeHeader > 0 ? Promise.resolve(sizeHeader) : response.clone().blob().then(blob => blob.size)
          await cache.put(request, response)
          record.bytes += await sizePromise
          record.completedPages += 1
          await this.updateDownload(record)
        }
      })
      await Promise.all(workers)

      // Keep the book poster available to the Downloads view while offline.
      try {
        const thumbnailRequest = new Request(bookThumbnailUrl(bookId), {credentials: 'include'})
        const thumbnail = await fetch(thumbnailRequest)
        if (thumbnail.ok) await cache.put(thumbnailRequest, thumbnail)
      } catch (_) {
        // A missing thumbnail should not invalidate an otherwise complete book.
      }

      record.status = 'downloaded'
      record.downloadedAt = new Date().toISOString()
      delete record.error
      await this.updateDownload(record)
    } catch (e) {
      record.status = 'error'
      record.error = e instanceof Error ? e.message : `${e}`
      await this.updateDownload(record)
      throw e
    }
  }

  async removeDownload(bookId: string): Promise<void> {
    await this.ready
    const cache = await caches.open(OFFLINE_MEDIA_CACHE)
    const pages = await this.getCachedPages(bookId) || []
    for (const page of pages) {
      await cache.delete(this.downloadPageUrl(bookId, page), {ignoreSearch: true})
    }
    await cache.delete(bookThumbnailUrl(bookId), {ignoreSearch: true})
    await offlineDelete(OFFLINE_STORES.downloads, bookId)
    this.state.downloads = this.state.downloads.filter(x => x.bookId !== bookId)
    // Book/series/page metadata deliberately remains in IndexedDB. Removing a
    // download removes only the large local media payloads.
  }

  async updateReadProgress(bookId: string, progress: ReadProgressUpdateDto): Promise<void> {
    await this.ready
    const queued: QueuedProgress = {
      bookId,
      progress: clone(progress),
      updatedAt: new Date().toISOString(),
      pending: true,
    }
    await offlinePut(OFFLINE_STORES.progress, queued)

    if (!this.state.online || this.state.offlineMode) return
    try {
      await this.http.patch(`/api/v1/books/${bookId}/read-progress`, progress)
      queued.pending = false
      await offlinePut(OFFLINE_STORES.progress, queued)
    } catch (_) {
      // Remains queued and is retried on the next online/focus cycle.
    }
  }

  async flushProgressQueue(): Promise<void> {
    await this.ready
    if (!this.state.online || this.state.offlineMode || this.state.syncingProgress) return
    this.state.syncingProgress = true
    try {
      const entries = await offlineGetAll<QueuedProgress>(OFFLINE_STORES.progress)
      for (const entry of entries.filter(x => x.pending)) {
        try {
          await this.http.patch(`/api/v1/books/${entry.bookId}/read-progress`, entry.progress)
          entry.pending = false
          await offlinePut(OFFLINE_STORES.progress, entry)
        } catch (_) {
          // Stop after the first network failure. Another online/focus event will retry.
          break
        }
      }
    } finally {
      this.state.syncingProgress = false
    }
  }

  async storageEstimate(): Promise<{usage: number; quota: number}> {
    if (!navigator.storage?.estimate) return {usage: 0, quota: 0}
    const estimate = await navigator.storage.estimate()
    return {usage: estimate.usage || 0, quota: estimate.quota || 0}
  }
}
