<template>
  <LibraryNavigation
    :key="libraryViewId"
    :library-view-id="libraryViewId"
  />
</template>

<script lang="ts" setup>
import { useOfflineLibraryStore } from '@/offline'
import { filterKeys } from '@/types/filter'
import { useGetLibrariesByViewId, useUserLibraries } from '@/composables/libraries'
import { BrowsingContextKey } from '@/functions/browsing-context'

const route = useRoute('/libraries/[viewId]')
const router = useRouter()
const offline = useOfflineLibraryStore()
const { noLibraries, anyPinned, anyUnpinned } = useUserLibraries()
const libraryViewId = computed(() => route.params.viewId)
const { libraryIds } = useGetLibrariesByViewId(libraryViewId)

provide(
  filterKeys.context,
  computed(() => ({ library_id: libraryIds.value })),
)
provide(
  BrowsingContextKey,
  computed(() => ({ type: 'libraryView', id: libraryViewId.value })),
)

watch([noLibraries, anyPinned, anyUnpinned], ([newNoLibraries, hasPinned, hasUnpinned]) => {
  if (newNoLibraries && offline.online && !offline.offlineMode) {
    void router.push({ name: '/libraries/create' })
  } else if (
    (libraryViewId.value === 'pinned' && !hasPinned) ||
    (libraryViewId.value === 'unpinned' && !hasUnpinned)
  ) {
    void router.replace({
      name: '/libraries/[viewId]/overview',
      params: { viewId: 'all' },
    })
  }
})
</script>

<route lang="yaml">
meta:
  requiresRole: USER
</route>
