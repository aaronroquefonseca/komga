import type { OfflineDownloadRecord } from './offline-types'

export interface DownloadGroup {
  seriesId: string
  title: string
  downloads: OfflineDownloadRecord[]
  downloaded: number
  failed: number
  bytes: number
}

/**
 * Groups download records by series, mirroring the classic OfflineDownloads view.
 * Pure: no IndexedDB, network, or DOM access.
 */
export function groupDownloadsBySeries(downloads: OfflineDownloadRecord[]): DownloadGroup[] {
  const grouped = new Map<string, OfflineDownloadRecord[]>()
  downloads.forEach((item) => {
    const key = item.book.seriesId
    grouped.set(key, [...(grouped.get(key) ?? []), item])
  })
  return Array.from(grouped.entries()).map(([seriesId, items]) => {
    const sorted = [...items].sort(
      (a, b) => (a.book.metadata.numberSort ?? 0) - (b.book.metadata.numberSort ?? 0),
    )
    return {
      seriesId,
      title: sorted[0]?.book.seriesTitle ?? '',
      downloads: sorted,
      downloaded: sorted.filter((item) => item.status === 'downloaded').length,
      failed: sorted.filter((item) => item.status === 'error' || !!item.error).length,
      bytes: sorted.reduce((sum, item) => sum + item.bytes, 0),
    }
  })
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, index)
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

export type DownloadBadge = 'update-available' | 'source-missing' | 'update-failed'

/**
 * Chips shown next to a downloaded copy. A downloaded row keeps its old copy
 * when an update fails, so `error` is surfaced as a badge rather than a
 * full error state.
 */
export function getDownloadBadges(
  record: Pick<
    OfflineDownloadRecord,
    'status' | 'updateAvailable' | 'sourceMissing' | 'error' | 'cacheName'
  >,
): DownloadBadge[] {
  if (record.status !== 'downloaded') return []
  const badges: DownloadBadge[] = []
  if (record.updateAvailable) badges.push('update-available')
  if (record.sourceMissing) badges.push('source-missing')
  if (record.error) badges.push('update-failed')
  return badges
}
