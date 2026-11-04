/** Keep each catalog request small enough for large libraries and slow servers. */
export const CATALOG_PAGE_SIZE = 200

export interface CatalogPage<T> {
  content?: T[]
  last?: boolean
  totalElements?: number
}

export async function syncCatalogPages<T>(
  fetchPage: (page: number, size: number) => Promise<CatalogPage<T>>,
  savePage: (items: T[]) => Promise<void>,
  onProgress: (done: number, total: number) => void,
): Promise<T[]> {
  const items: T[] = []
  for (let page = 0; ; page += 1) {
    const result = await fetchPage(page, CATALOG_PAGE_SIZE)
    const content = result.content ?? []
    if (!content.length && result.last === false) throw new Error('Catalog page was incomplete')
    await savePage(content)
    items.push(...content)
    onProgress(items.length, Math.max(items.length, result.totalElements ?? items.length))
    if (result.last === true || (result.last === undefined && content.length < CATALOG_PAGE_SIZE))
      return items
  }
}
