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

export const OFFLINE_BOOK_CACHE_PREFIX = 'komga-offline-book-v2-'

export type OfflineDownloadStatus = 'queued' | 'downloading' | 'updating' | 'downloaded' | 'paused' | 'error'

export interface OfflineDownloadPreferences {
  concurrentBooks: number
  concurrentPages: number
  notifyWhenComplete: boolean
  removeRead: boolean
  autoDownloadNext: boolean
}

const DEFAULT_DOWNLOAD_PREFERENCES: OfflineDownloadPreferences = {
  concurrentBooks: 3,
  concurrentPages: 2,
  notifyWhenComplete: true,
  removeRead: false,
  autoDownloadNext: false,
}

export interface OfflineDownloadRecord {
  bookId: string
  book: BookDto
  status: OfflineDownloadStatus
  totalPages: number
  completedPages: number
  bytes: number
  downloadedAt?: string
  error?: string
  cacheName?: string
  manifestRevision?: string
  sourceLastModified?: string
  updateAvailable?: boolean
  remoteManifestRevision?: string
  remotePages?: PageDto[]
  sourceMissing?: boolean
  queuedAt?: string
  autoManaged?: boolean
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
  revision?: string
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
  preferences: OfflineDownloadPreferences
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

function conditionMatches(item: any, condition: any): boolean {
  if (!condition || Object.keys(condition).length === 0) return true
  if (Array.isArray(condition.allOf)) return condition.allOf.every((x: any) => conditionMatches(item, x))
  if (Array.isArray(condition.anyOf)) return condition.anyOf.some((x: any) => conditionMatches(item, x))

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
        // Unknown filters stay permissive offline rather than hiding cached data.
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

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function manifestRevision(pages: PageDto[]): string {
  // Deliberately excludes archive/container details. A CBR -> CBZ conversion
  // with identical extracted pages therefore does not force a media redownload.
  const manifest = pages.map(page => [
    page.number,
    page.fileName,
    page.mediaType,
    page.width || 0,
    page.height || 0,
    page.sizeBytes || 0,
  ].join(':')).join('|')
  return `${pages.length}-${stableHash(manifest)}`
}

function pageIdentity(page: PageDto): string {
  return [page.fileName, page.mediaType, page.width || 0, page.height || 0, page.sizeBytes || 0].join(':')
}

function contentIdentity(page: PageDto): string {
  return [page.mediaType, page.width || 0, page.height || 0, page.sizeBytes || 0].join(':')
}

function remapPage(oldPages: PageDto[], newPages: PageDto[], oldPageNumber: number): number {
  if (newPages.length === 0) return 1
  const source = oldPages.find(page => page.number === oldPageNumber) || oldPages[oldPageNumber - 1]
  if (!source) return Math.max(1, Math.min(newPages.length, oldPageNumber))

  const exact = newPages.find(page => pageIdentity(page) === pageIdentity(source))
  if (exact) return exact.number

  // Translators/promotional pages are commonly removed without renaming the
  // remaining artwork. If names did change, use dimensions+byte size only when
  // that identity is unique in the new manifest.
  const contentMatches = newPages.filter(page => contentIdentity(page) === contentIdentity(source))
  if (contentMatches.length === 1) return contentMatches[0].number

  // Last-resort fallback preserves approximate position while staying valid.
  const ratio = oldPages.length > 1 ? (oldPageNumber - 1) / (oldPages.length - 1) : 0
  return Math.max(1, Math.min(newPages.length, Math.round(ratio * Math.max(0, newPages.length - 1)) + 1))
}

function dateToken(value: any): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? `${value}` : date.toISOString()
}

export default class OfflineLibraryService {
  private http: AxiosInstance
  private ready: Promise<void>
  private activeJobs = new Map<string, AbortController>()
  private cancelledJobs = new Set<string>()
  private processingQueue = false
  private notifiedProgress = new Map<string, number>()
  private persistedProgressAt = new Map<string, number>()
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
      preferences: clone(DEFAULT_DOWNLOAD_PREFERENCES),
    }) as OfflineLibraryState

    this.ready = this.initialize()
    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)
  }

  private handleOnline = () => {
    this.state.online = true
    this.processQueue()
  }

  private handleOffline = () => {
    this.state.online = false
  }

  private async initialize(): Promise<void> {
    await openOfflineDatabase()
    const setting = await offlineGet<OfflineSetting<boolean>>(OFFLINE_STORES.settings, 'offlineMode')
    const preferences = await offlineGet<OfflineSetting<OfflineDownloadPreferences>>(OFFLINE_STORES.settings, 'downloadPreferences')
    this.state.offlineMode = setting?.value === true
    this.state.preferences = {...DEFAULT_DOWNLOAD_PREFERENCES, ...(preferences?.value || {})}
    this.state.preferences.concurrentBooks = Math.max(1, Math.min(6, this.state.preferences.concurrentBooks))
    this.state.preferences.concurrentPages = Math.max(1, Math.min(4, this.state.preferences.concurrentPages))
    await this.refreshState()
    await this.recoverInterruptedDownloads()
    await this.cleanupOrphanedBookCaches()
    this.state.initialized = true
    this.notifyServiceWorker()
    this.processQueue()

    try {
      if (navigator.storage?.persist) await navigator.storage.persist()
    } catch (_) {
      // Persistence is best-effort; browser storage still works without it.
    }
  }

  async whenReady(): Promise<void> {
    await this.ready
  }

  private notifyServiceWorker(bookId?: string): void {
    if (!('serviceWorker' in navigator)) return
    const message = bookId
      ? {type: 'KOMGA_DOWNLOAD_CHANGED', bookId}
      : {type: 'KOMGA_OFFLINE_MODE', enabled: this.state.offlineMode}
    navigator.serviceWorker.controller?.postMessage(message)
    navigator.serviceWorker.ready.then(registration => registration.active?.postMessage(message)).catch(() => undefined)
  }

  async setOfflineMode(enabled: boolean): Promise<void> {
    await this.ready
    this.state.offlineMode = enabled
    await offlinePut(OFFLINE_STORES.settings, {key: 'offlineMode', value: enabled} as OfflineSetting<boolean>)
    this.notifyServiceWorker()
    if (!enabled) this.processQueue()
  }

  async setDownloadPreferences(preferences: Partial<OfflineDownloadPreferences>): Promise<void> {
    await this.ready
    this.state.preferences = {...this.state.preferences, ...preferences}
    await offlinePut(OFFLINE_STORES.settings, {key: 'downloadPreferences', value: clone(this.state.preferences)})
    this.processQueue()
  }

  private async recoverInterruptedDownloads(): Promise<void> {
    for (const record of this.state.downloads.filter(x => x.status === 'downloading' || x.status === 'updating')) {
      record.status = 'queued'
      record.completedPages = 0
      record.bytes = record.cacheName ? record.bytes : 0
      record.queuedAt = new Date().toISOString()
      await this.updateDownload(record)
    }
  }

  isDownloaded(bookId: string): boolean {
    const download = this.getDownload(bookId)
    return !!download?.cacheName && ['downloaded', 'updating'].includes(download.status)
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

  private async cleanupOrphanedBookCaches(): Promise<void> {
    if (!('caches' in window)) return
    const active = new Set(this.state.downloads.map(x => x.cacheName).filter((x): x is string => !!x))
    const names = await caches.keys()
    await Promise.all(names
      .filter(name => name.startsWith(OFFLINE_BOOK_CACHE_PREFIX) && !active.has(name))
      .map(name => caches.delete(name)))
  }

  async cacheBook(book: BookDto): Promise<void> {
    await offlinePut(OFFLINE_STORES.books, clone(book))
    this.state.cachedBooks = (await offlineGetAll<BookDto>(OFFLINE_STORES.books)).length
  }

  async cacheBooks(books: BookDto[]): Promise<void> {
    await offlinePutMany(OFFLINE_STORES.books, books.map(clone))
    this.state.cachedBooks = (await offlineGetAll<BookDto>(OFFLINE_STORES.books)).length
  }

  async cacheSeriesItem(series: SeriesDto): Promise<void> {
    await offlinePut(OFFLINE_STORES.series, clone(series))
    this.state.cachedSeries = (await offlineGetAll<SeriesDto>(OFFLINE_STORES.series)).length
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
    // An active download is a coherent snapshot. Prefer its BookDto over newer
    // catalog metadata until that downloaded snapshot is atomically replaced.
    const download = this.getDownload(bookId)
    const book = download?.cacheName ? clone(download.book) : await offlineGet<BookDto>(OFFLINE_STORES.books, bookId)
    if (!book) return undefined

    const queued = await offlineGet<QueuedProgress>(OFFLINE_STORES.progress, bookId)
    if (queued?.progress.page) {
      const pagesCount = book.media?.pagesCount || 0
      ;(book as any).readProgress = {
        ...(book as any).readProgress,
        page: queued.progress.page,
        completed: queued.progress.completed === true || (pagesCount > 0 && queued.progress.page >= pagesCount),
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
    const matching = books.filter(book => conditionMatches(book, search.condition) && fullTextMatches(book, search.fullTextSearch))
    return pageFromItems(matching, pageRequest)
  }

  async getCachedSeriesPage(search: SeriesSearch = {}, pageRequest?: any): Promise<Page<SeriesDto>> {
    const series = await offlineGetAll<SeriesDto>(OFFLINE_STORES.series)
    const matching = series.filter(item => conditionMatches(item, search.condition) && fullTextMatches(item, search.fullTextSearch))
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
      const [booksResponse, seriesResponse] = await Promise.all([
        this.http.post('/api/v1/books/list', {}, {params: {unpaged: true}}),
        this.http.post('/api/v1/series/list', {}, {params: {unpaged: true}}),
      ])
      const books = (booksResponse.data.content || []) as BookDto[]
      const series = (seriesResponse.data.content || []) as SeriesDto[]
      await Promise.all([this.cacheBooks(books), this.cacheSeries(series)])
      await this.checkDownloadUpdates(books)
    } finally {
      this.state.syncingMetadata = false
    }
  }

  private async checkDownloadUpdates(serverBooks: BookDto[]): Promise<void> {
    const byId = new Map(serverBooks.map(book => [book.id, book]))
    for (const record of this.state.downloads.filter(x => !!x.cacheName)) {
      const serverBook = byId.get(record.bookId)
      if (!serverBook) {
        if (!record.sourceMissing) {
          record.sourceMissing = true
          await this.updateDownload(record)
        }
        continue
      }

      record.sourceMissing = false
      const modified = dateToken(serverBook.lastModified)
      const coarseChanged = modified !== (record.sourceLastModified || '') ||
        serverBook.media?.pagesCount !== record.totalPages
      if (!coarseChanged) continue

      try {
        const response = await this.http.get(`/api/v1/books/${record.bookId}/pages`)
        const pages = response.data as PageDto[]
        const revision = manifestRevision(pages)
        if (revision === record.manifestRevision) {
          // Archive conversion or metadata/file timestamp changed, but the
          // extracted comic pages are identical. No media redownload needed.
          record.book = clone(serverBook)
          record.sourceLastModified = modified
          record.updateAvailable = false
          delete record.remoteManifestRevision
          delete record.remotePages
          await this.updateDownload(record)
        } else {
          record.updateAvailable = true
          record.remoteManifestRevision = revision
          record.remotePages = clone(pages)
          await this.updateDownload(record)
        }
      } catch (_) {
        // Keep the current snapshot. A later catalog sync will retry the check.
      }
    }
  }

  private downloadPageUrl(bookId: string, page: PageDto): string {
    const directlySupported = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']
    return directlySupported.includes(page.mediaType)
      ? bookPageUrl(bookId, page.number)
      : bookPageUrl(bookId, page.number, 'jpeg')
  }

  private cacheName(bookId: string, revision: string): string {
    return `${OFFLINE_BOOK_CACHE_PREFIX}${stableHash(bookId)}-${revision}`
  }

  private async updateDownload(record: OfflineDownloadRecord): Promise<void> {
    await offlinePut(OFFLINE_STORES.downloads, clone(record))
    const index = this.state.downloads.findIndex(x => x.bookId === record.bookId)
    if (index >= 0) this.state.downloads.splice(index, 1, clone(record))
    else this.state.downloads.unshift(clone(record))
    this.notifyServiceWorker(record.bookId)
  }

  async downloadBook(bookId: string, autoManaged: boolean = false): Promise<void> {
    await this.ready
    if (!this.state.online || this.state.offlineMode) throw new Error('Connect to the server before downloading a book')
    if (!('caches' in window)) throw new Error('This browser does not provide Cache Storage')

    const current = this.getDownload(bookId)
    if (current && ['queued', 'downloading', 'updating'].includes(current.status)) return
    const bookResponse = await this.http.get(`/api/v1/books/${bookId}`)
    const book = bookResponse.data as BookDto
    await this.queueBook(book, autoManaged)
  }

  private async queueBook(book: BookDto, autoManaged: boolean): Promise<void> {
    const bookId = book.id
    const current = this.getDownload(bookId)
    const queued: OfflineDownloadRecord = current?.cacheName
      ? {...clone(current), status: 'queued', queuedAt: new Date().toISOString(), autoManaged}
      : {bookId, book: clone(book), status: 'queued', totalPages: book.media?.pagesCount || 0,
        completedPages: 0, bytes: 0, queuedAt: new Date().toISOString(), autoManaged}
    delete queued.error
    await this.updateDownload(queued)
    this.processQueue()
  }

  private async performDownload(bookId: string, controller: AbortController): Promise<void> {
    const existing = this.getDownload(bookId)
    if (!existing) return
    const [bookResponse, pagesResponse] = await Promise.all([
      this.http.get(`/api/v1/books/${bookId}`, {signal: controller.signal}),
      this.http.get(`/api/v1/books/${bookId}/pages`, {signal: controller.signal}),
    ])
    const book = bookResponse.data as BookDto
    const pages = pagesResponse.data as PageDto[]
    const revision = manifestRevision(pages)

    // If only the container/archive changed (for example CBR -> CBZ) while the
    // extracted page manifest is identical, update metadata without redownloading.
    if (existing?.cacheName && existing.manifestRevision === revision) {
      existing.book = clone(book)
      existing.status = 'downloaded'
      existing.sourceLastModified = dateToken(book.lastModified)
      existing.updateAvailable = false
      existing.sourceMissing = false
      delete existing.remoteManifestRevision
      delete existing.remotePages
      delete existing.error
      await this.cacheBook(book)
      await this.updateDownload(existing)
      return
    }

    const seriesResponse = await this.http.get(`/api/v1/series/${book.seriesId}`)
    const series = seriesResponse.data as SeriesDto
    const stagingCacheName = this.cacheName(bookId, revision)
    await caches.delete(stagingCacheName)
    const stagingCache = await caches.open(stagingCacheName)

    const hadActiveSnapshot = !!existing?.cacheName
    const oldCacheName = existing?.cacheName
    const record: OfflineDownloadRecord = hadActiveSnapshot
      ? {
        ...clone(existing!),
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
      }
    delete record.error
    await this.updateDownload(record)
    await this.showDownloadProgressNotification(record, true)

    let cursor = 0
    try {
      const workers = Array.from({length: Math.min(this.state.preferences.concurrentPages, Math.max(1, pages.length))}, async () => {
        while (cursor < pages.length) {
          if (controller.signal.aborted) throw new DOMException('Download cancelled', 'AbortError')
          const page = pages[cursor++]
          const request = new Request(this.downloadPageUrl(bookId, page), {credentials: 'include', signal: controller.signal})
          const response = await fetch(request)
          if (!response.ok) throw new Error(`Could not download page ${page.number} (${response.status})`)

          const sizeHeader = Number(response.headers.get('content-length') || 0)
          const sizePromise = sizeHeader > 0 ? Promise.resolve(sizeHeader) : response.clone().blob().then(blob => blob.size)
          await stagingCache.put(request, response)
          record.bytes += await sizePromise
          record.completedPages += 1
          await this.persistDownloadProgress(record)
          await this.showDownloadProgressNotification(record)
        }
      })
      await Promise.all(workers)

      try {
        const thumbnailRequest = new Request(bookThumbnailUrl(bookId), {credentials: 'include'})
        const thumbnail = await fetch(thumbnailRequest)
        if (thumbnail.ok) await stagingCache.put(thumbnailRequest, thumbnail)
      } catch (_) {
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

      await Promise.all([
        this.cacheBook(book),
        this.cacheSeriesItem(series),
        this.cachePages(bookId, pages),
      ])
      await this.updateDownload(record)

      if (oldCacheName && oldCacheName !== stagingCacheName) await caches.delete(oldCacheName)
      await this.showDownloadNotification(record)
    } catch (e) {
      await caches.delete(stagingCacheName)
      if (this.cancelledJobs.has(bookId) || !this.getDownload(bookId)) {
        this.cancelledJobs.delete(bookId)
      } else if (hadActiveSnapshot && existing) {
        const restored = clone(existing)
        restored.status = 'downloaded'
        restored.updateAvailable = true
        restored.error = e instanceof Error ? e.message : `${e}`
        await this.updateDownload(restored)
      } else if (controller.signal.aborted) {
        record.status = 'paused'
        delete record.cacheName
        delete record.error
        await this.updateDownload(record)
      } else {
        record.status = 'error'
        delete record.cacheName
        record.error = e instanceof Error ? e.message : `${e}`
        await this.updateDownload(record)
      }
      throw e
    }
  }

  private processQueue(): void {
    if (this.processingQueue || !this.state.online || this.state.offlineMode) return
    this.processingQueue = true
    Promise.resolve().then(async () => {
      try {
        while (this.activeJobs.size < this.state.preferences.concurrentBooks) {
          const next = this.state.downloads
            .filter(x => x.status === 'queued' && !this.activeJobs.has(x.bookId))
            .sort((a, b) => `${a.queuedAt || ''}`.localeCompare(`${b.queuedAt || ''}`))[0]
          if (!next) break
          next.status = 'queued'
          const controller = new AbortController()
          this.activeJobs.set(next.bookId, controller)
          this.performDownload(next.bookId, controller)
            .catch(async e => {
              const record = this.getDownload(next.bookId)
              if (record?.status === 'queued' && !this.cancelledJobs.has(next.bookId)) {
                record.status = record.cacheName ? 'downloaded' : (this.state.online ? 'error' : 'queued')
                if (record.cacheName) record.updateAvailable = true
                record.error = e instanceof Error ? e.message : `${e}`
                await this.updateDownload(record)
              }
            })
            .finally(() => {
              this.activeJobs.delete(next.bookId)
              this.processQueue()
            })
        }
      } finally {
        this.processingQueue = false
      }
    })
  }

  async pauseDownload(bookId: string): Promise<void> {
    const record = this.getDownload(bookId)
    this.activeJobs.get(bookId)?.abort()
    if (record && record.status === 'queued') {
      record.status = 'paused'
      await this.updateDownload(record)
    }
  }

  async resumeDownload(bookId: string): Promise<void> {
    const record = this.getDownload(bookId)
    if (!record || !['paused', 'error'].includes(record.status)) return
    record.status = 'queued'
    delete record.error
    await this.updateDownload(record)
    this.processQueue()
  }

  private async showDownloadNotification(record: OfflineDownloadRecord): Promise<void> {
    if (!this.state.preferences.notifyWhenComplete || !('Notification' in window) || Notification.permission !== 'granted') return
    this.notifiedProgress.delete(record.bookId)
    const remaining = this.remainingDownloadCount(record.bookId)
    const suffix = remaining > 0 ? ` · ${remaining} book${remaining === 1 ? '' : 's'} remaining` : ''
    const options = {body: `100% · ${record.totalPages}/${record.totalPages} pages${suffix}`, tag: `komga-download-${record.bookId}`}
    await this.deliverNotification(`Downloaded ${record.book.seriesTitle}`, options)
  }

  private async showDownloadProgressNotification(record: OfflineDownloadRecord, force: boolean = false): Promise<void> {
    if (!this.state.preferences.notifyWhenComplete || !('Notification' in window) || Notification.permission !== 'granted') return
    const percent = record.totalPages ? Math.floor(record.completedPages / record.totalPages * 100) : 0
    const previous = this.notifiedProgress.get(record.bookId) ?? -10
    if (!force && percent < 100 && percent - previous < 5) return
    this.notifiedProgress.set(record.bookId, percent)
    const remaining = this.remainingDownloadCount(record.bookId)
    const suffix = remaining > 0 ? ` · ${remaining} book${remaining === 1 ? '' : 's'} remaining` : ''
    const options = {
      body: `${percent}% · ${record.completedPages}/${record.totalPages} pages${suffix}`,
      tag: `komga-download-${record.bookId}`,
      renotify: false,
      silent: true,
    }
    const title = `Downloading ${record.book.seriesTitle}`
    await this.deliverNotification(title, options)
  }

  private async deliverNotification(title: string, options: NotificationOptions): Promise<boolean> {
    try {
      const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready : undefined
      if (registration) await registration.showNotification(title, options)
      else new Notification(title, options)
      return true
    } catch (_) {
      return false
    }
  }

  async testDownloadNotification(): Promise<boolean> {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false
    return this.deliverNotification('Komga download notifications', {
      body: 'Notifications are working on this device.',
      tag: 'komga-download-test',
    })
  }

  private async persistDownloadProgress(record: OfflineDownloadRecord): Promise<void> {
    const now = Date.now()
    const previous = this.persistedProgressAt.get(record.bookId) || 0
    if (record.completedPages < record.totalPages && now - previous < 500) return
    this.persistedProgressAt.set(record.bookId, now)
    await this.updateDownload(record)
  }

  private remainingDownloadCount(excludeBookId?: string): number {
    return this.state.downloads.filter(item => item.bookId !== excludeBookId &&
      ['queued', 'downloading', 'updating'].includes(item.status)).length
  }

  async removeDownload(bookId: string): Promise<void> {
    await this.ready
    const record = this.getDownload(bookId)
    if (this.activeJobs.has(bookId)) this.cancelledJobs.add(bookId)
    this.activeJobs.get(bookId)?.abort()
    if (record?.cacheName) await caches.delete(record.cacheName)
    await offlineDelete(OFFLINE_STORES.downloads, bookId)
    this.state.downloads = this.state.downloads.filter(x => x.bookId !== bookId)
    this.notifyServiceWorker(bookId)
    // Metadata deliberately remains. Removing a download removes only media.
  }

  async updateReadProgress(bookId: string, progress: ReadProgressUpdateDto): Promise<void> {
    await this.ready
    const activeDownload = this.getDownload(bookId)
    const fromOfflineSnapshot = (this.state.offlineMode || !this.state.online) && !!activeDownload?.cacheName
    const queued: QueuedProgress = {
      bookId,
      progress: clone(progress),
      updatedAt: new Date().toISOString(),
      pending: true,
      revision: fromOfflineSnapshot ? activeDownload?.manifestRevision : undefined,
    }
    await offlinePut(OFFLINE_STORES.progress, queued)

    if (progress.completed === true) await this.handleCompletedDownload(bookId)

    if (!this.state.online || this.state.offlineMode) return
    try {
      await this.http.patch(`/api/v1/books/${bookId}/read-progress`, progress)
      queued.pending = false
      await offlinePut(OFFLINE_STORES.progress, queued)
    } catch (_) {
      // Remains queued and is retried after catalog/revision reconciliation.
    }
  }

  private async handleCompletedDownload(bookId: string): Promise<void> {
    const completed = this.getDownload(bookId)
    if (!completed?.cacheName) return
    const preferences = this.state.preferences
    if (!preferences.removeRead && !preferences.autoDownloadNext) return

    const siblings = (await this.getCachedBooksPage({condition: {seriesId: {operator: 'is', value: completed.book.seriesId}}},
      {unpaged: true, sort: ['metadata.numberSort']})).content
    const downloaded = siblings.filter(book => this.isDownloaded(book.id))
    // Smart rotation is deliberately conservative: it starts only when this
    // device already has a two-book reading buffer for the series.
    if (downloaded.length < 2) return
    const index = siblings.findIndex(book => book.id === bookId)
    const next = siblings.slice(index + 1).find(book => !this.isDownloaded(book.id))
    if (preferences.removeRead) await this.removeDownload(bookId)
    if (preferences.autoDownloadNext && next) {
      if (this.state.online && !this.state.offlineMode) await this.downloadBook(next.id, true)
      else await this.queueBook(next, true)
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
          const outgoing = clone(entry.progress)
          const download = this.getDownload(entry.bookId)
          if (outgoing.page && entry.revision && download?.manifestRevision === entry.revision &&
            download.updateAvailable && download.remotePages?.length) {
            const oldPages = await this.getCachedPages(entry.bookId) || []
            outgoing.page = remapPage(oldPages, download.remotePages, outgoing.page)
          }

          await this.http.patch(`/api/v1/books/${entry.bookId}/read-progress`, outgoing)
          entry.pending = false
          await offlinePut(OFFLINE_STORES.progress, entry)
        } catch (_) {
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
