import Vue from 'vue'
import VueI18n, {LocaleMessages} from 'vue-i18n'

Vue.use(VueI18n)

function loadLocaleMessages(): LocaleMessages {
  const locales = require.context('./locales', true, /[A-Za-z0-9-_,\s]+\.json$/i)
  const messages: LocaleMessages = {}
  locales.keys().forEach(key => {
    const matched = key.match(/([A-Za-z0-9-_]+)\./i)
    if (matched && matched.length > 1) {
      const locale = matched[1]
      messages[locale] = locales(key)
    }
  })
  return messages
}

const i18n = new VueI18n({
  locale: process.env.VUE_APP_I18N_LOCALE || 'en',
  fallbackLocale: process.env.VUE_APP_I18N_FALLBACK_LOCALE || 'en',
  messages: loadLocaleMessages(),
  pluralizationRules: {
    /**
     * @param choice {number} a choice index given by the input to `$tc('path.to.rule', choiceIndex)`
     * @param choicesLength {number} an overall amount of choices
     * @returns a final choice index to select plural word by
     */
    'pl': function (choice, choicesLength) {
      if (choice === 0) return 0
      if (choice === 1) return 1

      const betweenTwoAndFour = ((choice % 10) >= 2 && (choice % 10) <= 4)
      const lessThanTen = choice < 10
      const moreThanTwenty = choice > 20
      if (betweenTwoAndFour && (lessThanTen || moreThanTwenty)) return 2
      return (choicesLength < 4) ? 2 : 3
    },
  },
})

// Fork-only features use English fallback until they are moved into Weblate.
i18n.mergeLocaleMessage('en', {
  bookreader: {
    webtoon_pull_previous: 'Pull farther for the previous book',
    webtoon_release_previous: 'Release for the previous book',
    webtoon_pull_next: 'Pull farther for the next book',
    webtoon_release_next: 'Release for the next book',
    webtoon_pull_exit: 'Pull farther to leave the reader',
    webtoon_release_exit: 'Release to leave the reader',
    webtoon_hold_navigation: 'Hold to confirm',
    settings: {
      follow_finger: 'Follow finger',
      page_transition: 'Page transition',
      page_transition_types: {
        default: 'Slide (Default)',
        push: 'Push',
        cover: 'Cover',
        reveal: 'Reveal',
        parallax: 'Parallax / Depth',
        page_turn: '3D Page Flip',
        fade: 'Fade',
        soft_wipe: 'Soft Wipe',
        paper_curl: 'Paper Curl',
        physical_comic: 'Physical Comic',
        none: 'None',
      },
      webtoon_smooth_scroll: 'Smooth page scrolling',
      webtoon_page_navigation: 'Tap page navigation',
    },
  },
  offline: {
    downloads: 'Downloads',
    downloads_subtitle: 'Books stored locally on this device',
    offline_mode: 'Offline mode',
    offline_mode_description: 'Offline mode blocks Komga API and page streaming. Only locally cached metadata and downloaded pages are used.',
    offline_launch_ready: 'Offline launch ready',
    offline_launch_ready_description: 'The active service worker has a cached Komga application shell. The installed app should be able to cold-start without a connection.',
    offline_launch_not_ready: 'Offline launch is not ready yet',
    offline_launch_not_ready_description: 'Komga does not yet have a verified cached application shell for this installed app. Keep the server reachable and prepare it before testing a cold offline launch.',
    prepare_offline_launch: 'Prepare offline launch',
    offline_worker_details: 'Worker: {version} · controlled page: {controlled}',
    storage: 'Offline storage',
    storage_unavailable: 'Storage estimate unavailable',
    storage_used: '{usage} used by Komga',
    browser_quota: 'Browser quota: {quota}',
    browser_headroom: 'reported origin headroom: {available}',
    device_storage_warning: 'Browser quota is not the same as free device storage. Web apps cannot read the phone’s actual remaining storage, so downloads can run out of space before this quota is reached.',
    browser_quota_insufficient: 'Not enough browser storage quota for this download. Estimated need: {required}; reported headroom: {available}.',
    device_storage_full: 'Offline download stopped because browser or device storage is full. Free device storage or remove offline books, then retry.',
    catalog_cached: '{books} books and {series} series cached locally',
    downloading: 'Downloading',
    queued: 'Queued',
    paused: 'Paused',
    updating: 'Updating offline copy',
    old_copy_kept: 'current copy stays readable until complete',
    available_offline: 'Available offline',
    update_available: 'Update available',
    update_copy: 'Update',
    source_missing: 'No longer on server',
    update_failed_kept: 'Update failed; existing offline copy was kept',
    download_failed: 'Download failed',
    save_offline: 'Save for offline reading',
    save_series_offline: 'Save entire series offline',
    update_series_offline: 'Update offline series',
    download_series_remaining: 'Download remaining books ({downloaded}/{total})',
    downloading_series: 'Downloading series ({downloaded}/{total})',
    remove_series_downloads: 'Remove series offline copies',
    retry_download: 'Retry offline download',
    pause_download: 'Pause',
    resume_download: 'Resume',
    remove_download: 'Remove offline copy',
    manage_downloads: 'Manage downloads',
    download_settings: 'Download settings',
    parallel_books: 'Books downloaded at once',
    parallel_pages: 'Connections per book',
    progress_notifications: 'Show download progress notifications',
    remove_read_automatically: 'Remove books after finishing them',
    auto_download_next: 'Automatically download the next book',
    smart_download_hint: 'Smart rotation starts only after at least two books from a series are stored. Work is queued while offline and starts when Komga is reachable.',
    series_download_summary: '{downloaded}/{total} available · {bytes}',
    no_downloads: 'No offline books yet',
    no_downloads_description: 'Use a book or series action menu to save titles for offline reading.',
    unavailable_offline: 'This book is not downloaded on this device.',
  },
})

export default i18n
