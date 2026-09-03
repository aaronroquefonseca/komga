<template>
  <div
    class="continuous-reader"
    @touchstart="pullStart"
    @touchmove="pullMove"
    @touchend="pullEnd"
    @touchcancel="pullCancel"
  >
    <div :class="`d-flex flex-column px-0 mx-0` "
         v-scroll="onScroll"
    >
      <div class="edge-pull" :style="pullIndicatorStyle('previous')" aria-live="polite">
        <div class="edge-pull-content" :style="pullContentStyle('previous')">
          <v-icon>{{ pullArmed && pullDirection === 'previous' ? 'mdi-arrow-down-bold' : 'mdi-arrow-down' }}</v-icon>
          <span>{{ pullMessage('previous') }}</span>
        </div>
      </div>
      <img v-for="(page, i) in pages"
           :key="`page${i}`"
           :alt="`Page ${page.number}`"
           :src="shouldLoad(i) ? page.url : undefined"
           :height="calcHeight(page)"
           :width="calcWidth(page)"
           :id="`page${page.number}`"
           :style="`margin: ${i === 0 ? 0 : pageMargin}px auto;`"
           v-intersect="onIntersect"
      />
      <div class="edge-pull" :style="pullIndicatorStyle('next')" aria-live="polite">
        <div class="edge-pull-content" :style="pullContentStyle('next')">
          <v-icon>{{ pullArmed && pullDirection === 'next' ? 'mdi-arrow-up-bold' : 'mdi-arrow-up' }}</v-icon>
          <span>{{ pullMessage('next') }}</span>
        </div>
      </div>
    </div>

    <!--  clickable zone: top  -->
    <div v-if="pageNavigation"
         @click="prev()"
         class="top-quarter"
         style="z-index: 1;"
    />

    <!--  clickable zone: bottom  -->
    <div v-if="pageNavigation"
         @click="next()"
         class="bottom-quarter"
         style="z-index: 1;"
    />

    <!--  clickable zone: menu  -->
    <div @click="centerClick()"
         class="center-vertical"
         style="z-index: 1;"
    />
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import {ContinuousScaleType} from '@/types/enum-reader'
import {PageDtoWithUrl} from '@/types/komga-books'
import {throttle} from 'lodash'

export default Vue.extend({
  name: 'ContinuousReader',
  data: () => {
    return {
      offsetTop: 0,
      totalHeight: 1000,
      currentPage: 1,
      seen: [] as boolean[],
      pullStartX: 0,
      pullStartY: 0,
      pullDistance: 0,
      pullDirection: null as 'previous' | 'next' | null,
      pullTracking: false,
      pullArmed: false,
      pullSettling: false,
      pullThreshold: 82,
      pullMaximum: 116,
    }
  },
  props: {
    pages: {
      type: Array as () => PageDtoWithUrl[],
      required: true,
    },
    smoothScroll: {
      type: Boolean,
      required: true,
    },
    pageNavigation: {
      type: Boolean,
      default: true,
    },
    page: {
      type: Number,
      required: true,
    },
    scale: {
      type: String as () => ContinuousScaleType,
      required: true,
    },
    sidePadding: {
      type: Number,
      required: true,
    },
    pageMargin: {
      type: Number,
      required: true,
    },
    previousAvailable: {
      type: Boolean,
      default: false,
    },
    nextAvailable: {
      type: Boolean,
      default: false,
    },
  },
  watch: {
    pages: {
      handler(val) {
        this.seen = new Array(val.length).fill(false)
        if (this.page === 1) window.scrollTo(0, 0)
      },
      immediate: true,
    },
    page: {
      handler(val) {
        if (val != this.currentPage) {
          this.$vuetify.goTo(`#page${val}`, {
            duration: 0,
          })
        }
      },
      immediate: false,
    },
  },
  created() {
    window.addEventListener('keydown', this.keyPressed)
  },
  destroyed() {
    window.removeEventListener('keydown', this.keyPressed)
  },
  mounted() {
    if (this.page != this.currentPage) {
      this.$vuetify.goTo(`#page${this.page}`, {
        duration: 0,
      })
    }
  },
  computed: {
    canPrev(): boolean {
      return this.offsetTop > 0
    },
    canNext(): boolean {
      return this.offsetTop + this.$vuetify.breakpoint.height < this.totalHeight
    },
    goToOptions(): object | undefined {
      if (this.smoothScroll) return undefined
      return {duration: 0}
    },
    totalSidePadding(): number {
      return this.sidePadding * 2
    },
  },
  methods: {
    pullIndicatorStyle(direction: 'previous' | 'next') {
      const active = this.pullDirection === direction
      return {
        height: `${active ? this.pullDistance : 0}px`,
        transition: this.pullSettling ? 'height 220ms cubic-bezier(.2, .8, .2, 1)' : 'none',
      }
    },
    pullContentStyle(direction: 'previous' | 'next') {
      const active = this.pullDirection === direction
      const progress = active ? Math.min(1, this.pullDistance / this.pullThreshold) : 0
      return {
        opacity: `${progress}`,
        transform: `scale(${0.86 + progress * 0.14})`,
      }
    },
    pullMessage(direction: 'previous' | 'next'): string {
      if (direction === 'previous') {
        return this.$t(this.pullArmed && this.pullDirection === direction
          ? 'bookreader.webtoon_release_previous'
          : 'bookreader.webtoon_pull_previous').toString()
      }
      if (!this.nextAvailable) {
        return this.$t(this.pullArmed && this.pullDirection === direction
          ? 'bookreader.webtoon_release_exit'
          : 'bookreader.webtoon_pull_exit').toString()
      }
      return this.$t(this.pullArmed && this.pullDirection === direction
        ? 'bookreader.webtoon_release_next'
        : 'bookreader.webtoon_pull_next').toString()
    },
    pullStart(e: TouchEvent) {
      if (e.touches.length !== 1 || this.pullSettling) return
      const root = document.scrollingElement
      if (!root) return
      const atTop = root.scrollTop <= 1
      const atBottom = root.scrollTop + window.innerHeight >= root.scrollHeight - 2
      if ((!atTop || !this.previousAvailable) && !atBottom) return
      this.pullStartX = e.touches[0].clientX
      this.pullStartY = e.touches[0].clientY
      this.pullTracking = true
      this.pullDirection = null
      this.pullDistance = 0
      this.pullArmed = false
    },
    pullMove(e: TouchEvent) {
      if (!this.pullTracking || e.touches.length !== 1) return
      const dx = e.touches[0].clientX - this.pullStartX
      const dy = e.touches[0].clientY - this.pullStartY
      if (!this.pullDirection) {
        if (Math.abs(dx) > Math.abs(dy) || Math.abs(dy) < 8) return
        const root = document.scrollingElement
        if (!root) return
        if (dy > 0 && root.scrollTop <= 1 && this.previousAvailable) this.pullDirection = 'previous'
        else if (dy < 0 && root.scrollTop + window.innerHeight >= root.scrollHeight - 2) this.pullDirection = 'next'
        else {
          this.pullTracking = false
          return
        }
      }

      const rawDistance = this.pullDirection === 'previous' ? dy : -dy
      if (rawDistance <= 0) return
      e.preventDefault()
      const distance = Math.min(this.pullMaximum, rawDistance * 0.5)
      const wasArmed = this.pullArmed
      this.pullDistance = distance
      this.pullArmed = distance >= this.pullThreshold
      if (!wasArmed && this.pullArmed) this.vibrate(12)
      if (this.pullDirection === 'next') {
        this.$nextTick(() => window.scrollTo(0, document.documentElement.scrollHeight))
      }
    },
    pullEnd() {
      if (!this.pullTracking) return
      const direction = this.pullDirection
      const trigger = this.pullArmed && direction !== null
      this.resetPull()
      if (trigger) {
        this.vibrate([18, 30, 24])
        this.$emit(direction === 'previous' ? 'edge-previous' : 'edge-next')
      }
    },
    pullCancel() {
      if (this.pullTracking) this.resetPull()
    },
    resetPull() {
      const wasNext = this.pullDirection === 'next'
      this.pullTracking = false
      this.pullArmed = false
      this.pullSettling = true
      this.pullDistance = 0
      window.setTimeout(() => {
        this.pullDirection = null
        this.pullSettling = false
        if (wasNext) window.scrollTo(0, document.documentElement.scrollHeight)
      }, 220)
    },
    vibrate(pattern: number | number[]) {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern)
      }
    },
    keyPressed: throttle(function (this: any, e: KeyboardEvent) {
      switch (e.key) {
        case ' ':
        case 'PageDown':
        case 'ArrowDown':
          if (!this.canNext) this.$emit('jump-next')
          break
        case 'PageUp':
        case 'ArrowUp':
          if (!this.canPrev) this.$emit('jump-previous')
          break
      }
    }, 500),
    onScroll(e: any) {
      this.offsetTop = e.target.scrollingElement.scrollTop
      this.totalHeight = e.target.scrollingElement.scrollHeight
    },
    onIntersect(entries: any) {
      if (entries[0].isIntersecting) {
        const page = parseInt(entries[0].target.id.replace('page', ''))
        this.seen.splice(page - 1, 1, true)
        this.currentPage = page
        this.$emit('update:page', page)
      }
    },
    shouldLoad(page: number): boolean {
      return page == 0 || this.seen[page] || Math.abs((this.currentPage - 1) - page) <= 2
    },
    calcHeight(page: PageDtoWithUrl): number | undefined {
      switch (this.scale) {
        case ContinuousScaleType.WIDTH:
          if (page.height && page.width)
            return page.height / (page.width / (this.$vuetify.breakpoint.width - (this.$vuetify.breakpoint.width * this.totalSidePadding) / 100))
          return undefined
        case ContinuousScaleType.ORIGINAL:
          return page.height || undefined
        default:
          return undefined
      }
    },
    calcWidth(page: PageDtoWithUrl): number | undefined {
      switch (this.scale) {
        case ContinuousScaleType.WIDTH:
          return this.$vuetify.breakpoint.width - (this.$vuetify.breakpoint.width * this.totalSidePadding) / 100
        case ContinuousScaleType.ORIGINAL:
          return page.width || undefined
        default:
          return undefined
      }
    },
    centerClick() {
      this.$emit('menu')
    },
    prev() {
      if (this.canPrev) {
        const step = this.$vuetify.breakpoint.height * 0.95
        this.$vuetify.goTo(this.offsetTop - step, this.goToOptions)
      } else {
        this.$emit('jump-previous')
      }
    },
    next() {
      if (this.canNext) {
        const step = this.$vuetify.breakpoint.height * 0.95
        this.$vuetify.goTo(this.offsetTop + step, this.goToOptions)
      } else {
        this.$emit('jump-next')
      }
    },
  },
})
</script>
<style scoped>
.continuous-reader {
  min-height: 100%;
}

.edge-pull {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  justify-content: center;
  overflow: hidden;
  width: 100%;
}

.edge-pull-content {
  align-items: center;
  color: rgba(255, 255, 255, 0.9);
  display: flex;
  flex-direction: column;
  font-size: 0.9rem;
  font-weight: 500;
  gap: 2px;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.68);
  border-radius: 18px;
  text-align: center;
  transform-origin: center;
}

.top-quarter {
  top: 0;
  height: 25vh;
  width: 100%;
  position: fixed;
}

.bottom-quarter {
  top: 75vh;
  height: 25vh;
  width: 100%;
  position: fixed;
}

.center-vertical {
  top: 25vh;
  height: 50vh;
  width: 100%;
  position: fixed;
}
</style>
