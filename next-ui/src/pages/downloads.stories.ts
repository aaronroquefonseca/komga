import type { Meta, StoryObj } from '@storybook/vue3-vite'

import downloads from './downloads.vue'

const meta = {
  component: downloads,
  render: () => ({
    components: { downloads },
    template: '<downloads />',
  }),
  parameters: {
    docs: {
      description: {
        component: 'Offline downloads management, mirroring the classic Downloads view.',
      },
    },
  },
  args: {},
} satisfies Meta<typeof downloads>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {},
}

export const Empty: Story = {
  args: {},
}
