<template>
  <LayoutAppBarHolder />

  <!-- xs only: drawer comes first and will appear over the app bar  -->
  <LayoutAppDrawer :order="display.xs.value ? -1 : 0" />

  <v-main scrollable>
    <OfflineNotice />
    <OfflineUnavailable v-if="unavailableOffline" />
    <RouterView v-else />
  </v-main>
</template>

<script lang="ts" setup>
import { useOfflineLibraryStore } from '@/offline'
import { useDisplay } from 'vuetify'

const display = useDisplay()
const offline = useOfflineLibraryStore()
const route = useRoute()
const unavailableOffline = computed(
  () =>
    (offline.offlineMode || !offline.online) &&
    (/^\/(server|media|import|history|collection|readlist)(\/|$)/.test(route.path) ||
      /^\/account\/(?!ui(?:\/|$))/.test(route.path) ||
      /\/(collections|readlists)$/.test(route.path)),
)
</script>
