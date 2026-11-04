import type { PageDto } from '@/generated/openapi'
import type { OfflineDownloadRecord, OfflinePage, OfflinePageRequest } from './offline-types'

/**
 * Pure offline logic ported 1:1 from the classic web UI
 * (`offline-library.service.ts` and `offline-komga-adapter.plugin.ts`).
 * None of these functions touch IndexedDB, the network, or the DOM, so they
 * are safe to unit test in isolation.
 */

export function clone<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T)
}

export function getPathValue(value: unknown, path: string): unknown {
  let current: unknown = value
  for (const part of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined
    current = Reflect.get(current, part)
  }
  return current
}

/**
 * Explicit equivalent of `` `${value}` `` for values of unknown type.
 * Template literals are banned by lint for non-primitive types, so the
 * conversion lives here in one place with classic runtime semantics.
 */
export function stringifyFilterValue(value: unknown): string {
  if (typeof value === 'string') return value
  return String(value)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : stringifyFilterValue(error)
}

/** Minimal structural view of a book or series row used by the offline filters. */
export interface OfflineFilterItem {
  libraryId?: unknown
  seriesId?: unknown
  readProgress?: { completed?: boolean } | null
  media?: { status?: unknown; mediaProfile?: unknown } | null
  oneshot?: unknown
  deleted?: unknown
  name?: unknown
  seriesTitle?: unknown
  metadata?: {
    title?: unknown
    titleSort?: unknown
    status?: unknown
    language?: unknown
    publisher?: unknown
    releaseDate?: unknown
    sharingLabels?: unknown
    tags?: unknown
    genres?: unknown
    authors?: Array<{ name?: unknown }> | null
  } | null
  booksMetadata?: { releaseDate?: unknown } | null
}

export function readStatus(item: OfflineFilterItem): string {
  if (!item.readProgress) return 'UNREAD'
  return item.readProgress.completed ? 'READ' : 'IN_PROGRESS'
}

interface FilterOperatorFields {
  operator?: unknown
  value?: unknown
  dateTime?: unknown
}

function readOperatorFields(operator: unknown): FilterOperatorFields {
  if (!operator || typeof operator !== 'object') return {}
  return {
    operator: Reflect.get(operator, 'operator'),
    value: Reflect.get(operator, 'value'),
    dateTime: Reflect.get(operator, 'dateTime'),
  }
}

function compareUnknownValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  if (a instanceof Date && b instanceof Date) {
    const diff = a.getTime() - b.getTime()
    return diff < 0 ? -1 : diff > 0 ? 1 : 0
  }
  const left = stringifyFilterValue(a)
  const right = stringifyFilterValue(b)
  return left < right ? -1 : left > right ? 1 : 0
}

export function operatorMatches(actual: unknown, operator: unknown): boolean {
  if (!operator || typeof operator !== 'object') return true
  const kind = Reflect.get(operator, 'operator')
  if (typeof kind !== 'string') return true
  const value = Reflect.get(operator, 'value')
  const dateTime = Reflect.get(operator, 'dateTime')
  switch (kind) {
    case 'is':
      if (Array.isArray(actual)) return actual.includes(value)
      return actual === value
    case 'isNot':
      if (Array.isArray(actual)) return !actual.includes(value)
      return actual !== value
    case 'isTrue':
      return actual === true
    case 'isFalse':
      return actual === false
    case 'isNull':
      return actual == null
    case 'isNotNull':
      return actual != null
    case 'before':
      return (
        actual != null &&
        new Date(actual as string).getTime() < new Date(dateTime as string).getTime()
      )
    case 'after':
      return (
        actual != null &&
        new Date(actual as string).getTime() > new Date(dateTime as string).getTime()
      )
    case 'beginsWith':
      return stringifyFilterValue(actual || '')
        .toLocaleLowerCase()
        .startsWith(stringifyFilterValue(value || '').toLocaleLowerCase())
    case 'doesNotBeginWith':
      return !stringifyFilterValue(actual || '')
        .toLocaleLowerCase()
        .startsWith(stringifyFilterValue(value || '').toLocaleLowerCase())
    default:
      return true
  }
}

function asConditionRecord(condition: unknown): Record<string, unknown> {
  if (!condition || typeof condition !== 'object') return {}
  const record: Record<string, unknown> = {}
  for (const key of Object.keys(condition)) record[key] = Reflect.get(condition, key)
  return record
}

export function conditionMatches(item: OfflineFilterItem, condition: unknown): boolean {
  if (!condition || typeof condition !== 'object' || Object.keys(condition).length === 0)
    return true
  const record = asConditionRecord(condition)
  if (Array.isArray(record.allOf))
    return (record.allOf as unknown[]).every((x) => conditionMatches(item, x))
  if (Array.isArray(record.anyOf))
    return (record.anyOf as unknown[]).some((x) => conditionMatches(item, x))

  return Object.entries(record).every(([key, operator]) => {
    switch (key) {
      case 'libraryId':
        return operatorMatches(item.libraryId, operator)
      case 'seriesId':
        return operatorMatches(item.seriesId, operator)
      case 'readStatus':
        return operatorMatches(readStatus(item), operator)
      case 'mediaStatus':
        return operatorMatches(item.media?.status, operator)
      case 'mediaProfile':
        return operatorMatches(item.media?.mediaProfile, operator)
      case 'oneShot':
        return operatorMatches(item.oneshot, operator)
      case 'deleted':
        return operatorMatches(item.deleted, operator)
      case 'tag':
        return operatorMatches(item.metadata?.tags ?? [], operator)
      case 'genre':
        return operatorMatches(item.metadata?.genres ?? [], operator)
      case 'language':
        return operatorMatches(item.metadata?.language, operator)
      case 'publisher':
        return operatorMatches(item.metadata?.publisher, operator)
      case 'seriesStatus':
        return operatorMatches(item.metadata?.status, operator)
      case 'complete':
        return operatorMatches(item.metadata?.status === 'ENDED', operator)
      case 'releaseDate':
        return operatorMatches(item.metadata?.releaseDate, operator)
      case 'sharingLabel':
        return operatorMatches(item.metadata?.sharingLabels ?? [], operator)
      case 'titleSort':
        return operatorMatches(item.metadata?.titleSort ?? item.metadata?.title, operator)
      default:
        // Unknown filters stay permissive offline rather than hiding cached data.
        return true
    }
  })
}

export function fullTextMatches(item: OfflineFilterItem, query?: string): boolean {
  if (!query?.trim()) return true
  const q = query.trim().toLocaleLowerCase()
  const values: unknown[] = [
    item.name,
    item.seriesTitle,
    item.metadata?.title,
    item.metadata?.titleSort,
    ...(item.metadata?.authors ?? []).map((x) => x.name),
    ...((item.metadata?.tags ?? []) as unknown[]),
  ]
  return values.some((value) =>
    stringifyFilterValue(value || '')
      .toLocaleLowerCase()
      .includes(q),
  )
}

function normalizeSort(sort: OfflinePageRequest['sort']): string[] {
  if (!Array.isArray(sort)) return []
  return sort.map((entry) =>
    typeof entry === 'string' ? entry : entry.order ? `${entry.key},${entry.order}` : entry.key,
  )
}

export function pageFromItems<T>(items: T[], pageRequest?: OfflinePageRequest): OfflinePage<T> {
  const sort = normalizeSort(pageRequest?.sort)
  const sorted = [...items]
  if (sort.length > 0) {
    const [sortSpec = ''] = sort
    const [field = '', direction = 'asc'] = sortSpec.split(',')
    sorted.sort((a: T, b: T) => {
      const av = getPathValue(a, field)
      const bv = getPathValue(b, field)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const result =
        typeof av === 'string'
          ? av.localeCompare(stringifyFilterValue(bv), undefined, {
              numeric: true,
              sensitivity: 'base',
            })
          : compareUnknownValues(av, bv)
      return direction.toLowerCase() === 'desc' ? -result : result
    })
  }

  const unpaged = pageRequest?.unpaged === true
  const size = unpaged ? Math.max(1, sorted.length) : Math.max(1, Number(pageRequest?.size ?? 20))
  const requestedNumber = unpaged ? 0 : Math.max(0, Number(pageRequest?.page ?? 0))
  const totalPages = sorted.length === 0 ? 0 : Math.ceil(sorted.length / size)
  // A page number persisted while online may no longer exist in a smaller
  // offline result set. Clamp it instead of rendering an apparently empty library.
  const number = totalPages > 0 ? Math.min(requestedNumber, totalPages - 1) : 0
  const start = unpaged ? 0 : number * size
  const content = unpaged ? sorted : sorted.slice(start, start + size)

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
  }
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function manifestRevision(pages: PageDto[]): string {
  // Deliberately excludes archive/container details. A CBR -> CBZ conversion
  // with identical extracted pages therefore does not force a media redownload.
  const manifest = pages
    .map((page) =>
      [
        page.number,
        page.fileName,
        page.mediaType,
        page.width || 0,
        page.height || 0,
        page.sizeBytes || 0,
      ].join(':'),
    )
    .join('|')
  return `${pages.length}-${stableHash(manifest)}`
}

export function pageIdentity(page: PageDto): string {
  return [
    page.fileName,
    page.mediaType,
    page.width || 0,
    page.height || 0,
    page.sizeBytes || 0,
  ].join(':')
}

export function contentIdentity(page: PageDto): string {
  return [page.mediaType, page.width || 0, page.height || 0, page.sizeBytes || 0].join(':')
}

export function remapPage(oldPages: PageDto[], newPages: PageDto[], oldPageNumber: number): number {
  if (newPages.length === 0) return 1
  const source =
    oldPages.find((page) => page.number === oldPageNumber) ?? oldPages[oldPageNumber - 1]
  if (!source) return Math.max(1, Math.min(newPages.length, oldPageNumber))

  const exact = newPages.find((page) => pageIdentity(page) === pageIdentity(source))
  if (exact) return exact.number

  // Translators/promotional pages are commonly removed without renaming the
  // remaining artwork. If names did change, use dimensions+byte size only when
  // that identity is unique in the new manifest.
  const contentMatches = newPages.filter(
    (page) => contentIdentity(page) === contentIdentity(source),
  )
  if (contentMatches.length === 1 && contentMatches[0]) return contentMatches[0].number

  // Last-resort fallback preserves approximate position while staying valid.
  const ratio = oldPages.length > 1 ? (oldPageNumber - 1) / (oldPages.length - 1) : 0
  return Math.max(
    1,
    Math.min(newPages.length, Math.round(ratio * Math.max(0, newPages.length - 1)) + 1),
  )
}

export function dateToken(value: unknown): string {
  if (!value) return ''
  const date = new Date(value as string)
  return Number.isNaN(date.getTime()) ? stringifyFilterValue(value) : date.toISOString()
}

const isoDateFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d*)?(?:[-+]\d{2}:?\d{2}|Z)?$/

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && isoDateFormat.test(value)
}

/**
 * Converts ISO date strings back to Date objects in place (mirrors the
 * classic `handleDates` response interceptor). IndexedDB round-trips and the
 * generated SDK transformers disagree on date representation, so cached rows
 * are rehydrated before being handed to the UI.
 */
export function rehydrateDates<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') return value
  for (const key of Object.keys(value)) {
    const record = value as Record<string, unknown>
    const entry = record[key]
    if (isIsoDateString(entry)) record[key] = new Date(entry)
    else if (typeof entry === 'object') rehydrateDates(entry)
  }
  return value
}

export function conditionUsesOnlyLibrarySelection(condition: unknown): boolean {
  if (!condition || typeof condition !== 'object' || Object.keys(condition).length === 0)
    return true
  const record = asConditionRecord(condition)
  if (Array.isArray(record.allOf))
    return (record.allOf as unknown[]).every(conditionUsesOnlyLibrarySelection)
  if (Array.isArray(record.anyOf))
    return (record.anyOf as unknown[]).every(conditionUsesOnlyLibrarySelection)
  return Object.keys(record).every((key) => key === 'libraryId')
}

export function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value)))
}

export function libraryIdsFromCondition(condition: unknown): string[] {
  if (!condition) return []
  const record = asConditionRecord(condition)
  if (Array.isArray(record.allOf))
    return uniqueStrings((record.allOf as unknown[]).flatMap(libraryIdsFromCondition))
  if (Array.isArray(record.anyOf))
    return uniqueStrings((record.anyOf as unknown[]).flatMap(libraryIdsFromCondition))
  const operator = readOperatorFields(record.libraryId)
  if (operator.operator !== 'is' || operator.value == null) return []
  return [stringifyFilterValue(operator.value)]
}

interface QueuedDownloadLike {
  bookId: string
  status: OfflineDownloadRecord['status']
  queuedAt?: string
}

/**
 * Pure queue picker used by the download queue: oldest `queued` record that is
 * not already being processed. Extracted so the ordering rule is unit-testable.
 */
export function selectNextQueuedDownload<T extends QueuedDownloadLike>(
  downloads: T[],
  activeBookIds: Pick<ReadonlySet<string>, 'has'>,
): T | undefined {
  return downloads
    .filter((x) => x.status === 'queued' && !activeBookIds.has(x.bookId))
    .sort((a, b) => `${a.queuedAt || ''}`.localeCompare(`${b.queuedAt || ''}`))[0]
}

export interface DownloadGroupSummary {
  totalPages: number
  completedPages: number
  downloaded: number
  active: number
  queued: number
  failed: number
  finished: boolean
  percent: number
}

interface DownloadGroupItem {
  status: OfflineDownloadRecord['status']
  totalPages: number
  completedPages: number
  error?: string
}

/** Pure aggregation behind the grouped download notifications. */
export function summarizeDownloadGroup(items: DownloadGroupItem[]): DownloadGroupSummary {
  const totalPages = items.reduce((sum, item) => sum + item.totalPages, 0)
  const completedPages = items.reduce(
    (sum, item) => sum + Math.min(item.completedPages, item.totalPages),
    0,
  )
  const downloaded = items.filter((item) => item.status === 'downloaded').length
  const active = items.filter(
    (item) => item.status === 'downloading' || item.status === 'updating',
  ).length
  const queued = items.filter((item) => item.status === 'queued' || item.status === 'paused').length
  const failed = items.filter((item) => item.status === 'error' || !!item.error).length
  const finished =
    items.every((item) => item.status === 'downloaded' || item.status === 'error') &&
    active === 0 &&
    queued === 0
  return {
    totalPages,
    completedPages,
    downloaded,
    active,
    queued,
    failed,
    finished,
    percent: totalPages ? Math.floor((completedPages / totalPages) * 100) : 0,
  }
}
