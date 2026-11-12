import * as api from '@/generated/openapi'
import { useOfflineLibraryStore } from './offline-store'
import { pageFromItems } from './offline-utils'
import {
  getGenresOfflineFirst,
  getSeriesAndBookTagsOfflineFirst,
  getPublishersOfflineFirst,
  getSharingLabelsOfflineFirst,
  getLanguagesOfflineFirst,
  getReleaseYearsOfflineFirst,
  getAgeRatingsOfflineFirst,
} from './offline-readers'

export async function queryGenresOfflineFirst(options?: Parameters<typeof api.komgaGetGenres>[0]) {
  const offline = useOfflineLibraryStore()
  if (offline.online && !offline.offlineMode) {
    try {
      return await api.komgaGetGenres(options)
    } catch {
      /* Use locally saved facets. */
    }
  }
  const page = await getGenresOfflineFirst(options?.query?.library_id)
  const query = options?.query
  const search =
    query && 'search' in query
      ? (typeof query.search === 'string' ? query.search : '').toLocaleLowerCase()
      : ''
  return pageFromItems(
    (page.content ?? []).filter((item) => String(item).toLocaleLowerCase().includes(search)),
    { page: query?.page, size: query?.size, unpaged: query?.unpaged },
  )
}

export async function queryTagsOfflineFirst(options?: Parameters<typeof api.komgaGetTags>[0]) {
  const offline = useOfflineLibraryStore()
  if (offline.online && !offline.offlineMode) {
    try {
      return await api.komgaGetTags(options)
    } catch {
      /* Use locally saved facets. */
    }
  }
  const page = await getSeriesAndBookTagsOfflineFirst(options?.query?.library_id)
  const query = options?.query
  const search =
    query && 'search' in query
      ? (typeof query.search === 'string' ? query.search : '').toLocaleLowerCase()
      : ''
  return pageFromItems(
    (page.content ?? []).filter((item) => String(item).toLocaleLowerCase().includes(search)),
    { page: query?.page, size: query?.size, unpaged: query?.unpaged },
  )
}

export async function queryPublishersOfflineFirst(
  options?: Parameters<typeof api.komgaGetPublishers>[0],
) {
  const offline = useOfflineLibraryStore()
  if (offline.online && !offline.offlineMode) {
    try {
      return await api.komgaGetPublishers(options)
    } catch {
      /* Use locally saved facets. */
    }
  }
  const page = await getPublishersOfflineFirst(options?.query?.library_id)
  const query = options?.query
  const search =
    query && 'search' in query
      ? (typeof query.search === 'string' ? query.search : '').toLocaleLowerCase()
      : ''
  return pageFromItems(
    (page.content ?? []).filter((item) => String(item).toLocaleLowerCase().includes(search)),
    { page: query?.page, size: query?.size, unpaged: query?.unpaged },
  )
}

export async function querySharingLabelsOfflineFirst(
  options?: Parameters<typeof api.komgaGetSharingLabels>[0],
) {
  const offline = useOfflineLibraryStore()
  if (offline.online && !offline.offlineMode) {
    try {
      return await api.komgaGetSharingLabels(options)
    } catch {
      /* Use locally saved facets. */
    }
  }
  const page = await getSharingLabelsOfflineFirst(options?.query?.library_id)
  const query = options?.query
  const search =
    query && 'search' in query
      ? (typeof query.search === 'string' ? query.search : '').toLocaleLowerCase()
      : ''
  return pageFromItems(
    (page.content ?? []).filter((item) => String(item).toLocaleLowerCase().includes(search)),
    { page: query?.page, size: query?.size, unpaged: query?.unpaged },
  )
}

export async function queryLanguagesOfflineFirst(
  options?: Parameters<typeof api.komgaGetLanguages>[0],
) {
  const offline = useOfflineLibraryStore()
  if (offline.online && !offline.offlineMode) {
    try {
      return await api.komgaGetLanguages(options)
    } catch {
      /* Use locally saved facets. */
    }
  }
  const page = await getLanguagesOfflineFirst(options?.query?.library_id)
  const query = options?.query
  const search =
    query && 'search' in query
      ? (typeof query.search === 'string' ? query.search : '').toLocaleLowerCase()
      : ''
  return pageFromItems(
    (page.content ?? []).filter((item) => String(item).toLocaleLowerCase().includes(search)),
    { page: query?.page, size: query?.size, unpaged: query?.unpaged },
  )
}

export async function querySeriesReleaseYearsOfflineFirst(
  options?: Parameters<typeof api.komgaGetSeriesReleaseYears>[0],
) {
  const offline = useOfflineLibraryStore()
  if (offline.online && !offline.offlineMode) {
    try {
      return await api.komgaGetSeriesReleaseYears(options)
    } catch {
      /* Use locally saved facets. */
    }
  }
  const page = await getReleaseYearsOfflineFirst(options?.query?.library_id)
  const query = options?.query
  const search =
    query && 'search' in query
      ? (typeof query.search === 'string' ? query.search : '').toLocaleLowerCase()
      : ''
  return pageFromItems(
    (page.content ?? []).filter((item) => String(item).toLocaleLowerCase().includes(search)),
    { page: query?.page, size: query?.size, unpaged: query?.unpaged },
  )
}

export async function queryAgeRatingsOfflineFirst(
  options?: Parameters<typeof api.komgaGetAgeRatings>[0],
) {
  const offline = useOfflineLibraryStore()
  if (offline.online && !offline.offlineMode) {
    try {
      return await api.komgaGetAgeRatings(options)
    } catch {
      /* Use locally saved facets. */
    }
  }
  const page = await getAgeRatingsOfflineFirst(options?.query?.library_id)
  const query = options?.query
  const search =
    query && 'search' in query
      ? (typeof query.search === 'string' ? query.search : '').toLocaleLowerCase()
      : ''
  return pageFromItems(
    (page.content ?? []).filter((item) => String(item).toLocaleLowerCase().includes(search)),
    { page: query?.page, size: query?.size, unpaged: query?.unpaged },
  )
}
