/**
 * main.ts
 *
 * Bootstraps Vuetify and other plugins then mounts the App`
 */

// Plugins
import { registerPlugins } from '@/plugins'
import 'virtual:uno.css'

// Components
import App from './App.vue'

// Composables
import { createApp } from 'vue'
import { initLogger } from '@/services/logtape'
import { setupOpenapiClient } from '@/api/komga-client'
import router from '@/router'
import { setupOfflineShell } from '@/services/offline-shell'

await initLogger()

setupOpenapiClient()

const app = createApp(App)

registerPlugins(app)

app.mount('#app')

setupOfflineShell(router)
