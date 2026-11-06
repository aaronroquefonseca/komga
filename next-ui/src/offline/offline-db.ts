const deploymentPath = typeof window === 'undefined' ? '/' : window.resourceBaseUrl || '/'
export const OFFLINE_DB_NAME =
  'komga-offline' + (deploymentPath === '/' ? '' : '-' + encodeURIComponent(deploymentPath))
export const OFFLINE_DB_VERSION = 1

export const OFFLINE_STORES = {
  books: 'books',
  series: 'series',
  pages: 'pages',
  downloads: 'downloads',
  progress: 'progress',
  settings: 'settings',
} as const

const accountChannel =
  typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(OFFLINE_DB_NAME + '-account')
    : undefined
if (accountChannel) accountChannel.onmessage = () => window.location.reload()

export function notifyOfflineAccountChanged(): void {
  accountChannel?.postMessage('changed')
}

let databasePromise: Promise<IDBDatabase> | null = null

function openNamedDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, OFFLINE_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OFFLINE_STORES.books)) {
        db.createObjectStore(OFFLINE_STORES.books, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORES.series)) {
        db.createObjectStore(OFFLINE_STORES.series, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORES.pages)) {
        db.createObjectStore(OFFLINE_STORES.pages, { keyPath: 'bookId' })
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORES.downloads)) {
        db.createObjectStore(OFFLINE_STORES.downloads, { keyPath: 'bookId' })
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORES.progress)) {
        db.createObjectStore(OFFLINE_STORES.progress, { keyPath: 'bookId' })
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORES.settings)) {
        db.createObjectStore(OFFLINE_STORES.settings, { keyPath: 'key' })
      }
    }

    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open offline database'))
    request.onblocked = () => reject(new Error('Offline database upgrade was blocked'))
  })
}

let accountGeneration = 0
export function offlineAccountToken(): number {
  return accountGeneration
}
export function isOfflineAccount(token: number): boolean {
  return token === accountGeneration
}
export function assertOfflineAccount(token: number): void {
  if (!isOfflineAccount(token)) throw new Error('Offline account changed during request')
}
let activeDatabaseName = OFFLINE_DB_NAME

export function offlineMediaCachePrefix(): string {
  return 'komga-offline-book-v2-' + encodeURIComponent(activeDatabaseName) + '-'
}

export function openOfflineDatabase(): Promise<IDBDatabase> {
  if (!databasePromise)
    databasePromise = (async () => {
      const control = await openNamedDatabase(OFFLINE_DB_NAME)
      const pointer = await requestResult(
        control.transaction('settings', 'readonly').objectStore('settings').get('activeDatabase'),
      )
      activeDatabaseName = pointer?.value || OFFLINE_DB_NAME
      if (activeDatabaseName === OFFLINE_DB_NAME) return control
      control.close()
      return openNamedDatabase(activeDatabaseName)
    })()
  return databasePromise
}

/** Select an account without deleting any other account's downloads/progress. */
export async function selectOfflineUser(userId: string): Promise<boolean> {
  const current = await openOfflineDatabase()
  const settings = current.transaction('settings', 'readonly').objectStore('settings')
  const [owner, session] = await Promise.all([
    requestResult(settings.get('ownerUser')),
    requestResult(settings.get('sessionUser')),
  ])
  const previousUser = owner?.value || session?.value?.id
  const control = await openNamedDatabase(OFFLINE_DB_NAME)
  if (previousUser) {
    const tx = control.transaction('settings', 'readwrite')
    tx.objectStore('settings').put({
      key: 'userDatabase:' + previousUser,
      value: activeDatabaseName,
    })
    await transactionDone(tx)
  }
  if (!previousUser || previousUser === userId) {
    control.close()
    await offlinePut('settings', { key: 'ownerUser', value: userId })
    return false
  }
  accountGeneration += 1
  const known = await requestResult(
    control
      .transaction('settings', 'readonly')
      .objectStore('settings')
      .get('userDatabase:' + userId),
  )
  const name = known?.value || OFFLINE_DB_NAME + '-user-' + encodeURIComponent(userId)
  const transaction = control.transaction('settings', 'readwrite')
  transaction.objectStore('settings').put({ key: 'activeDatabase', value: name })
  await transactionDone(transaction)
  control.close()
  current.close()
  databasePromise = null
  await openOfflineDatabase()
  await offlinePut('settings', { key: 'ownerUser', value: userId })
  navigator.serviceWorker?.controller?.postMessage({ type: 'KOMGA_SESSION_CHANGED' })
  notifyOfflineAccountChanged()
  return true
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export async function offlineGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openOfflineDatabase()
  const transaction = db.transaction(storeName, 'readonly')
  const result = await requestResult(transaction.objectStore(storeName).get(key))
  await transactionDone(transaction)
  return result as T | undefined
}

export async function offlineGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openOfflineDatabase()
  const transaction = db.transaction(storeName, 'readonly')
  const result = await requestResult(transaction.objectStore(storeName).getAll())
  await transactionDone(transaction)
  return result as T[]
}

export async function offlinePut<T>(storeName: string, value: T): Promise<void> {
  const db = await openOfflineDatabase()
  const transaction = db.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).put(value)
  await transactionDone(transaction)
}

export async function offlinePutMany<T>(storeName: string, values: T[]): Promise<void> {
  if (values.length === 0) return
  const db = await openOfflineDatabase()
  const transaction = db.transaction(storeName, 'readwrite')
  const store = transaction.objectStore(storeName)
  values.forEach((value) => store.put(value))
  await transactionDone(transaction)
}

export async function offlineDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openOfflineDatabase()
  const transaction = db.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).delete(key)
  await transactionDone(transaction)
}

export async function offlineCount(storeName: string): Promise<number> {
  const db = await openOfflineDatabase()
  const transaction = db.transaction(storeName, 'readonly')
  const result = await requestResult(transaction.objectStore(storeName).count())
  await transactionDone(transaction)
  return result
}

export async function offlineKeys(storeName: string): Promise<IDBValidKey[]> {
  const db = await openOfflineDatabase()
  return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAllKeys())
}

const PENDING_CATALOG_PREFIX = 'catalogPending:'
const pendingCatalogRange = () =>
  IDBKeyRange.bound(PENDING_CATALOG_PREFIX, `${PENDING_CATALOG_PREFIX}\uffff`)

export interface PendingCatalogRevision {
  key: string
  kind: 'books' | 'series'
  id: string
  revision: string
}

export async function pendingCatalogRevisions(): Promise<PendingCatalogRevision[]> {
  const db = await openOfflineDatabase()
  return requestResult(
    db.transaction('settings', 'readonly').objectStore('settings').getAll(pendingCatalogRange()),
  )
}

/** Record each successful batch so a later interruption does not cause it to be fetched again. */
export async function saveCatalogEntries(
  kind: 'books' | 'series',
  items: { id: string }[],
  revisions: Record<string, string>,
  account: number,
): Promise<void> {
  const db = await openOfflineDatabase()
  assertOfflineAccount(account)
  const tx = db.transaction([kind, 'settings'], 'readwrite')
  for (const item of items) {
    tx.objectStore(kind).put(item)
    tx.objectStore('settings').put({
      key: `${PENDING_CATALOG_PREFIX}${kind}:${item.id}`,
      kind,
      id: item.id,
      revision: revisions[item.id],
    })
  }
  await transactionDone(tx)
}

/** A sync checkpoint must not advance until all changes and deletions are saved. */
export async function commitCatalogDelta(
  deletedBooks: string[],
  deletedSeries: string[],
  manifest: unknown,
  syncedAt: string,
  account: number,
): Promise<void> {
  const db = await openOfflineDatabase()
  assertOfflineAccount(account)
  const tx = db.transaction(['books', 'series', 'pages', 'settings'], 'readwrite')
  deletedBooks.forEach((id) => {
    tx.objectStore('books').delete(id)
    tx.objectStore('pages').delete(id)
  })
  deletedSeries.forEach((id) => tx.objectStore('series').delete(id))
  tx.objectStore('settings').put({ key: 'catalogManifest', value: manifest })
  tx.objectStore('settings').put({ key: 'catalogSyncedAt', value: syncedAt })
  tx.objectStore('settings').delete(pendingCatalogRange())
  await transactionDone(tx)
}
