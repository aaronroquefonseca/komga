import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/vue'
import { createIntl } from 'vue-intl'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createVuetify } from 'vuetify'
import ItemCard from './ItemCard.vue'

afterEach(cleanup)

function renderCard(props: Partial<InstanceType<typeof ItemCard>['$props']> = {}) {
  return render(ItemCard, {
    props: { title: { text: 'Book' }, disableSelection: true, ...props },
    global: {
      plugins: [
        createIntl({ locale: 'en' }),
        createVuetify(),
        createRouter({
          history: createMemoryHistory(),
          routes: [{ path: '/', component: { template: '<div />' } }],
        }),
      ],
    },
  })
}

describe('independent download and reading badges', () => {
  test('a read book shows both the check mark and offline availability', () => {
    renderCard({ topRightIcon: 'i-mdi:check', downloadStatus: 'downloaded' })

    expect(screen.getByRole('img', { name: 'Read' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Available offline' })).toBeTruthy()
  })

  test('a series keeps its unread count alongside offline availability', () => {
    renderCard({ topRight: 24, downloadStatus: 'downloaded' })

    expect(screen.getByText('24')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Available offline' })).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'Read' })).toBeNull()
  })

  test('an in-progress download retains the reading progress bar', () => {
    renderCard({ progressPercent: 45, downloadStatus: 'downloaded' })

    expect(screen.getByRole('progressbar', { value: { now: 45 } })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Available offline' })).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'Read' })).toBeNull()
  })

  test('a download update keeps the read check mark', () => {
    renderCard({ topRightIcon: 'i-mdi:check', downloadStatus: 'update-available' })

    expect(screen.getByRole('img', { name: 'Read' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Downloaded; update available' })).toBeTruthy()
  })

  test('removing a download leaves the read check mark', async () => {
    const card = renderCard({
      topRightIcon: 'i-mdi:check',
      downloadStatus: 'downloaded',
    })
    await card.rerender({ downloadStatus: undefined })

    expect(screen.getByRole('img', { name: 'Read' })).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'Available offline' })).toBeNull()
  })
})
