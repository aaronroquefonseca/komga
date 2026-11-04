import { offlineAccountToken, assertOfflineAccount } from './offline-db'
import {
  komgaGetAgeRatings,
  komgaGetBookById,
  komgaGetBookPages,
  komgaGetBookSiblingNext,
  komgaGetBookSiblingPrevious,
  komgaGetBooks,
  komgaGetBooksOnDeck,
  komgaGetCollectionsBySeriesId,
  komgaGetCurrentUser,
  komgaGetGenres,
  komgaGetLanguages,
  komgaGetLibraries,
  komgaGetLibraryById,
  komgaGetPublishers,
  komgaGetSeries,
  komgaGetSeriesUpdated,
  komgaGetSeriesAlphabeticalGroups,
  komgaGetSeriesById,
  komgaGetSeriesReleaseYears,
  komgaGetSharingLabels,
  komgaGetTags,
  type BookDto,
  type BookSearch,
  type CollectionDto,
  type GroupCountDto,
  type LibraryDto,
  type PageBookDto,
  type PageDto,
  type PageInteger,
  type PageSeriesDto,
  type PageString,
  type SeriesDto,
  type SeriesSearch,
  type UserDto,
} from '@/generated/openapi'
import { isApiErrorWithCause } from '@/api/komga-client'
import { OFFLINE_STORES } from './offline-db'
import { offlineDelete, offlineGet, offlinePut, notifyOfflineAccountChanged } from './offline-db'
import { OFFLINE_LIBRARIES_KEY, OFFLINE_SESSION_KEY } from './offline-types'
import type { OfflinePageRequest, OfflineSetting } from './offline-types'
import { useOfflineLibraryStore } from './offline-store'
import {
  conditionUsesOnlyLibrarySelection,
  libraryIdsFromCondition,
  pageFromItems,
  rehydrateDates,
  uniqueStrings,
} from './offline-utils'

/**
 * Cache-first readers. Faithful port of the classic
 * `offline-komga-adapter.plugin.ts` fallback pattern to the generated fetch
 * SDK:
 *
 * - when `offlineMode || !online`, serve exclusively from the on-device cache;
 * - otherwise try the network, persist the result to the cache, and fall back
 *   to the cache on failure (when cached data exists).
 *
 * Read-progress writes always go through
 * `useOfflineLibraryStore().updateReadProgress`, which queues them for replay.
 */

function isLocalOnly(): boolean {
  if (typeof navigator === 'undefined') return false
  const store = useOfflineLibraryStore()
  return store.offlineMode || !store.online
}

function toQueryPaging(pageRequest?: OfflinePageRequest): {
  page?: number
  size?: number
  sort?: string[]
  unpaged?: boolean
} {
  if (!pageRequest) return {}
  const sort = pageRequest.sort?.map((entry) =>
    typeof entry === 'string' ? entry : entry.order ? `${entry.key},${entry.order}` : entry.key,
  )
  return { page: pageRequest.page, size: pageRequest.size, sort, unpaged: pageRequest.unpaged }
}

export async function getOfflineSessionUser(): Promise<UserDto | undefined> {
  const cached = await offlineGet<OfflineSetting<UserDto>>(
    OFFLINE_STORES.settings,
    OFFLINE_SESSION_KEY,
  )
  return cached?.value ? rehydrateDates(cached.value) : undefined
}

/** Cache the authenticated user after login so offline mode can identify the session. */
export async function cacheSessionUser(user: UserDto): Promise<void> {
  await useOfflineLibraryStore().activateAccount(user)
}

/** Drop the cached session, e.g. on logout. */
export async function clearCachedSessionUser(): Promise<void> {
  const existing = await offlineGet(OFFLINE_STORES.settings, OFFLINE_SESSION_KEY)
  await offlineDelete(OFFLINE_STORES.settings, OFFLINE_SESSION_KEY)
  if (existing) notifyOfflineAccountChanged()
}

export async function getOfflineLibraries(): Promise<LibraryDto[]> {
  const cached = await offlineGet<OfflineSetting<LibraryDto[]>>(
    OFFLINE_STORES.settings,
    OFFLINE_LIBRARIES_KEY,
  )
  return cached?.value ? rehydrateDates(cached.value) : []
}

/** Persist libraries after a successful online fetch. */
export async function cacheOfflineLibraries(items: LibraryDto[]): Promise<void> {
  await offlinePut(OFFLINE_STORES.settings, { key: OFFLINE_LIBRARIES_KEY, value: items })
}

async function allCachedSeries(): Promise<SeriesDto[]> {
  const store = useOfflineLibraryStore()
  return (await store.getCachedSeriesPage({}, { unpaged: true })).content
}

async function allCachedBooks(): Promise<BookDto[]> {
  const store = useOfflineLibraryStore()
  return (await store.getCachedBooksPage({}, { unpaged: true })).content
}

async function cachedSeriesForLibraries(libraryIds?: string[]): Promise<SeriesDto[]> {
  const items = await allCachedSeries()
  if (!libraryIds?.length) return items

  // Normally SeriesDto.libraryId is enough. Cached books provide a second,
  // independent membership index so an incomplete/stale series row cannot
  // make an otherwise-cached library appear empty.
  const bookItems = await allCachedBooks()
  const seriesIdsFromBooks = new Set(
    bookItems.filter((item) => libraryIds.includes(item.libraryId)).map((item) => item.seriesId),
  )
  return items.filter(
    (item) => libraryIds.includes(item.libraryId) || seriesIdsFromBooks.has(item.id),
  )
}

async function cachedBooksForLibraries(libraryIds?: string[]): Promise<BookDto[]> {
  const items = await allCachedBooks()
  return libraryIds?.length ? items.filter((item) => libraryIds.includes(item.libraryId)) : items
}

async function localSeriesPage(
  search: SeriesSearch = {},
  pageRequest?: OfflinePageRequest,
): Promise<PageSeriesDto> {
  const store = useOfflineLibraryStore()
  const normal = await store.getCachedSeriesPage(search, pageRequest)
  if (normal.totalElements > 0 || !conditionUsesOnlyLibrarySelection(search.condition))
    return normal

  const libraryIds = libraryIdsFromCondition(search.condition)
  if (libraryIds.length === 0) return normal

  const recovered = await cachedSeriesForLibraries(libraryIds)
  return rehydrateDates(pageFromItems(recovered, pageRequest))
}

export async function getBookOfflineFirst(bookId: string): Promise<BookDto> {
  const accountToken = offlineAccountToken()

  const store = useOfflineLibraryStore()
  await store.whenReady()
  if (store.getDownload(bookId)?.cacheName) {
    const snapshot = await store.getCachedBook(bookId)
    if (snapshot) return snapshot
  }
  if (isLocalOnly()) {
    const cached = await store.getCachedBook(bookId)
    if (cached) return cached
    throw new Error('This book is not available in the offline catalog')
  }
  try {
    const book = await komgaGetBookById({ path: { bookId } })
    assertOfflineAccount(accountToken)

    await store.cacheBook(book).catch(() => undefined)
    return book
  } catch (e) {
    const cached = await store.getCachedBook(bookId)
    if (cached) return cached
    throw e
  }
}

export async function getBookPagesOfflineFirst(bookId: string): Promise<PageDto[]> {
  const accountToken = offlineAccountToken()

  const store = useOfflineLibraryStore()
  await store.whenReady()
  if (store.getDownload(bookId)?.cacheName) {
    const snapshot = await store.getCachedPages(bookId)
    if (snapshot) return snapshot
  }
  if (isLocalOnly()) {
    const cached = await store.getCachedPages(bookId)
    if (cached) return cached
    throw new Error('Page metadata for this book is not available offline')
  }
  try {
    const pages = (await komgaGetBookPages({ path: { bookId } })) ?? []
    assertOfflineAccount(accountToken)

    await store.cachePages(bookId, pages).catch(() => undefined)
    return pages
  } catch (e) {
    const cached = await store.getCachedPages(bookId)
    if (cached) return cached
    throw e
  }
}

export async function getBooksListOfflineFirst(
  search: BookSearch,
  pageRequest?: OfflinePageRequest,
): Promise<PageBookDto> {
  const accountToken = offlineAccountToken()

  const store = useOfflineLibraryStore()
  if (isLocalOnly()) return store.getCachedBooksPage(search, pageRequest)
  try {
    const page = await komgaGetBooks({ body: search, query: toQueryPaging(pageRequest) })
    assertOfflineAccount(accountToken)

    await store.cacheBooks(page.content ?? []).catch(() => undefined)
    return rehydrateDates(page)
  } catch (e) {
    const cached = await store.getCachedBooksPage(search, pageRequest)
    if ((cached.totalElements ?? 0) > 0) return cached
    throw e
  }
}

export async function getBooksOnDeckOfflineFirst(
  libraryIds?: string[],
  pageRequest?: OfflinePageRequest,
): Promise<PageBookDto> {
  const accountToken = offlineAccountToken()

  const store = useOfflineLibraryStore()
  if (isLocalOnly()) return store.getCachedOnDeck(libraryIds, pageRequest)
  try {
    const page = await komgaGetBooksOnDeck({
      query: { library_id: libraryIds, page: pageRequest?.page, size: pageRequest?.size },
    })
    assertOfflineAccount(accountToken)

    await store.cacheBooks(page.content ?? []).catch(() => undefined)
    return rehydrateDates(page)
  } catch (e) {
    const cached = await store.getCachedOnDeck(libraryIds, pageRequest)
    if ((cached.totalElements ?? 0) > 0) return cached
    throw e
  }
}

async function cachedSibling(bookId: string, delta: 1 | -1): Promise<BookDto> {
  const store = useOfflineLibraryStore()
  const current = await store.getCachedBook(bookId)
  if (!current) throw new Error('Book is not available in the offline catalog')
  const siblings = (
    await store.getCachedBooksPage(
      { condition: { seriesId: { operator: 'is', value: current.seriesId } } },
      { unpaged: true, sort: ['metadata.numberSort'] },
    )
  ).content
  const index = siblings.findIndex((x) => x.id === bookId)
  const sibling = siblings[index + delta]
  if (!sibling) throw new Error('No sibling book available offline')
  return sibling
}

export async function getBookSiblingOfflineFirst(bookId: string, delta: 1 | -1): Promise<BookDto> {
  const store = useOfflineLibraryStore()
  const fetcher =
    delta === 1
      ? () => komgaGetBookSiblingNext({ path: { bookId } })
      : () => komgaGetBookSiblingPrevious({ path: { bookId } })
  if (isLocalOnly()) return cachedSibling(bookId, delta)
  try {
    const book = await fetcher()
    await store.cacheBook(book).catch(() => undefined)
    return book
  } catch (e) {
    try {
      return await cachedSibling(bookId, delta)
    } catch {
      throw e
    }
  }
}

export async function getSeriesOfflineFirst(seriesId: string): Promise<SeriesDto> {
  const accountToken = offlineAccountToken()

  const store = useOfflineLibraryStore()
  if (isLocalOnly()) {
    const cached = await store.getCachedSeries(seriesId)
    if (cached) return cached
    throw new Error('This series is not available in the offline catalog')
  }
  try {
    const series = await komgaGetSeriesById({ path: { seriesId } })
    assertOfflineAccount(accountToken)

    await store.cacheSeriesItem(series).catch(() => undefined)
    return series
  } catch (e) {
    const cached = await store.getCachedSeries(seriesId)
    if (cached) return cached
    throw e
  }
}

export async function getSeriesListOfflineFirst(
  search: SeriesSearch,
  pageRequest?: OfflinePageRequest,
): Promise<PageSeriesDto> {
  const accountToken = offlineAccountToken()

  const store = useOfflineLibraryStore()
  if (isLocalOnly()) return localSeriesPage(search, pageRequest)
  try {
    const page = await komgaGetSeries({ body: search, query: toQueryPaging(pageRequest) })
    assertOfflineAccount(accountToken)

    await store.cacheSeries(page.content ?? []).catch(() => undefined)
    return rehydrateDates(page)
  } catch (e) {
    const cached = await localSeriesPage(search, pageRequest)
    if ((cached.totalElements ?? 0) > 0) return cached
    throw e
  }
}

export async function getSeriesAlphabeticalGroupsOfflineFirst(
  search: SeriesSearch,
): Promise<GroupCountDto[]> {
  if (isLocalOnly()) return localAlphabeticalGroups(search)
  try {
    return (await komgaGetSeriesAlphabeticalGroups({ body: search })) ?? []
  } catch (e) {
    const cached = await localAlphabeticalGroups(search)
    if (cached.length > 0) return cached
    throw e
  }
}

async function localAlphabeticalGroups(search: SeriesSearch): Promise<GroupCountDto[]> {
  const page = await localSeriesPage(search, { unpaged: true })
  const groups = new Map<string, number>()
  ;(page.content ?? []).forEach((item) => {
    const title = `${item.metadata?.titleSort || item.metadata?.title || item.name || ''}`
      .trim()
      .toLocaleLowerCase()
    if (!title) return
    const group = title.charAt(0)
    groups.set(group, (groups.get(group) ?? 0) + 1)
  })
  return Array.from(groups.entries()).map(([group, count]) => ({ group, count }))
}

export async function getCollectionsBySeriesOfflineFirst(
  seriesId: string,
): Promise<CollectionDto[]> {
  if (isLocalOnly()) return []
  try {
    return (await komgaGetCollectionsBySeriesId({ path: { seriesId } })) ?? []
  } catch (e) {
    if (!useOfflineLibraryStore().online) return []
    throw e
  }
}

export async function getLibrariesOfflineFirst(): Promise<LibraryDto[]> {
  const accountToken = offlineAccountToken()

  if (isLocalOnly()) return getOfflineLibraries()
  try {
    const libraries = (await komgaGetLibraries()) ?? []
    assertOfflineAccount(accountToken)

    await cacheOfflineLibraries(libraries).catch(() => undefined)
    return libraries
  } catch (e) {
    const cached = await getOfflineLibraries()
    if (cached.length > 0) return cached
    throw e
  }
}

export async function getLibraryOfflineFirst(libraryId: string): Promise<LibraryDto> {
  if (isLocalOnly()) {
    const item = (await getOfflineLibraries()).find((x) => x.id === libraryId)
    if (item) return item
    throw new Error('Library is not available in the offline catalog')
  }
  try {
    return await komgaGetLibraryById({ path: { libraryId } })
  } catch (e) {
    const item = (await getOfflineLibraries()).find((x) => x.id === libraryId)
    if (item) return item
    throw e
  }
}

export async function getSessionUserOfflineFirst(): Promise<UserDto | undefined> {
  const accountToken = offlineAccountToken()

  await useOfflineLibraryStore()
    .whenReady()
    .catch(() => undefined)
  if (isLocalOnly()) return getOfflineSessionUser()
  try {
    const user = await komgaGetCurrentUser()
    assertOfflineAccount(accountToken)

    await cacheSessionUser(user).catch(() => undefined)
    return user
  } catch (error) {
    assertOfflineAccount(accountToken)
    if (isApiErrorWithCause(error) && [401, 403].includes(error.cause.status)) {
      await clearCachedSessionUser()
      throw error
    }
    return getOfflineSessionUser()
  }
}

async function stringListOfflineFirst(
  network: () => Promise<PageString>,
  local: () => Promise<string[]>,
): Promise<PageString> {
  if (isLocalOnly()) {
    const items = await local()
    return pageFromItems(items, { unpaged: true })
  }
  try {
    return await network()
  } catch (e) {
    const items = await local()
    if (items.length > 0) return pageFromItems(items, { unpaged: true })
    throw e
  }
}

export function getGenresOfflineFirst(libraryIds?: string[]): Promise<PageString> {
  return stringListOfflineFirst(
    async () =>
      (await komgaGetGenres({ query: { library_id: libraryIds } })) ??
      pageFromItems([], { unpaged: true }),
    async () =>
      uniqueStrings(
        (await cachedSeriesForLibraries(libraryIds)).flatMap((item) => item.metadata?.genres ?? []),
      ),
  )
}

export function getSeriesAndBookTagsOfflineFirst(libraryIds?: string[]): Promise<PageString> {
  return stringListOfflineFirst(
    async () =>
      (await komgaGetTags({ query: { library_id: libraryIds } })) ??
      pageFromItems([], { unpaged: true }),
    async () => {
      const [seriesItems, bookItems] = await Promise.all([
        cachedSeriesForLibraries(libraryIds),
        cachedBooksForLibraries(libraryIds),
      ])
      return uniqueStrings([
        ...seriesItems.flatMap((item) => item.metadata?.tags ?? []),
        ...bookItems.flatMap((item) => item.metadata?.tags ?? []),
      ])
    },
  )
}

export function getPublishersOfflineFirst(libraryIds?: string[]): Promise<PageString> {
  return stringListOfflineFirst(
    async () =>
      (await komgaGetPublishers({ query: { library_id: libraryIds } })) ??
      pageFromItems([], { unpaged: true }),
    async () =>
      uniqueStrings(
        (await cachedSeriesForLibraries(libraryIds)).map((item) => item.metadata?.publisher),
      ),
  )
}

export function getAgeRatingsOfflineFirst(libraryIds?: string[]): Promise<PageInteger> {
  const accountToken = offlineAccountToken()

  const local = async (): Promise<number[]> => {
    const ratings = (await cachedSeriesForLibraries(libraryIds))
      .map((item) => item.metadata?.ageRating)
      .filter((x): x is number => x !== undefined)
    return Array.from(new Set(ratings))
  }
  const network = async (): Promise<PageInteger> =>
    (await komgaGetAgeRatings({ query: { library_id: libraryIds } })) ??
    pageFromItems([], { unpaged: true })
  assertOfflineAccount(accountToken)

  if (isLocalOnly()) return local().then((items) => pageFromItems(items, { unpaged: true }))
  return network().catch(async (e: unknown) => {
    const items = await local()
    if (items.length > 0) return pageFromItems(items, { unpaged: true })
    throw e
  })
}

export function getReleaseYearsOfflineFirst(libraryIds?: string[]): Promise<PageString> {
  return stringListOfflineFirst(
    async () =>
      (await komgaGetSeriesReleaseYears({ query: { library_id: libraryIds } })) ??
      pageFromItems([], { unpaged: true }),
    async () =>
      uniqueStrings(
        (await cachedSeriesForLibraries(libraryIds)).map((item) => {
          const releaseDate = item.booksMetadata?.releaseDate
          return releaseDate instanceof Date ? releaseDate.toISOString() : releaseDate
        }),
      ),
  )
}

export function getSharingLabelsOfflineFirst(libraryIds?: string[]): Promise<PageString> {
  return stringListOfflineFirst(
    async () =>
      (await komgaGetSharingLabels({ query: { library_id: libraryIds } })) ??
      pageFromItems([], { unpaged: true }),
    async () =>
      uniqueStrings(
        (await cachedSeriesForLibraries(libraryIds)).flatMap(
          (item) => item.metadata?.sharingLabels ?? [],
        ),
      ),
  )
}

export function getBookTagsOfflineFirst(
  seriesId?: string,
  libraryIds?: string[],
): Promise<PageString> {
  return stringListOfflineFirst(
    async () =>
      (await komgaGetTags({
        query: { series_id: seriesId ? [seriesId] : undefined, library_id: libraryIds },
      })) ?? pageFromItems([], { unpaged: true }),
    async () => {
      let items = await cachedBooksForLibraries(libraryIds)
      if (seriesId) items = items.filter((item) => item.seriesId === seriesId)
      return uniqueStrings(items.flatMap((item) => item.metadata?.tags ?? []))
    },
  )
}

export function getLanguagesOfflineFirst(libraryIds?: string[]): Promise<PageString> {
  return stringListOfflineFirst(
    async () =>
      (await komgaGetLanguages({ query: { library_id: libraryIds } })) ??
      pageFromItems([], { unpaged: true }),
    async () =>
      uniqueStrings(
        (await cachedSeriesForLibraries(libraryIds)).map((item) => item.metadata?.language),
      ),
  )
}

export async function getSeriesUpdatedOfflineFirst(
  libraryIds: string[] | undefined,
  pageRequest: OfflinePageRequest,
): Promise<PageSeriesDto> {
  const accountToken = offlineAccountToken()

  if (!isLocalOnly()) {
    try {
      const page = await komgaGetSeriesUpdated({
        query: { library_id: libraryIds, oneshot: false, ...toQueryPaging(pageRequest) },
      })
      assertOfflineAccount(accountToken)

      await useOfflineLibraryStore()
        .cacheSeries(page.content ?? [])
        .catch(() => undefined)
      return page
    } catch {
      /* Show the saved subset if the server is unavailable. */
    }
  }
  const items = (await cachedSeriesForLibraries(libraryIds)).filter((item) => !item.oneshot)
  return pageFromItems(items, { ...pageRequest, sort: ['lastModified,desc'] })
}
