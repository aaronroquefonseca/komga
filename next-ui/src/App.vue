<template>
  <v-app>
    <v-main v-if="!route.matched.length">
      <v-empty-state
        :title="
          $formatMessage({
            defaultMessage: 'Opening Komga…',
            id: 'Jq9Fjf',
            description: 'App loading title',
          })
        "
      >
        <template #media><v-progress-circular indeterminate /></template>
      </v-empty-state>
    </v-main>
    <RouterView v-else />

    <SnackQueue />
    <DialogConfirmEditInstance />
    <DialogConfirmInstance />
    <DialogSimpleInstance />
  </v-app>
</template>

<script lang="ts" setup>
import { useThemeWatcher } from '@/composables/themeWatcher'
import { useSSE } from '@/composables/sse'
import { useAuthWatcher } from '@/composables/auth'
import { useOfflineBootstrap } from '@/composables/offline/useOfflineBootstrap'
import { useOfflineCoverCaching } from '@/composables/offline/useOfflineCoverCaching'

const route = useRoute()

// global composables
useThemeWatcher()
useSSE()
useAuthWatcher()
useOfflineBootstrap()
useOfflineCoverCaching()
</script>

<style>
@import 'styles/global.scss';
</style>
