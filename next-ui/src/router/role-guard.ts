import type { Router } from 'vue-router'
import { currentUserQuery, QUERY_KEYS_USERS } from '@/colada/users'
import { useQueryCache } from '@pinia/colada'
import type { UserDto } from '@/generated/openapi'

/**
 * Check if the user has the necessary role before navigating to restricted pages.
 * The authentication is cached by Pinia Colada.
 * Redirect to the home page in case of insufficient permissions.
 */
export function useRoleGuard(router: Router) {
  router.beforeEach(async (to) => {
    if (to.meta.requiresRole) {
      const queryCache = useQueryCache()
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        // Offline: judge from the restored cached session instead of
        // forcing a network refresh that can only fail.
        const cached = queryCache.getQueryData<UserDto>(QUERY_KEYS_USERS.currentUser())
        if (!cached) return { name: '/login' }
        if (!cached.roles?.includes(to.meta.requiresRole)) return { name: '/' }
        return
      }
      const entry = queryCache.ensure(currentUserQuery)
      try {
        const state = await queryCache.refresh(entry)

        if (!state.data?.roles?.includes(to.meta.requiresRole)) {
          return { name: '/' }
        }
      } catch (ignored) {
        return { name: '/error' }
      }
    }
  })
}
