import type { Router } from 'vue-router'
import { currentUserQuery, QUERY_KEYS_USERS } from '@/colada/users'
import { useQueryCache } from '@pinia/colada'
import { isApiErrorWithCause } from '@/api/komga-client'
import { isRefreshTimeout, refreshWithTimeout } from '@/router/refresh-with-timeout'
import type { UserDto } from '@/generated/openapi'

/**
 * Check if the user is authenticated before navigating to any page.
 * The authentication is cached by Pinia Colada.
 * Redirect to the startup page if not authenticated.
 */
export function useLoginGuard(router: Router) {
  router.beforeEach(async (to) => {
    if (!to.meta.noAuth) {
      const queryCache = useQueryCache()
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        // Offline: never force a network refresh (it always fails and would
        // bounce to /error). Trust the restored cached session instead.
        const cached = queryCache.getQueryData<UserDto>(QUERY_KEYS_USERS.currentUser())
        if (cached) return
        return { name: '/login' }
      }
      const entry = queryCache.ensure(currentUserQuery)
      try {
        const state = await refreshWithTimeout(queryCache.refresh(entry))

        const isAuthenticated = !!state.data

        if (!isAuthenticated) {
          const query = Object.assign(
            {},
            to.query,
            to.fullPath !== '/' ? { redirect: to.fullPath } : {},
          )
          return { name: '/startup', query: query }
        }
      } catch (e) {
        if (isApiErrorWithCause(e) && e.cause.status === 401) return { name: '/login' }
        // Offline or unreachable (including hanging requests when the link
        // is up but the server is not): fall back to the restored session.
        const cached = queryCache.getQueryData<UserDto>(QUERY_KEYS_USERS.currentUser())
        if (cached) return
        if (isRefreshTimeout(e)) return { name: '/login' }
        return { name: '/error' }
      }
    }
  })
}
