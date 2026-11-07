import { ApiBaseUrl } from '@/api/base'

/** Keep each catalog request small enough for large libraries and slow servers. */
export const CATALOG_PAGE_SIZE = 200

export interface CatalogManifest {
  etag?: string
  books: Record<string, string>
  series: Record<string, string>
}

export function catalogDelta(
  previous: Record<string, string>,
  current: Record<string, string>,
  localIds: IDBValidKey[],
) {
  const local = new Set(localIds)
  return {
    changed: Object.keys(current).filter((id) => !local.has(id) || previous[id] !== current[id]),
    deleted: localIds.filter((id): id is string => typeof id === 'string' && !(id in current)),
  }
}

async function catalogRequest(path = '', init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${ApiBaseUrl.noSlash}/api/v1/offline/catalog${path}`, {
    ...init,
    credentials: 'include',
    signal: AbortSignal.timeout(15000),
    headers: { 'X-Requested-With': 'XMLHttpRequest', ...init.headers },
  })
  if (!response.ok && response.status !== 304)
    throw new Error(`Catalog sync failed (${response.status})`)
  return response
}

export async function fetchCatalogManifest(previous?: CatalogManifest): Promise<CatalogManifest> {
  const response = await catalogRequest('', {
    headers: previous?.etag ? { 'If-None-Match': previous.etag } : {},
    cache: 'no-store',
  })
  if (response.status === 304) {
    if (!previous) throw new Error('Catalog index is missing')
    return previous
  }
  const manifest = (await response.json()) as CatalogManifest
  if (!manifest.books || !manifest.series) throw new Error('Catalog index is incomplete')
  return { ...manifest, etag: response.headers.get('ETag') ?? undefined }
}

export async function fetchCatalogEntries<T extends { id: string }>(
  kind: 'books' | 'series',
  ids: string[],
  save: (items: T[]) => Promise<void>,
  progress: (done: number, total: number) => void,
): Promise<void> {
  for (let offset = 0; offset < ids.length; offset += CATALOG_PAGE_SIZE) {
    const batch = ids.slice(offset, offset + CATALOG_PAGE_SIZE)
    const response = await catalogRequest(`/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    })
    const items = (await response.json()) as T[]
    const returned = new Set(items.map((item) => item.id))
    if (returned.size !== batch.length || batch.some((id) => !returned.has(id)))
      throw new Error('Catalog changed during sync; retry to finish')
    await save(items)
    progress(offset + batch.length, ids.length)
  }
}
