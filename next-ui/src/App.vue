<template>
  <v-app>
    <RouterView />

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

// global composables
useThemeWatcher()
useSSE()
useAuthWatcher()
useOfflineBootstrap()
</script>

<style>
@import 'styles/global.scss';
</style>
