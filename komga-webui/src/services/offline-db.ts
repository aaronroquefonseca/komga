const deploymentPath = typeof window === 'undefined' ? '/' : (window.resourceBaseUrl || '/')
export const OFFLINE_DB_NAME = 'komga-offline' + (deploymentPath === '/' ? '' : '-' + encodeURIComponent(deploymentPath))
export const OFFLINE_DB_VERSION = 1

export const OFFLINE_STORES = {
  books: 'books',
  series: 'series',
  pages: 'pages',
  downloads: 'downloads',
  progress: 'progress',
  settings: 'settings',
} as const

const accountChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel(OFFLINE_DB_NAME + '-account') : undefined
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
        db.createObjectStore(OFFLINE_STORES.books, {keyPath: 'id'})
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORES.series)) {
        db.createObjectStore(OFFLINE_STORES.series, {keyPath: 'id'})
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORES.pages)) {
        db.createObjectStore(OFFLINE_STORES.pages, {keyPath: 'bookId'})
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORES.downloads)) {
        db.createObjectStore(OFFLINE_STORES.downloads, {keyPath: 'bookId'})
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORES.progress)) {
        db.createObjectStore(OFFLINE_STORES.progress, {keyPath: 'bookId'})
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORES.settings)) {
        db.createObjectStore(OFFLINE_STORES.settings, {keyPath: 'key'})
      }
    }

    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Offline database upgrade was blocked'))
  })

}

let accountGeneration = 0
export function offlineAccountToken(): number { return accountGeneration }
export function isOfflineAccount(token: number): boolean { return token === accountGeneration }
export function assertOfflineAccount(token: number): void {
  if (!isOfflineAccount(token)) throw new Error('Offline account changed during request')
}
let activeDatabaseName = OFFLINE_DB_NAME

export function offlineMediaCachePrefix(): string {
  return 'komga-offline-book-v2-' + encodeURIComponent(activeDatabaseName) + '-'
}

/**
 * Cache names are `<prefix><stableHash(bookId)>-<manifestRevision>`, e.g.
 * `...-<8 hex>-<pages>-<8 hex>`. A plain startsWith(prefix) check is not
 * enough: the default account prefix is a string prefix of per-user account
 * prefixes (`komga-offline-...` vs `komga-offline-user-B-...`), so one
 * account's orphan cleanup would delete another account's downloads.
 */
const OWN_BOOK_CACHE_SUFFIX = /^[0-9a-f]{8}-\d+-[0-9a-f]{8}$/

export function isOwnOfflineBookCache(name: string): boolean {
  const prefix = offlineMediaCachePrefix()
  if (!name.startsWith(prefix)) return false
  return OWN_BOOK_CACHE_SUFFIX.test(name.slice(prefix.length))
}

export function openOfflineDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) databasePromise = (async () => {
    const control = await openNamedDatabase(OFFLINE_DB_NAME)
    const pointer = await requestResult(control.transaction('settings', 'readonly').objectStore('settings').get('activeDatabase'))
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
    tx.objectStore('settings').put({key: 'userDatabase:' + previousUser, value: activeDatabaseName})
    await transactionDone(tx)
  }
  if (!previousUser || previousUser === userId) {
    control.close()
    await offlinePut('settings', {key: 'ownerUser', value: userId})
    return false
  }
  accountGeneration += 1
  const known = await requestResult(control.transaction('settings', 'readonly').objectStore('settings').get('userDatabase:' + userId))
  const name = known?.value || OFFLINE_DB_NAME + '-user-' + encodeURIComponent(userId)
  const transaction = control.transaction('settings', 'readwrite')
  transaction.objectStore('settings').put({key: 'activeDatabase', value: name})
  await transactionDone(transaction)
  control.close()
  current.close()
  databasePromise = null
  await openOfflineDatabase()
  await offlinePut('settings', {key: 'ownerUser', value: userId})
  navigator.serviceWorker?.controller?.postMessage({type: 'KOMGA_SESSION_CHANGED'})
  notifyOfflineAccountChanged()
  return true
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
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
  values.forEach(value => store.put(value))
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

/**
 * Page manifests live beside download records, not inside them: every boot
 * reads all records, and embedded manifests made that read scale with the
 * total number of downloaded pages. Same database version, so an older
 * cached UI or worker can still open it. Mirrors next-ui's offline-db.ts.
 */
export const downloadPagesKey = (bookId: string) => `downloadPages:${bookId}`
export const downloadRemotePagesKey = (bookId: string) => `downloadRemotePages:${bookId}`

/** undefined keeps the stored manifest, null deletes it. */
export interface DownloadPageManifests {
  pages?: unknown[] | null
  remotePages?: unknown[] | null
}

/** Persist a download record and its manifests atomically. */
export async function writeDownload(record: { bookId: string }, manifests: DownloadPageManifests = {}): Promise<void> {
  const db = await openOfflineDatabase()
  const tx = db.transaction([OFFLINE_STORES.downloads, OFFLINE_STORES.settings], 'readwrite')
  tx.objectStore(OFFLINE_STORES.downloads).put(record)
  const settings = tx.objectStore(OFFLINE_STORES.settings)
  const entries: [string, unknown[] | null | undefined][] = [
    [downloadPagesKey(record.bookId), manifests.pages],
    [downloadRemotePagesKey(record.bookId), manifests.remotePages],
  ]
  for (const [key, value] of entries) {
    if (value === null) settings.delete(key)
    else if (value) settings.put({key, value})
  }
  await transactionDone(tx)
}

export async function deleteDownload(bookId: string): Promise<void> {
  const db = await openOfflineDatabase()
  const tx = db.transaction([OFFLINE_STORES.downloads, OFFLINE_STORES.settings], 'readwrite')
  tx.objectStore(OFFLINE_STORES.downloads).delete(bookId)
  tx.objectStore(OFFLINE_STORES.settings).delete(downloadPagesKey(bookId))
  tx.objectStore(OFFLINE_STORES.settings).delete(downloadRemotePagesKey(bookId))
  await transactionDone(tx)
}

/**
 * Migration: records written before the split (or by an older cached UI)
 * embed `pages`/`remotePages`. Move them out once; strips the given records.
 */
export async function splitInlineDownloadManifests(
  records: { bookId: string, pages?: unknown[], remotePages?: unknown[] }[],
): Promise<void> {
  const legacy = records.filter(record => record.pages || record.remotePages)
  if (legacy.length === 0) return
  const db = await openOfflineDatabase()
  const tx = db.transaction([OFFLINE_STORES.downloads, OFFLINE_STORES.settings], 'readwrite')
  const downloads = tx.objectStore(OFFLINE_STORES.downloads)
  const settings = tx.objectStore(OFFLINE_STORES.settings)
  for (const record of legacy) {
    if (record.pages) settings.put({key: downloadPagesKey(record.bookId), value: record.pages})
    if (record.remotePages) settings.put({key: downloadRemotePagesKey(record.bookId), value: record.remotePages})
    delete record.pages
    delete record.remotePages
    downloads.put(record)
  }
  await transactionDone(tx)
}
