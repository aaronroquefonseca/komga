export const OFFLINE_DB_NAME = 'komga-offline'
export const OFFLINE_DB_VERSION = 1

export const OFFLINE_STORES = {
  books: 'books',
  series: 'series',
  pages: 'pages',
  downloads: 'downloads',
  progress: 'progress',
  settings: 'settings',
} as const

let databasePromise: Promise<IDBDatabase> | null = null

export function openOfflineDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)

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

  return databasePromise
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
