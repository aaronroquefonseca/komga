<template>
  <v-list-item
    v-if="visible"
    to="/downloads"
    :title="
      $formatMessage({
        description: 'Drawer menu for Downloads',
        defaultMessage: 'Downloads',
        id: 'g9V949',
      })
    "
    prepend-icon="i-mdi:download"
  />
</template>

<script setup lang="ts">
import { useCurrentUser } from '@/colada/users'
import { isStandalonePwa } from '@/functions/pwa'

const { hasRole } = useCurrentUser()

const visible = computed(() => isStandalonePwa() && hasRole('FILE_DOWNLOAD'))
</script>
