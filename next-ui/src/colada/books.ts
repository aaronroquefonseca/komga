import {
  getBookOfflineFirst,
  getBookPagesOfflineFirst,
  getBookSiblingOfflineFirst,
  getBooksListOfflineFirst,
  getBooksOnDeckOfflineFirst,
  useOfflineLibraryStore,
} from '@/offline'
import {
  defineInfiniteQueryOptions,
  defineMutation,
  defineQueryOptions,
  useMutation,
} from '@pinia/colada'
import { PageRequest, type Sort } from '@/types/PageRequest'
import { clearBook, clearThumbnailBook } from '@/colada/cache'
import { useAppStore } from '@/stores/app'
import {
  type BookSearch,
  komgaAddUserUploadedBookThumbnail,
  komgaMarkBookThumbnailSelected,
  komgaBookAnalyze,
  komgaBookRefreshMetadata,
  komgaDeleteBookFile,
  komgaDeleteBookReadProgress,
  komgaGetBookThumbnails,
  komgaUpdateBookMetadata,
  komgaDeleteUserUploadedBookThumbnail,
  type BookMetadataUpdateDto,
} from '@/generated/openapi'
import { useImageCacheStore } from '@/stores/image-cache'
import { STALE_TIME } from '@/types/time'

export const QUERY_KEYS_BOOKS = {
  root: ['books'] as const,
  bySearch: (request: object) => [...QUERY_KEYS_BOOKS.root, JSON.stringify(request)] as const,
  byId: (bookId: string) => [...QUERY_KEYS_BOOKS.root, bookId] as const,
  onDeck: (request: object) => [...QUERY_KEYS_BOOKS.root, 'deck', JSON.stringify(request)] as const,
  posters: (id: string) => [...QUERY_KEYS_BOOKS.byId(id), 'posters'] as const,
}

export const bookListQuery = defineQueryOptions(
  ({ search, pageRequest }: { search: BookSearch; pageRequest?: PageRequest }) => ({
    key: QUERY_KEYS_BOOKS.bySearch({ search: search, pageRequest: pageRequest }),
    query: () => getBooksListOfflineFirst(search, pageRequest),
    placeholderData: (previousData) => previousData,
  }),
)

export const bookListQueryInfinite = defineInfiniteQueryOptions(
  ({ search, sort }: { search: BookSearch; sort?: Sort[] }) => ({
    key: QUERY_KEYS_BOOKS.bySearch({ search: search, sort: sort, infinite: true }),
    initialPageParam: new PageRequest(0, 50, sort),
    query: ({ pageParam }) => getBooksListOfflineFirst(search, pageParam),
    getNextPageParam: (lastPage, _, lastPageParam) =>
      !lastPage?.last ? lastPageParam.next() : null,
  }),
)

export const booksOnDeckQueryInfinite = defineInfiniteQueryOptions(
  ({ libraryIds }: { libraryIds?: string[] }) => ({
    key: QUERY_KEYS_BOOKS.onDeck({ libraryIds: libraryIds, infinite: true }),
    initialPageParam: new PageRequest(0, 50),
    query: ({ pageParam }) => getBooksOnDeckOfflineFirst(libraryIds, pageParam),
    getNextPageParam: (lastPage, _, lastPageParam) =>
      !lastPage?.last ? lastPageParam.next() : null,
  }),
)

export const bookDetailQuery = defineQueryOptions(({ bookId }: { bookId: string }) => ({
  key: QUERY_KEYS_BOOKS.byId(bookId),
  query: () => getBookOfflineFirst(bookId),
  staleTime: STALE_TIME.LONG,
}))

export const bookPreviousInSeries = defineQueryOptions(({ bookId }: { bookId: string }) => ({
  key: [...QUERY_KEYS_BOOKS.byId(bookId), 'series', 'previous'],
  query: () => getBookSiblingOfflineFirst(bookId, -1),
}))

export const bookNextInSeries = defineQueryOptions(({ bookId }: { bookId: string }) => ({
  key: [...QUERY_KEYS_BOOKS.byId(bookId), 'series', 'next'],
  query: () => getBookSiblingOfflineFirst(bookId, 1),
}))

export const useRefreshMetadataBook = defineMutation(() =>
  useMutation({
    mutation: (bookId: string) =>
      komgaBookRefreshMetadata({
        path: {
          bookId: bookId,
        },
      }),
  }),
)

export const useAnalyzeBook = defineMutation(() =>
  useMutation({
    mutation: (bookId: string) =>
      komgaBookAnalyze({
        path: {
          bookId: bookId,
        },
      }),
  }),
)

export const useMarkBookRead = defineMutation(() => {
  const appStore = useAppStore()
  return useMutation({
    mutation: (bookId: string) =>
      useOfflineLibraryStore().updateReadProgress(bookId, { completed: true }),
    onSuccess: (data, bookId) => {
      if (appStore.sseUnavailable) clearBook(bookId)
    },
  })
})

export const useMarkBookUnread = defineMutation(() => {
  const appStore = useAppStore()
  return useMutation({
    mutation: (bookId: string) =>
      komgaDeleteBookReadProgress({
        path: {
          bookId: bookId,
        },
      }),
    onSuccess: (data, bookId) => {
      if (appStore.sseUnavailable) clearBook(bookId)
    },
  })
})

export const useDeleteBook = defineMutation(() => {
  const appStore = useAppStore()
  return useMutation({
    mutation: (bookId: string) =>
      komgaDeleteBookFile({
        path: {
          bookId: bookId,
        },
      }),
    onSuccess: (data, bookId) => {
      if (appStore.sseUnavailable) clearBook(bookId)
    },
  })
})

export const useUpdateBookMetadata = defineMutation(() => {
  const appStore = useAppStore()
  return useMutation({
    mutation: ({ bookId, metadata }: { bookId: string; metadata: BookMetadataUpdateDto }) =>
      komgaUpdateBookMetadata({
        path: {
          bookId: bookId,
        },
        body: metadata,
      }),
    onSuccess: (data, { bookId }) => {
      if (appStore.sseUnavailable) clearBook(bookId)
    },
  })
})

export const bookPostersQuery = defineQueryOptions(({ bookId }: { bookId: string }) => ({
  key: QUERY_KEYS_BOOKS.posters(bookId),
  query: () =>
    komgaGetBookThumbnails({
      path: {
        bookId: bookId,
      },
    }),
  staleTime: STALE_TIME.LONG,
}))

export const useAddBookPoster = defineMutation(() => {
  const appStore = useAppStore()
  const cacheStore = useImageCacheStore()
  return useMutation({
    mutation: ({ bookId, file, selected }: { bookId: string; file: File; selected: boolean }) =>
      komgaAddUserUploadedBookThumbnail({
        query: {
          selected: selected,
        },
        body: {
          file: file,
        },
        path: {
          bookId: bookId,
        },
      }),
    onSuccess: (_data, { bookId }) => {
      if (appStore.sseUnavailable) {
        clearThumbnailBook(bookId)
        cacheStore.bustCache(bookId)
      }
    },
  })
})

export const useDeleteBookPoster = defineMutation(() => {
  const appStore = useAppStore()
  const cacheStore = useImageCacheStore()
  return useMutation({
    mutation: ({ bookId, thumbnailId }: { bookId: string; thumbnailId: string }) =>
      komgaDeleteUserUploadedBookThumbnail({
        path: {
          bookId: bookId,
          thumbnailId: thumbnailId,
        },
      }),
    onSuccess: (_data, { bookId }) => {
      if (appStore.sseUnavailable) {
        clearThumbnailBook(bookId)
        cacheStore.bustCache(bookId)
      }
    },
  })
})

export const useMarkBookPosterSelected = defineMutation(() => {
  const appStore = useAppStore()
  const cacheStore = useImageCacheStore()
  return useMutation({
    mutation: ({ bookId, thumbnailId }: { bookId: string; thumbnailId: string }) =>
      komgaMarkBookThumbnailSelected({
        path: {
          bookId: bookId,
          thumbnailId: thumbnailId,
        },
      }),
    onSuccess: (_data, { bookId }) => {
      if (appStore.sseUnavailable) {
        clearThumbnailBook(bookId)
        cacheStore.bustCache(bookId)
      }
    },
  })
})

export const bookPagesQuery = defineQueryOptions(({ bookId }: { bookId: string }) => ({
  key: [...QUERY_KEYS_BOOKS.byId(bookId), 'pages'],
  query: () => getBookPagesOfflineFirst(bookId),
}))
