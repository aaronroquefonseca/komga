import _Vue from 'vue'
import {BookDto, PageDto, ReadProgressUpdateDto} from '@/types/komga-books'
import {BookSearch, SearchConditionSeriesId, SearchOperatorIs, SeriesSearch} from '@/types/komga-search'
import {GroupCountDto, SeriesDto} from '@/types/komga-series'
import {UserDto} from '@/types/komga-users'
import {LibraryDto} from '@/types/komga-libraries'
import {NameValue} from '@/types/filter'
import {handleDates} from '@/plugins/http.plugin'
import {OFFLINE_STORES, offlineDelete, offlineGet, offlinePut} from '@/services/offline-db'

export const OFFLINE_SESSION_KEY = 'sessionUser'
export const OFFLINE_LIBRARIES_KEY = 'libraries'

interface CachedSetting<T> {
  key: string
  value: T
}

function rehydrate<T>(value: T): T {
  handleDates(value)
  return value
}

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter(value => value !== undefined && value !== null && value !== '') as T[]))
}

export async function getOfflineSessionUser(): Promise<UserDto | undefined> {
  const cached = await offlineGet<CachedSetting<UserDto>>(OFFLINE_STORES.settings, OFFLINE_SESSION_KEY)
  return cached?.value ? rehydrate(cached.value) : undefined
}

export async function getOfflineLibraries(): Promise<LibraryDto[]> {
  const cached = await offlineGet<CachedSetting<LibraryDto[]>>(OFFLINE_STORES.settings, OFFLINE_LIBRARIES_KEY)
  return cached?.value ? rehydrate(cached.value) : []
}

export default {
  install(Vue: typeof _Vue) {
    const offline = Vue.prototype.$offline
    const books = Vue.prototype.$komgaBooks as any
    const series = Vue.prototype.$komgaSeries as any
    const users = Vue.prototype.$komgaUsers as any
    const libraries = Vue.prototype.$komgaLibraries as any
    const referential = Vue.prototype.$komgaReferential as any
    if (!offline || !books || !series || books.__offlineAdapterInstalled) return
    books.__offlineAdapterInstalled = true

    const localOnly = () => offline.state.offlineMode || !offline.state.online

    const cachedSeriesForLibraries = async (libraryIds?: string[]): Promise<SeriesDto[]> => {
      const page = await offline.getCachedSeriesPage({}, {unpaged: true})
      const items = page.content as SeriesDto[]
      return libraryIds?.length ? items.filter(item => libraryIds.includes(item.libraryId)) : items
    }

    const cachedBooksForLibraries = async (libraryIds?: string[]): Promise<BookDto[]> => {
      const page = await offline.getCachedBooksPage({}, {unpaged: true})
      const items = page.content as BookDto[]
      return libraryIds?.length ? items.filter(item => libraryIds.includes(item.libraryId)) : items
    }

    if (users && !users.__offlineAdapterInstalled) {
      users.__offlineAdapterInstalled = true
      const originalGetMe = users.getMe.bind(users)
      const originalGetMeWithAuth = users.getMeWithAuth.bind(users)
      const originalLogout = users.logout.bind(users)

      users.getMe = async (): Promise<UserDto> => {
        if (localOnly()) {
          const cached = await getOfflineSessionUser()
          if (cached) return cached
          throw new Error('No authenticated Komga session has been cached for offline use')
        }
        try {
          const user = await originalGetMe()
          await offlinePut(OFFLINE_STORES.settings, {key: OFFLINE_SESSION_KEY, value: user} as CachedSetting<UserDto>)
          return user
        } catch (e) {
          const cached = await getOfflineSessionUser()
          if (cached) return cached
          throw e
        }
      }

      users.getMeWithAuth = async (login: string, password: string, rememberMe: boolean): Promise<UserDto> => {
        const user = await originalGetMeWithAuth(login, password, rememberMe)
        await offlinePut(OFFLINE_STORES.settings, {key: OFFLINE_SESSION_KEY, value: user} as CachedSetting<UserDto>)
        return user
      }

      users.logout = async (): Promise<void> => {
        try {
          await originalLogout()
        } finally {
          await offlineDelete(OFFLINE_STORES.settings, OFFLINE_SESSION_KEY)
        }
      }
    }

    if (libraries && !libraries.__offlineAdapterInstalled) {
      libraries.__offlineAdapterInstalled = true
      const originalGetLibraries = libraries.getLibraries.bind(libraries)
      const originalGetLibrary = libraries.getLibrary.bind(libraries)

      libraries.getLibraries = async (): Promise<LibraryDto[]> => {
        if (localOnly()) return getOfflineLibraries()
        try {
          const items = await originalGetLibraries()
          await offlinePut(OFFLINE_STORES.settings, {key: OFFLINE_LIBRARIES_KEY, value: items} as CachedSetting<LibraryDto[]>)
          return items
        } catch (e) {
          const cached = await getOfflineLibraries()
          if (cached.length > 0) return cached
          throw e
        }
      }

      libraries.getLibrary = async (libraryId: string): Promise<LibraryDto> => {
        if (localOnly()) {
          const item = (await getOfflineLibraries()).find(x => x.id === libraryId)
          if (item) return item
          throw new Error('Library is not available in the offline catalog')
        }
        try {
          return await originalGetLibrary(libraryId)
        } catch (e) {
          const item = (await getOfflineLibraries()).find(x => x.id === libraryId)
          if (item) return item
          throw e
        }
      }
    }

    const originalGetBook = books.getBook.bind(books)
    books.getBook = async (bookId: string): Promise<BookDto> => {
      if (localOnly()) {
        const cached = await offline.getCachedBook(bookId)
        if (cached) return rehydrate(cached)
        throw new Error('This book is not available in the offline catalog')
      }
      try {
        const book = await originalGetBook(bookId)
        await offline.cacheBook(book)
        return book
      } catch (e) {
        const cached = await offline.getCachedBook(bookId)
        if (cached) return rehydrate(cached)
        throw e
      }
    }

    const originalGetBookPages = books.getBookPages.bind(books)
    books.getBookPages = async (bookId: string): Promise<PageDto[]> => {
      if (localOnly()) {
        const cached = await offline.getCachedPages(bookId)
        if (cached) return rehydrate(cached)
        throw new Error('Page metadata for this book is not available offline')
      }
      try {
        const pages = await originalGetBookPages(bookId)
        await offline.cachePages(bookId, pages)
        return pages
      } catch (e) {
        const cached = await offline.getCachedPages(bookId)
        if (cached) return rehydrate(cached)
        throw e
      }
    }

    const originalGetBooksList = books.getBooksList.bind(books)
    books.getBooksList = async (search: BookSearch, pageRequest?: PageRequest): Promise<Page<BookDto>> => {
      if (localOnly()) return rehydrate(await offline.getCachedBooksPage(search, pageRequest))
      try {
        const page = await originalGetBooksList(search, pageRequest)
        await offline.cacheBooks(page.content || [])
        return page
      } catch (e) {
        const cached = rehydrate(await offline.getCachedBooksPage(search, pageRequest))
        if (cached.totalElements > 0) return cached
        throw e
      }
    }

    const originalGetBooksOnDeck = books.getBooksOnDeck.bind(books)
    books.getBooksOnDeck = async (libraryIds?: string[], pageRequest?: PageRequest): Promise<Page<BookDto>> => {
      if (localOnly()) return rehydrate(await offline.getCachedOnDeck(libraryIds, pageRequest))
      try {
        const page = await originalGetBooksOnDeck(libraryIds, pageRequest)
        await offline.cacheBooks(page.content || [])
        return page
      } catch (e) {
        const cached = rehydrate(await offline.getCachedOnDeck(libraryIds, pageRequest))
        if (cached.totalElements > 0) return cached
        throw e
      }
    }

    const cachedSibling = async (bookId: string, delta: number): Promise<BookDto> => {
      const current = await offline.getCachedBook(bookId)
      if (!current) throw new Error('Book is not available in the offline catalog')
      rehydrate(current)
      const siblings = rehydrate(await offline.getCachedBooksPage({
        condition: new SearchConditionSeriesId(new SearchOperatorIs(current.seriesId)),
      }, {unpaged: true, sort: ['metadata.numberSort']}))
      const index = siblings.content.findIndex((x: BookDto) => x.id === bookId)
      const sibling = siblings.content[index + delta]
      if (!sibling) throw new Error('No sibling book available offline')
      return sibling
    }

    const originalNext = books.getBookSiblingNext.bind(books)
    books.getBookSiblingNext = async (bookId: string): Promise<BookDto> => {
      if (localOnly()) return cachedSibling(bookId, 1)
      try {
        const book = await originalNext(bookId)
        await offline.cacheBook(book)
        return book
      } catch (e) {
        try { return await cachedSibling(bookId, 1) } catch (_) { throw e }
      }
    }

    const originalPrevious = books.getBookSiblingPrevious.bind(books)
    books.getBookSiblingPrevious = async (bookId: string): Promise<BookDto> => {
      if (localOnly()) return cachedSibling(bookId, -1)
      try {
        const book = await originalPrevious(bookId)
        await offline.cacheBook(book)
        return book
      } catch (e) {
        try { return await cachedSibling(bookId, -1) } catch (_) { throw e }
      }
    }

    books.updateReadProgress = async (bookId: string, progress: ReadProgressUpdateDto): Promise<void> => {
      await offline.updateReadProgress(bookId, progress)
    }

    const originalGetOneSeries = series.getOneSeries.bind(series)
    series.getOneSeries = async (seriesId: string): Promise<SeriesDto> => {
      if (localOnly()) {
        const cached = await offline.getCachedSeries(seriesId)
        if (cached) return rehydrate(cached)
        throw new Error('This series is not available in the offline catalog')
      }
      try {
        const item = await originalGetOneSeries(seriesId)
        await offline.cacheSeriesItem(item)
        return item
      } catch (e) {
        const cached = await offline.getCachedSeries(seriesId)
        if (cached) return rehydrate(cached)
        throw e
      }
    }

    const originalGetSeriesList = series.getSeriesList.bind(series)
    series.getSeriesList = async (search: SeriesSearch, pageRequest?: PageRequest): Promise<Page<SeriesDto>> => {
      if (localOnly()) return rehydrate(await offline.getCachedSeriesPage(search, pageRequest))
      try {
        const page = await originalGetSeriesList(search, pageRequest)
        await offline.cacheSeries(page.content || [])
        return page
      } catch (e) {
        const cached = rehydrate(await offline.getCachedSeriesPage(search, pageRequest))
        if (cached.totalElements > 0) return cached
        throw e
      }
    }

    const localAlphabeticalGroups = async (search: SeriesSearch): Promise<GroupCountDto[]> => {
      const page = await offline.getCachedSeriesPage(search, {unpaged: true})
      const groups = new Map<string, number>()
      ;(page.content as SeriesDto[]).forEach(item => {
        const title = `${item.metadata?.titleSort || item.metadata?.title || item.name || ''}`.trim().toLocaleLowerCase()
        if (!title) return
        const group = title.charAt(0)
        groups.set(group, (groups.get(group) || 0) + 1)
      })
      return Array.from(groups.entries()).map(([group, count]) => ({group, count}))
    }

    const originalGetSeriesListByAlphabeticalGroups = series.getSeriesListByAlphabeticalGroups.bind(series)
    series.getSeriesListByAlphabeticalGroups = async (search: SeriesSearch): Promise<GroupCountDto[]> => {
      if (localOnly()) return localAlphabeticalGroups(search)
      try {
        return await originalGetSeriesListByAlphabeticalGroups(search)
      } catch (e) {
        const cached = await localAlphabeticalGroups(search)
        if (cached.length > 0) return cached
        throw e
      }
    }

    if (referential && !referential.__offlineAdapterInstalled) {
      referential.__offlineAdapterInstalled = true

      const wrapStringList = (methodName: string, local: (...args: any[]) => Promise<string[]>) => {
        const original = referential[methodName].bind(referential)
        referential[methodName] = async (...args: any[]): Promise<string[]> => {
          if (localOnly()) return local(...args)
          try {
            return await original(...args)
          } catch (e) {
            const cached = await local(...args)
            if (cached.length > 0) return cached
            throw e
          }
        }
      }

      wrapStringList('getGenres', async (libraryIds?: string[]) => {
        const items = await cachedSeriesForLibraries(libraryIds)
        return uniqueValues(items.flatMap(item => item.metadata?.genres || []))
      })

      wrapStringList('getSeriesAndBookTags', async (libraryIds?: string[]) => {
        const [seriesItems, bookItems] = await Promise.all([
          cachedSeriesForLibraries(libraryIds),
          cachedBooksForLibraries(libraryIds),
        ])
        return uniqueValues([
          ...seriesItems.flatMap(item => item.metadata?.tags || []),
          ...bookItems.flatMap(item => item.metadata?.tags || []),
        ])
      })

      wrapStringList('getPublishers', async (libraryIds?: string[]) => {
        const items = await cachedSeriesForLibraries(libraryIds)
        return uniqueValues(items.map(item => item.metadata?.publisher))
      })

      wrapStringList('getAgeRatings', async (libraryIds?: string[]) => {
        const items = await cachedSeriesForLibraries(libraryIds)
        return uniqueValues(items.map(item => item.metadata?.ageRating).filter(value => value !== undefined).map(value => `${value}`))
      })

      wrapStringList('getSeriesReleaseDates', async (libraryIds?: string[]) => {
        const items = await cachedSeriesForLibraries(libraryIds)
        return uniqueValues(items.map(item => item.booksMetadata?.releaseDate))
      })

      wrapStringList('getSharingLabels', async (libraryIds?: string[]) => {
        const items = await cachedSeriesForLibraries(libraryIds)
        return uniqueValues(items.flatMap(item => item.metadata?.sharingLabels || []))
      })

      const originalGetLanguages = referential.getLanguages.bind(referential)
      const localLanguages = async (libraryIds?: string[]): Promise<NameValue[]> => {
        const items = await cachedSeriesForLibraries(libraryIds)
        return uniqueValues(items.map(item => item.metadata?.language)).map(code => ({name: code, value: code}))
      }
      referential.getLanguages = async (libraryIds?: string[], collectionId?: string): Promise<NameValue[]> => {
        if (localOnly()) return localLanguages(libraryIds)
        try {
          return await originalGetLanguages(libraryIds, collectionId)
        } catch (e) {
          const cached = await localLanguages(libraryIds)
          if (cached.length > 0) return cached
          throw e
        }
      }
    }
  },
}
