import type { Router } from 'vue-router'
import { claimStatusQuery } from '@/colada/claim'
import { useQueryCache } from '@pinia/colada'
import { isRefreshTimeout, refreshWithTimeout } from '@/router/refresh-with-timeout'

/**
 * Check if the server has already been claimed.
 */
export function useClaimGuard(router: Router) {
  router.beforeEach(async (to) => {
    if (to.name === '/claim' || to.name === '/login') {
      // check cache
      const queryCache = useQueryCache()

      const cacheEntry = queryCache.ensure(claimStatusQuery)
      try {
        const state = await refreshWithTimeout(queryCache.refresh(cacheEntry))

        if (to.name === '/login' && !state.data?.isClaimed) return { name: '/claim' }
        if (to.name === '/claim' && state.data?.isClaimed) return { name: '/login' }
      } catch (e) {
        // A hanging request (link up, server unreachable) must not blank the
        // page: let the entry page render. Other failures keep old behavior.
        if (isRefreshTimeout(e)) return
        return { name: '/error' }
      }
    }
  })
}
