<template>
  <v-alert
    v-if="localOnly"
    type="info"
    variant="tonal"
    rounded="0"
    role="status"
  >
    {{
      $formatMessage({
        defaultMessage:
          'You are offline. Showing saved content; only downloaded books can be read. Reading progress will sync when you reconnect.',
        id: 'c98pqU',
        description: 'Offline notice',
      })
    }}
    <div class="d-flex flex-wrap ga-1 mt-2">
      <v-btn
        variant="text"
        :text="
          $formatMessage({
            defaultMessage: 'Reconnect',
            id: 'uyLmvE',
            description: 'Offline reconnect action',
          })
        "
        @click="reconnect"
      />
      <v-btn
        v-if="$route.path !== '/downloads'"
        to="/downloads"
        variant="text"
        :text="
          $formatMessage({
            defaultMessage: 'Downloads',
            id: 'glX7JE',
            description: 'Offline notice downloads action',
          })
        "
      />
    </div>
  </v-alert>
</template>

<script setup lang="ts">
import { useOfflineLibraryStore } from '@/offline'
const offline = useOfflineLibraryStore()
const localOnly = computed(() => offline.offlineMode || !offline.online)
async function reconnect() {
  await offline.setOfflineMode(false)
  window.location.reload()
}
</script>
