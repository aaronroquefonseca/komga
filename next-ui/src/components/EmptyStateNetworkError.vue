<template>
  <OfflineUnavailable v-if="offline.offlineMode || !offline.online" />
  <v-empty-state
    v-else
    icon="i-mdi:connection"
    :title="$formatMessage(commonMessages.somethingWentWrongTitle)"
    :text="$formatMessage(commonMessages.somethingWentWrongSubTitle)"
  />
</template>

<script setup lang="ts">
import { useOfflineLibraryStore } from '@/offline'
const offline = useOfflineLibraryStore()
import { commonMessages } from '@/utils/i18n/common-messages'
</script>
