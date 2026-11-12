const DEFAULT_REFRESH_TIMEOUT_MS = 5000

export class RefreshTimeoutError extends Error {
  constructor() {
    super('Query refresh timed out')
    this.name = 'RefreshTimeoutError'
  }
}

export function isRefreshTimeout(error: unknown): boolean {
  return error instanceof RefreshTimeoutError
}

/**
 * Races a query refresh against a timeout. Router guards await the current
 * user on every navigation; when the device reports online but the server is
 * unreachable (captive portal, dead route), the fetch hangs instead of
 * rejecting and the app would sit on a blank view forever.
 */
export function refreshWithTimeout<T>(
  promise: Promise<T>,
  ms: number = DEFAULT_REFRESH_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RefreshTimeoutError()), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}
