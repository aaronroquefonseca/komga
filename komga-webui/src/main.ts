import _, {LoDashStatic} from 'lodash'
import Vue from 'vue'
// @ts-ignore
import * as lineClamp from 'vue-line-clamp'
import Vuelidate from 'vuelidate'
// @ts-ignore
import Chartkick from 'vue-chartkick'
// @ts-ignore
import Chart from 'chart.js'
import {sync} from 'vuex-router-sync'
import App from './App.vue'
import actuator from './plugins/actuator.plugin'
import httpPlugin from './plugins/http.plugin'
import offlineLibrary from './plugins/offline-library.plugin'
import offlineKomgaAdapter, {getOfflineSessionUser} from './plugins/offline-komga-adapter.plugin'
import komgaBooks from './plugins/komga-books.plugin'
import komgaClaim from './plugins/komga-claim.plugin'
import komgaCollections from './plugins/komga-collections.plugin'
import komgaReadLists from './plugins/komga-readlists.plugin'
import komgaFileSystem from './plugins/komga-filesystem.plugin'
import komgaLibraries from './plugins/komga-libraries.plugin'
import komgaReferential from './plugins/komga-referential.plugin'
import komgaSeries from './plugins/komga-series.plugin'
import komgaUsers from './plugins/komga-users.plugin'
import komgaTransientBooks from './plugins/komga-transientbooks.plugin'
import komgaSse from './plugins/komga-sse.plugin'
import komgaTasks from './plugins/komga-tasks.plugin'
import komgaSyncPoints from './plugins/komga-syncpoints.plugin'
import komgaOauth2 from './plugins/komga-oauth2.plugin'
import komgaLogin from './plugins/komga-login.plugin'
import komgaPageHashes from './plugins/komga-pagehashes.plugin'
import komgaMetrics from './plugins/komga-metrics.plugin'
import komgaHistory from './plugins/komga-history.plugin'
import komgaAnnouncements from './plugins/komga-announcements.plugin'
import komgaReleases from './plugins/komga-releases.plugin'
import komgaSettings from './plugins/komga-settings.plugin'
import komgaFonts from './plugins/komga-fonts.plugin'
import {installPhysicalPagedReader} from './plugins/paged-reader-physical.plugin'
import {installPhysicalPagedReaderSettlementGuard} from './plugins/paged-reader-physical-settlement.plugin'
import vuetify from './plugins/vuetify'
import logger from './plugins/logger.plugin'
import './public-path'
import './assets/paged-reader-compositor.css'
import router from './router'
import store from './store'
import i18n from './i18n'
import urls from './functions/urls'
import OfflineDownloads from './views/OfflineDownloads.vue'

Vue.prototype.$_ = _
Vue.prototype.$eventHub = new Vue()

Chartkick.options = {
  colors: [
    '#7eb0d5', '#fd7f6f', '#b2e061', '#ffb55a',
    '#8bd3c7', '#ffee65', '#bd7ebe', '#fdcce5',
    '#beb9db', '#ea5545', '#f46a9b', '#ef9b20', '#edbf33', '#ede15b', '#bdcf32', '#87bc45', '#27aeef', '#b33dc6',
  ],
}

Vue.use(Vuelidate)
Vue.use(lineClamp)
Vue.use(Chartkick.use(Chart))

Vue.use(httpPlugin)
Vue.use(logger)
Vue.use(offlineLibrary, {http: Vue.prototype.$http})
Vue.use(komgaSettings, {store: store, http: Vue.prototype.$http})
Vue.use(komgaFileSystem, {http: Vue.prototype.$http})
Vue.use(komgaSeries, {http: Vue.prototype.$http})
Vue.use(komgaCollections, {http: Vue.prototype.$http})
Vue.use(komgaReadLists, {http: Vue.prototype.$http})
Vue.use(komgaBooks, {http: Vue.prototype.$http})
Vue.use(komgaReferential, {http: Vue.prototype.$http})
Vue.use(komgaClaim, {http: Vue.prototype.$http})
Vue.use(komgaTransientBooks, {http: Vue.prototype.$http})
Vue.use(komgaUsers, {store: store, http: Vue.prototype.$http})
Vue.use(komgaLibraries, {store: store, http: Vue.prototype.$http})
Vue.use(komgaSse, {eventHub: Vue.prototype.$eventHub, store: store})
Vue.use(actuator, {http: Vue.prototype.$http})
Vue.use(komgaTasks, {http: Vue.prototype.$http})
Vue.use(komgaSyncPoints, {http: Vue.prototype.$http})
Vue.use(komgaOauth2, {http: Vue.prototype.$http})
Vue.use(komgaLogin, {http: Vue.prototype.$http})
Vue.use(komgaPageHashes, {http: Vue.prototype.$http})
Vue.use(komgaMetrics, {http: Vue.prototype.$http})
Vue.use(komgaHistory, {http: Vue.prototype.$http})
Vue.use(komgaAnnouncements, {http: Vue.prototype.$http})
Vue.use(komgaReleases, {http: Vue.prototype.$http})
Vue.use(komgaFonts, {http: Vue.prototype.$http})
Vue.use(offlineKomgaAdapter)

Vue.config.productionTip = false

installPhysicalPagedReader()
installPhysicalPagedReaderSettlementGuard()
sync(store, router)

router.addRoute('home', {
  path: '/downloads',
  name: 'offline-downloads',
  component: OfflineDownloads,
})

router.beforeEach(async (to, from, next) => {
  await Vue.prototype.$offline.whenReady()
  if (to.name === 'read-book' &&
    (Vue.prototype.$offline.state.offlineMode || !Vue.prototype.$offline.state.online) &&
    !Vue.prototype.$offline.isDownloaded(to.params.bookId)) {
    next({name: 'offline-downloads'})
    return
  }
  next()
})

const CATALOG_SYNC_INTERVAL = 5 * 60 * 1000
let lastCatalogSync = 0
let catalogSyncScheduled = false

const syncOfflineState = (forceCatalog: boolean = false) => {
  if (!store.getters.authenticated || catalogSyncScheduled || !Vue.prototype.$offline.state.online) return
  catalogSyncScheduled = true

  const shouldSyncCatalog = forceCatalog || Date.now() - lastCatalogSync >= CATALOG_SYNC_INTERVAL
  const reconcile = shouldSyncCatalog
    ? Vue.prototype.$offline.syncCatalogMetadata().then(() => { lastCatalogSync = Date.now() })
    : Promise.resolve()

  // Reconcile downloaded revisions before flushing progress that may have been
  // recorded against an older page numbering.
  reconcile
    .then(() => Vue.prototype.$offline.flushProgressQueue())
    .catch(() => undefined)
    .finally(() => { catalogSyncScheduled = false })
}

router.afterEach(() => syncOfflineState())
window.addEventListener('focus', () => syncOfflineState())
window.addEventListener('online', () => syncOfflineState(true))
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncOfflineState()
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${urls.base}service-worker.js`, {scope: urls.base})
      .then(() => Vue.prototype.$offline.whenReady())
      .then(() => Vue.prototype.$offline.setOfflineMode(Vue.prototype.$offline.state.offlineMode))
      .catch(error => console.warn('Komga offline service worker registration failed', error))
  })
}

async function bootstrap() {
  await Vue.prototype.$offline.whenReady()

  // Komga normally keeps the current user only in Vuex memory. Restore the last
  // successful identity/roles before Vue Router performs its initial auth guard,
  // but only when the app is intentionally local-only or the network is absent.
  if (!store.getters.authenticated &&
    (Vue.prototype.$offline.state.offlineMode || !Vue.prototype.$offline.state.online)) {
    const cachedUser = await getOfflineSessionUser()
    if (cachedUser) store.commit('setMe', cachedUser)
  }

  new Vue({
    router,
    store,
    vuetify,
    i18n,
    render: h => h(App),
  }).$mount('#app')
}

bootstrap().catch(error => {
  console.error('Komga bootstrap failed', error)
})

declare module 'vue/types/vue' {
  interface Vue {
    $_: LoDashStatic;
    $eventHub: Vue;
  }

declare global {
  interface Window {
    resourceBaseUrl: string
  }
}
