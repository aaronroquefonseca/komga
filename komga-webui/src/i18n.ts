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
     * @param choice {number} a choice index given by the input to $tc: `$tc('path.to.rule', choiceIndex)`
     * @param choicesLength {number} an overall amount of choices
     * @returns a final choice index to select plural word by
     */
    'pl': function (choice, choicesLength) {
      // brak stron
      if (choice === 0) {
        return 0
      }

      // 1 strona
      if (choice === 1) {
        return 1
      }

      const betweenTwoAndFour = ((choice % 10) >= 2 && (choice % 10) <= 4)
      const lessThanTen = choice < 10
      const moreThanTwenty = choice > 20

      // 2 strony, 3 strony, 4 strony, 22 strony ...
      if (betweenTwoAndFour && (lessThanTen || moreThanTwenty)) {
        return 2
      }

      // other cases, 5 stron, 67 stron, 259 stron and so on
      return (choicesLength < 4) ? 2 : 3
    },
  },
})

// Fork-only reader settings use English fallback until they are moved into Weblate.
i18n.mergeLocaleMessage('en', {
  bookreader: {
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
})

export default i18n