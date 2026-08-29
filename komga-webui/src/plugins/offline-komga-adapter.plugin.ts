import _Vue from 'vue'
import {BookDto, PageDto, ReadProgressUpdateDto} from '@/types/komga-books'
import {BookSearch, SearchConditionSeriesId, SearchOperatorIs, SeriesSearch} from '@/types/komga-search'
import {SeriesDto} from '@/types/komga-series'
import {UserDto} from '@/types/komga-users'
import {handleDates} from '@/plugins/http.plugin'
import {OFFLINE_STORES, offlineDelete, offlineGet, offlinePut} from '@/services/offline-db'

export const OFFLINE_SESSION_KEY = 'sessionUser'

interface CachedSession {
  key: string
  value: UserDto
}

function rehydrate<T>(value: T): T {
  handleDates(value)
  return value
}

export async function getOfflineSessionUser(): Promise<UserDto | undefined> {
  const cached = await offlineGet<CachedSession>(OFFLINE_STORES.settings, OFFLINE_SESSION_KEY)
  return cached?.value ? rehydrate(cached.value) : undefined
}

export default {
  install(Vue: typeof _Vue) {
    const offline = Vue.prototype.$offline
    const books = Vue.prototype.$komgaBooks as any
    const series = Vue.prototype.$komgaSeries as any
    const users = Vue.prototype.$komgaUsers as any
    if (!offline || !books || !series || books.__offlineAdapterInstalled) return
    books.__offlineAdapterInstalled = true

    const localOnly = () => offline.state.offlineMode || !offline.state.online

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
          await offlinePut(OFFLINE_STORES.settings, {key: OFFLINE_SESSION_KEY, value: user} as CachedSession)
          return user
        } catch (e) {
          const cached = await getOfflineSessionUser()
          if (cached) return cached
          throw e
        }
      }

      users.getMeWithAuth = async (login: string, password: string, rememberMe: boolean): Promise<UserDto> => {
        const user = await originalGetMeWithAuth(login, password, rememberMe)
        await offlinePut(OFFLINE_STORES.settings, {key: OFFLINE_SESSION_KEY, value: user} as CachedSession)
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
  },
}
