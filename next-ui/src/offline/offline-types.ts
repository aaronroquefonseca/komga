import type {
  BookDto,
  BookSearch,
  PageDto,
  ReadProgressUpdateDto,
  SeriesSearch,
} from '@/generated/openapi'

export const OFFLINE_BOOK_CACHE_PREFIX = 'komga-offline-book-v2-'

export const OFFLINE_SESSION_KEY = 'sessionUser'
export const OFFLINE_LIBRARIES_KEY = 'libraries'

export type OfflineDownloadStatus =
  'queued' | 'downloading' | 'updating' | 'downloaded' | 'paused' | 'error'

export interface OfflineDownloadPreferences {
  concurrentBooks: number
  concurrentPages: number
  notifyWhenComplete: boolean
  removeRead: boolean
  autoDownloadNext: boolean
}

export const DEFAULT_DOWNLOAD_PREFERENCES: OfflineDownloadPreferences = {
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
  notificationGroupId?: string
}

export interface CachedPages {
  bookId: string
  pages: PageDto[]
  cachedAt: string
}

export interface QueuedProgress {
  bookId: string
  progress: ReadProgressUpdateDto
  updatedAt: string
  pending: boolean
  revision?: string
}

export interface OfflineSetting<T> {
  key: string
  value: T
}

export type OfflineBookSearch = BookSearch
export type OfflineSeriesSearch = SeriesSearch

/**
 * Paging input accepted by the offline getters. Structurally compatible with
 * the {@link PageRequest} class and with plain `{ page, size, sort, unpaged }`
 * objects, so callers can pass either through.
 */
export interface OfflinePageRequest {
  page?: number
  size?: number
  sort?: Array<string | { key: string; order?: string }>
  unpaged?: boolean
}

/**
 * In-memory page built from cached rows. All fields are populated, so it is
 * assignable to the generated `PageBookDto` / `PageSeriesDto` / `PageString`
 * response types the UI already consumes.
 */
export interface OfflinePage<T> {
  content: T[]
  totalElements: number
  totalPages: number
  number: number
  size: number
  first: boolean
  last: boolean
  empty: boolean
  numberOfElements: number
}
