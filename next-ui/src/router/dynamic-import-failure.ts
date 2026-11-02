/**
 * Recovery decision for a failed Vue Router navigation.
 *
 * Lazy chunks can fail to load when the precached app shell is incomplete
 * (for example the user went offline mid-precache). A `location.assign`
 * reload can never succeed while offline, so the router must fall back to
 * the precached `/error` route instead of reloading into a blank page.
 */
export type DynamicImportRecovery = 'reload' | 'error-page' | 'none'

export function isDynamicImportError(error: unknown): boolean {
  const message = (error as { message?: unknown } | null | undefined)?.message
  return (
    typeof message === 'string' && message.includes('Failed to fetch dynamically imported module')
  )
}

export function decideDynamicImportRecovery(options: {
  error: unknown
  online: boolean
  alreadyRetried: boolean
  isErrorRoute: boolean
}): DynamicImportRecovery {
  if (!isDynamicImportError(options.error)) return 'none'
  if (options.alreadyRetried || options.isErrorRoute) return 'none'
  return options.online ? 'reload' : 'error-page'
}
