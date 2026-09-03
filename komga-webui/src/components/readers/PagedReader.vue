<template>
  <div
    :class="{'paged-reader-root': customRendererEnabled}"
    :style="interactiveGestureEnabled ? {touchAction: vertical ? 'pan-x' : 'pan-y'} : undefined"
    v-touch="{
      left: () => {if(swipe && !interactiveGestureEnabled) {turnRight()}},
      right: () => {if(swipe && !interactiveGestureEnabled) {turnLeft()}},
      up: () => {if(swipe && !interactiveGestureEnabled) {verticalNext()}},
      down: () => {if(swipe && !interactiveGestureEnabled) {verticalPrev()}}
    }"
    @touchstart="followFingerStart"
    @touchmove="followFingerMove"
    @touchend="followFingerEnd"
    @touchcancel="followFingerCancel"
    @click.capture="onClickCapture"
  >
    <!-- Original Komga/Vuetify renderer. This path is left intact for Slide
         (Default) without Follow finger and for None. -->
    <v-carousel
      v-if="!customRendererEnabled"
      v-model="carouselPage"
      :show-arrows="false"
      :continuous="false"
      :reverse="flipDirection"
      :vertical="vertical"
      hide-delimiters
      touchless
      height="100%"
    >
      <v-carousel-item
        v-for="(spread, i) in spreads"
        :key="`spread${i}`"
        :eager="eagerLoad(i)"
        class="full-height"
        :class="preRender(i) ? 'pre-render' : ''"
        :transition="carouselAnimations ? undefined : false"
        :reverse-transition="carouselAnimations ? undefined : false"
      >
        <paged-reader-spread
          :spread="spread"
          :flip-direction="flipDirection"
          :scale="scale"
        />
      </v-carousel-item>
    </v-carousel>

    <!-- Custom renderer. The invisible anchor is the only normal-flow content;
         Vuetify is completely absent in this mode. This prevents its window
         bookkeeping from re-laying out the visible page at gesture settlement. -->
    <div v-else class="custom-reader-stage">
      <div
        class="custom-layout-anchor"
        :style="drag.directionHandoffCover ? {visibility: 'visible', zIndex: '20'} : undefined"
        aria-hidden="true"
      >
        <paged-reader-spread
          v-if="spreads[visualPage]"
          :spread="spreads[visualPage]"
          :flip-direction="flipDirection"
          :scale="scale"
        />
      </div>

      <div class="transition-layer">
        <div
          v-for="(spread, spreadIndex) in spreads"
          :key="`transition-spread-${spreadIndex}`"
          class="transition-spread"
          :class="transitionSpreadClasses(spreadIndex)"
          :style="customSpreadStyle(spreadIndex)"
        >
          <template v-if="shouldRenderCustomSpread(spreadIndex)">
            <paged-reader-paper-sheet
              v-if="isPaperCurlCurrent(spreadIndex)"
              :front-spread="spread"
              :back-spread="paperCurlBackSpread"
              :flip-direction="flipDirection"
              :scale="scale"
              :progress="transitionProgressValue"
              :physical-direction="activePhysicalDirection"
              :variant="drag.curlVariant"
            />

            <paged-reader-spread
              v-else
              :spread="spread"
              :flip-direction="flipDirection"
              :scale="scale"
            />
          </template>
        </div>
      </div>
    </div>

    <div
      v-if="!vertical"
      @click="turnLeft()"
      class="left-quarter"
      style="z-index: 1;"
    />

    <div
      v-if="!vertical"
      @click="turnRight()"
      class="right-quarter"
      style="z-index: 1;"
    />

    <div
      v-if="vertical"
      @click="verticalPrev()"
      class="top-quarter"
      style="z-index: 1;"
    />

    <div
      v-if="vertical"
      @click="verticalNext()"
      class="bottom-quarter"
      style="z-index: 1;"
    />

    <div
      @click="centerClick()"
      :class="`${vertical ? 'center-vertical' : 'center-horizontal'}`"
      style="z-index: 1;"
    />
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import {ReadingDirection} from '@/types/enum-books'
import {PagedReaderLayout, PagedReaderTransition, ScaleType} from '@/types/enum-reader'
import {shortcutsLTR, shortcutsRTL, shortcutsVertical} from '@/functions/shortcuts/paged-reader'
import {PageDtoWithUrl} from '@/types/komga-books'
import {buildSpreads} from '@/functions/book-spreads'
import PagedReaderSpread from '@/components/readers/PagedReaderSpread.vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {
  dragOffsetWithResistance,
  navigationDeltaForDrag,
  shouldCommitDrag,
} from '@/functions/paged-reader-drag'
import {
  PageCurlVariant,
  pageCurlRotation,
  pageCurlVariantForStart,
  transitionProgress,
} from '@/functions/paged-reader-transition'

export default Vue.extend({
  name: 'PagedReader',
  components: {
    PagedReaderPaperSheet,
    PagedReaderSpread,
  },
  data: function () {
    return {
      logger: 'PagedReader',
      carouselPage: 0,
      // visualPage belongs exclusively to the custom renderer. It is committed
      // before route/progress state so the visible frame cannot be disturbed by
      // parent reactivity at the end of a gesture.
      visualPage: 0,
      spreads: [] as PageDtoWithUrl[][],
      suppressClickUntil: 0,
      dragAnimationFrame: undefined as number | undefined,
      externalSyncFrame: undefined as number | undefined,
      drag: {
        tracking: false,
        prepared: false,
        active: false,
        settling: false,
        settleCommit: false,
        settleJump: '' as '' | 'previous' | 'next',
        startX: 0,
        startY: 0,
        lastTime: 0,
        rawOffset: 0,
        offset: 0,
        velocity: 0,
        axisSize: 1,
        physicalDirection: 0,
        navigationDelta: 0,
        currentIndex: 0,
        targetIndex: null as number | null,
        curlVariant: 'middle' as PageCurlVariant,
        directionHandoffCover: false,
      },
    }
  },
  props: {
    pages: {
      type: Array as () => PageDtoWithUrl[],
      required: true,
    },
    page: {
      type: Number,
      required: true,
    },
    pageLayout: {
      type: String as () => PagedReaderLayout,
      required: true,
    },
    transition: {
      type: String as () => PagedReaderTransition,
      required: true,
    },
    swipe: {
      type: Boolean,
      required: true,
    },
    followFinger: {
      type: Boolean,
      default: false,
    },
    readingDirection: {
      type: String as () => ReadingDirection,
      required: true,
    },
    scale: {
      type: String as () => ScaleType,
      required: true,
    },
  },
  watch: {
    pages: {
      handler(val) {
        this.spreads = buildSpreads(val, this.pageLayout)
        const spreadIndex = this.clampSpreadIndex(this.toSpreadIndex(this.page))
        this.carouselPage = spreadIndex
        this.visualPage = spreadIndex
      },
      immediate: true,
    },
    carouselPage(val, old) {
      this.$debug('[watch:carouselPage', `old:${old}`, `new:${val}`)
      if (val >= 0 && val < this.spreads.length && this.spreads.length > 0) {
        this.emitPageForSpread(val)
      } else if (this.spreads.length > 0) {
        this.$emit('update:page', 1)
      }
    },
    page(val, old) {
      this.$debug('[watch:page]', `old:${old}`, `new:${val}`)
      const spreadIndex = this.clampSpreadIndex(this.toSpreadIndex(val))
      this.$debug('[watch:page]', `toSpreadIndex:${spreadIndex}`)

      // A parent-driven jump (thumbnail, route navigation, etc.) should remain
      // immediate. During our own custom settlement, visualPage is already at
      // this index and therefore does not move again.
      if (!this.drag.prepared && !this.drag.tracking && !this.drag.settling) {
        this.visualPage = spreadIndex
      }
      this.carouselPage = spreadIndex
    },
    pageLayout: {
      handler(val) {
        const current = this.page
        this.spreads = buildSpreads(this.pages, val)
        const spreadIndex = this.clampSpreadIndex(this.toSpreadIndex(current))
        this.carouselPage = spreadIndex
        this.visualPage = spreadIndex
      },
      immediate: true,
    },
    transition() {
      if (this.drag.settling) this.finishDragSettlement(true)
      else if (this.drag.prepared) this.resetDrag()
      this.visualPage = this.clampSpreadIndex(this.toSpreadIndex(this.page))
      this.carouselPage = this.visualPage
    },
    customRendererEnabled(val) {
      if (this.drag.settling) this.finishDragSettlement(true)
      else if (this.drag.prepared) this.resetDrag()

      if (val) {
        this.visualPage = this.clampSpreadIndex(this.carouselPage)
      } else {
        this.carouselPage = this.clampSpreadIndex(this.visualPage)
      }
    },
  },
  created() {
    window.addEventListener('keydown', this.keyPressed)
  },
  destroyed() {
    window.removeEventListener('keydown', this.keyPressed)
    this.cancelDragAnimation()
    this.cancelExternalSync()
  },
  computed: {
    shortcuts(): any {
      const shortcuts = []
      switch (this.readingDirection) {
        case ReadingDirection.LEFT_TO_RIGHT:
          shortcuts.push(...shortcutsLTR)
          break
        case ReadingDirection.RIGHT_TO_LEFT:
          shortcuts.push(...shortcutsRTL)
          break
        case ReadingDirection.VERTICAL:
          shortcuts.push(...shortcutsVertical)
          break
      }
      return this.$_.keyBy(shortcuts, x => x.key)
    },
    flipDirection(): boolean {
      return this.readingDirection === ReadingDirection.RIGHT_TO_LEFT
    },
    vertical(): boolean {
      return this.readingDirection === ReadingDirection.VERTICAL
    },
    activePageIndex(): number {
      return this.customRendererEnabled ? this.visualPage : this.carouselPage
    },
    currentSlide(): number {
      return this.activePageIndex + 1
    },
    slidesCount(): number {
      return this.spreads.length
    },
    canPrev(): boolean {
      return this.currentSlide > 1
    },
    canNext(): boolean {
      return this.currentSlide < this.slidesCount
    },
    isDoublePages(): boolean {
      return this.pageLayout === PagedReaderLayout.DOUBLE_PAGES ||
        this.pageLayout === PagedReaderLayout.DOUBLE_NO_COVER
    },
    transitionEnabled(): boolean {
      return this.transition !== PagedReaderTransition.NONE
    },
    interactiveGestureEnabled(): boolean {
      return this.swipe && this.followFinger && this.transitionEnabled
    },
    customRendererEnabled(): boolean {
      return this.interactiveGestureEnabled ||
        (this.transition !== PagedReaderTransition.DEFAULT &&
          this.transition !== PagedReaderTransition.NONE)
    },
    carouselAnimations(): boolean {
      return this.transition === PagedReaderTransition.DEFAULT && !this.customRendererEnabled
    },
    transitionBaseIndex(): number {
      return this.drag.prepared ? this.drag.currentIndex : this.visualPage
    },
    physicalIndexDirection(): number {
      if (this.vertical) return 1
      return this.flipDirection ? -1 : 1
    },
    activePhysicalDirection(): number {
      if (this.drag.physicalDirection !== 0) return this.drag.physicalDirection
      if (this.drag.navigationDelta !== 0) {
        return -Math.sign(this.drag.navigationDelta * this.physicalIndexDirection)
      }
      return 0
    },
    transitionProgressValue(): number {
      return this.drag.prepared ? transitionProgress(this.drag.offset, this.drag.axisSize) : 0
    },
    transitionDuration(): number {
      switch (this.transition) {
        case PagedReaderTransition.PAGE_TURN:
        case PagedReaderTransition.PAPER_CURL:
          return 320
        case PagedReaderTransition.FADE:
        case PagedReaderTransition.SOFT_WIPE:
          return 190
        default:
          return 220
      }
    },
    paperCurlBackSpread(): PageDtoWithUrl[] {
      if (this.drag.targetIndex !== null && this.spreads[this.drag.targetIndex]) {
        return this.spreads[this.drag.targetIndex]
      }
      return this.spreads[this.visualPage] || []
    },
  },
  methods: {
    keyPressed(e: KeyboardEvent) {
      this.shortcuts[e.key]?.execute(this)
    },
    clampSpreadIndex(index: number): number {
      if (this.spreads.length === 0) return 0
      return Math.max(0, Math.min(this.spreads.length - 1, index))
    },
    emitPageForSpread(spreadIndex: number) {
      const currentSpread = this.spreads[spreadIndex]
      if (!currentSpread || currentSpread.length === 0) return
      const currentPage = currentSpread.length === 2 && currentSpread[1].mediaType
        ? currentSpread[1]
        : currentSpread[0]
      this.$emit('update:page', currentPage.number)
    },
    eagerLoad(spreadIndex: number): boolean {
      return Math.abs(this.carouselPage - spreadIndex) <= 2
    },
    preRender(spreadIndex: number): boolean {
      return Math.abs(this.carouselPage - spreadIndex) > (this.transitionEnabled ? 1 : 0)
    },
    shouldRenderCustomSpread(spreadIndex: number): boolean {
      if (!this.customRendererEnabled) return false
      if (Math.abs(this.visualPage - spreadIndex) <= 3) return true
      if (this.drag.prepared && Math.abs(this.drag.currentIndex - spreadIndex) <= 3) return true
      return this.drag.targetIndex === spreadIndex
    },
    centerClick() {
      this.$emit('menu')
    },
    turnRight() {
      if (!this.vertical) this.flipDirection ? this.prev() : this.next()
    },
    turnLeft() {
      if (!this.vertical) this.flipDirection ? this.next() : this.prev()
    },
    verticalPrev() {
      if (this.vertical) this.prev()
    },
    verticalNext() {
      if (this.vertical) this.next()
    },
    prev() {
      if (this.customRendererEnabled) {
        this.navigateCustom(-1)
      } else if (this.canPrev) {
        this.carouselPage--
        window.scrollTo(0, 0)
      } else {
        this.$emit('jump-previous')
      }
    },
    next() {
      if (this.customRendererEnabled) {
        this.navigateCustom(1)
      } else if (this.canNext) {
        this.carouselPage++
        window.scrollTo(0, 0)
      } else {
        this.$emit('jump-next')
      }
    },
    navigateCustom(delta: number) {
      if (this.drag.settling) this.finishDragSettlement(true)
      if (this.drag.tracking) return

      const targetIndex = this.visualPage + delta
      if (targetIndex < 0 || targetIndex >= this.spreads.length) {
        this.$emit(delta < 0 ? 'jump-previous' : 'jump-next')
        return
      }

      const root = this.$el as HTMLElement
      this.drag.prepared = true
      this.drag.active = true
      this.drag.currentIndex = this.visualPage
      this.drag.targetIndex = targetIndex
      this.drag.navigationDelta = delta
      this.drag.axisSize = this.measureAxisSize(root)
      this.drag.physicalDirection = -Math.sign(delta * this.physicalIndexDirection)
      this.drag.rawOffset = 0
      this.drag.offset = 0
      this.drag.velocity = 0
      this.drag.curlVariant = 'middle'

      this.$nextTick(() => {
        window.requestAnimationFrame(() => this.settleDrag(true))
      })
    },
    measureAxisSize(root: HTMLElement): number {
      if (this.vertical) return Math.max(1, window.innerHeight || root.clientHeight)
      return Math.max(1, root.clientWidth || window.innerWidth)
    },
    followFingerStart(event: TouchEvent) {
      if (!this.interactiveGestureEnabled || event.touches.length !== 1) return
      if (this.drag.settling) this.finishDragSettlement(true)

      const touch = event.touches[0]
      const root = this.$el as HTMLElement
      this.drag.tracking = true
      this.drag.prepared = true
      this.drag.active = false
      this.drag.startX = touch.clientX
      this.drag.startY = touch.clientY
      this.drag.lastTime = performance.now()
      this.drag.rawOffset = 0
      this.drag.offset = 0
      this.drag.velocity = 0
      this.drag.axisSize = this.measureAxisSize(root)
      this.drag.physicalDirection = 0
      this.drag.navigationDelta = 0
      this.drag.currentIndex = this.visualPage
      this.drag.targetIndex = null
      this.drag.curlVariant = this.vertical
        ? 'middle'
        : pageCurlVariantForStart(touch.clientY, window.innerHeight || root.clientHeight)
      this.drag.directionHandoffCover = false
    },
    followFingerMove(event: TouchEvent) {
      if (!this.drag.tracking || event.touches.length !== 1) return

      const touch = event.touches[0]
      const deltaX = touch.clientX - this.drag.startX
      const deltaY = touch.clientY - this.drag.startY
      const primary = this.vertical ? deltaY : deltaX
      const cross = this.vertical ? deltaX : deltaY

      if (!this.drag.active) {
        if (Math.abs(primary) < 4) return
        if (Math.abs(primary) <= Math.abs(cross)) {
          this.resetDrag()
          return
        }
        this.drag.active = true
        this.suppressClickUntil = Date.now() + 350
      }

      event.preventDefault()

      const now = performance.now()
      const elapsed = Math.max(1, now - this.drag.lastTime)
      this.drag.velocity = (primary - this.drag.rawOffset) / elapsed
      this.drag.lastTime = now
      this.drag.rawOffset = primary
      this.drag.physicalDirection = Math.sign(primary)
      this.drag.navigationDelta = navigationDeltaForDrag(primary, this.vertical, this.flipDirection)

      const targetIndex = this.drag.currentIndex + this.drag.navigationDelta
      const hasTarget = targetIndex >= 0 && targetIndex < this.spreads.length
      this.drag.targetIndex = hasTarget ? targetIndex : null
      this.drag.offset = dragOffsetWithResistance(primary, this.drag.axisSize, hasTarget)
    },
    followFingerEnd() {
      if (!this.drag.tracking) return
      this.drag.tracking = false
      if (!this.drag.active) {
        this.resetDrag()
        return
      }

      const commit = shouldCommitDrag(
        this.drag.rawOffset,
        this.drag.axisSize,
        this.drag.velocity,
      )

      if (commit && this.drag.targetIndex !== null) {
        this.settleDrag(true)
      } else if (commit && this.drag.navigationDelta !== 0) {
        this.settleDrag(false, this.drag.navigationDelta < 0 ? 'previous' : 'next')
      } else {
        this.settleDrag(false)
      }
    },
    followFingerCancel() {
      if (!this.drag.tracking && !this.drag.prepared) return
      this.drag.tracking = false
      if (this.drag.active) this.settleDrag(false)
      else this.resetDrag()
    },
    settleDrag(commitTarget: boolean, jump?: 'previous' | 'next') {
      this.cancelDragAnimation()
      this.drag.settling = true
      this.drag.settleCommit = commitTarget && this.drag.targetIndex !== null
      this.drag.settleJump = jump || ''
      this.suppressClickUntil = Date.now() + 350

      const from = this.drag.offset
      const to = this.drag.settleCommit
        ? this.drag.physicalDirection * this.drag.axisSize
        : 0
      const remaining = Math.min(1, Math.abs(to - from) / Math.max(1, this.drag.axisSize))
      const duration = Math.max(80, this.transitionDuration * Math.max(0.35, remaining))
      const startedAt = performance.now()

      const tick = (now: number) => {
        if (!this.drag.settling) return
        const linear = Math.min(1, Math.max(0, (now - startedAt) / duration))
        const eased = 1 - Math.pow(1 - linear, 3)
        this.drag.offset = from + (to - from) * eased

        if (linear < 1) {
          this.dragAnimationFrame = window.requestAnimationFrame(tick)
          return
        }

        this.drag.offset = to
        this.finishDragSettlement(false)
      }

      this.dragAnimationFrame = window.requestAnimationFrame(tick)
    },
    cancelDragAnimation() {
      if (this.dragAnimationFrame !== undefined) {
        window.cancelAnimationFrame(this.dragAnimationFrame)
        this.dragAnimationFrame = undefined
      }
    },
    cancelExternalSync() {
      if (this.externalSyncFrame !== undefined) {
        window.cancelAnimationFrame(this.externalSyncFrame)
        this.externalSyncFrame = undefined
      }
    },
    scheduleExternalPageSync(spreadIndex: number) {
      this.cancelExternalSync()
      // Two frames deliberately separate the visible commit from route/progress
      // reactivity. A new rapid gesture can still start immediately because it
      // reads visualPage, not carouselPage.
      this.externalSyncFrame = window.requestAnimationFrame(() => {
        this.externalSyncFrame = window.requestAnimationFrame(() => {
          this.externalSyncFrame = undefined
          if (this.visualPage === spreadIndex) this.carouselPage = spreadIndex
        })
      })
    },
    finishDragSettlement(immediate = false) {
      this.cancelDragAnimation()

      const commitTarget = this.drag.settleCommit
      const targetIndex = this.drag.targetIndex
      const jump = this.drag.settleJump

      if (immediate && commitTarget && targetIndex !== null) {
        this.drag.offset = this.drag.physicalDirection * this.drag.axisSize
      }

      if (commitTarget && targetIndex !== null) {
        // This is the only state mutation needed for the visible frame. The
        // target is already at exactly its idle geometry at transition progress
        // 1, and its DOM/compositor layer remains mounted with the same key.
        this.visualPage = targetIndex
      }

      this.resetDrag()

      if (commitTarget && targetIndex !== null) {
        this.scheduleExternalPageSync(targetIndex)
      }

      if (jump === 'previous') this.$emit('jump-previous')
      if (jump === 'next') this.$emit('jump-next')
    },
    resetDrag() {
      this.cancelDragAnimation()
      this.drag.tracking = false
      this.drag.prepared = false
      this.drag.active = false
      this.drag.settling = false
      this.drag.settleCommit = false
      this.drag.settleJump = ''
      this.drag.rawOffset = 0
      this.drag.offset = 0
      this.drag.velocity = 0
      this.drag.physicalDirection = 0
      this.drag.navigationDelta = 0
      this.drag.currentIndex = this.visualPage
      this.drag.targetIndex = null
      this.drag.curlVariant = 'middle'
      this.drag.directionHandoffCover = false
    },
    effectiveTransition(): PagedReaderTransition {
      if (this.drag.navigationDelta < 0) {
        if (this.transition === PagedReaderTransition.COVER) return PagedReaderTransition.REVEAL
        if (this.transition === PagedReaderTransition.REVEAL) return PagedReaderTransition.COVER
      }
      return this.transition
    },
    transitionSpreadClasses(spreadIndex: number): Record<string, boolean> {
      const current = spreadIndex === this.transitionBaseIndex
      const effect = this.effectiveTransition()
      return {
        'transition-current': current,
        'transition-target': this.drag.prepared && spreadIndex === this.drag.targetIndex,
        'page-flip-sheet': effect === PagedReaderTransition.PAGE_TURN && this.drag.prepared && current,
        'soft-wipe-target': effect === PagedReaderTransition.SOFT_WIPE &&
          this.drag.prepared && spreadIndex === this.drag.targetIndex,
      }
    },
    idleSpreadStyle(spreadIndex: number): Record<string, string> {
      if (spreadIndex === this.visualPage) {
        return {
          transform: 'translate3d(0, 0, 0)',
          opacity: '1',
          zIndex: '2',
          pointerEvents: 'none',
        }
      }
      return {
        transform: 'translate3d(0, 0, 0)',
        opacity: '0',
        zIndex: '0',
        pointerEvents: 'none',
      }
    },
    customSpreadStyle(spreadIndex: number): Record<string, string> {
      if (!this.drag.prepared) return this.idleSpreadStyle(spreadIndex)

      const baseIndex = this.transitionBaseIndex
      const isCurrent = spreadIndex === baseIndex
      const isTarget = spreadIndex === this.drag.targetIndex
      const progress = this.transitionProgressValue
      const offset = this.drag.offset
      const direction = this.activePhysicalDirection
      const effect = this.effectiveTransition()

      if (!isCurrent && !isTarget &&
        effect !== PagedReaderTransition.DEFAULT &&
        effect !== PagedReaderTransition.PUSH) {
        return {
          transform: 'translate3d(0, 0, 0)',
          opacity: '0',
          zIndex: '0',
          pointerEvents: 'none',
        }
      }

      switch (effect) {
        case PagedReaderTransition.COVER: {
          if (isCurrent) {
            return {
              transform: 'translate3d(0, 0, 0)',
              opacity: '1',
              zIndex: '1',
            }
          }
          if (isTarget) {
            const start = -direction * this.drag.axisSize
            return {
              transform: this.axisTranslate(start + offset),
              opacity: '1',
              zIndex: '3',
              filter: `drop-shadow(${direction * 10}px 0 12px rgba(0, 0, 0, 0.28))`,
            }
          }
          break
        }
        case PagedReaderTransition.REVEAL: {
          if (isCurrent) {
            return {
              transform: this.axisTranslate(offset),
              opacity: '1',
              zIndex: '3',
              filter: `drop-shadow(${-direction * 10}px 0 12px rgba(0, 0, 0, 0.24))`,
            }
          }
          if (isTarget) {
            const scale = 0.985 + progress * 0.015
            return {
              transform: `translate3d(0, 0, 0) scale(${scale})`,
              opacity: '1',
              zIndex: '1',
            }
          }
          break
        }
        case PagedReaderTransition.PARALLAX: {
          if (isCurrent) {
            return {
              transform: this.axisTranslate(offset),
              opacity: '1',
              zIndex: '3',
            }
          }
          if (isTarget) {
            const start = -direction * this.drag.axisSize * 0.35
            const coordinate = start + offset * 0.35
            const scale = 0.985 + progress * 0.015
            return {
              transform: `${this.axisTranslate(coordinate)} scale(${scale})`,
              opacity: '1',
              zIndex: '1',
            }
          }
          break
        }
        case PagedReaderTransition.FADE: {
          if (isCurrent) {
            return {
              transform: 'translate3d(0, 0, 0)',
              opacity: `${1 - progress}`,
              zIndex: '3',
            }
          }
          if (isTarget) {
            return {
              transform: 'translate3d(0, 0, 0)',
              opacity: `${progress}`,
              zIndex: '2',
            }
          }
          break
        }
        case PagedReaderTransition.SOFT_WIPE: {
          if (isCurrent) {
            return {
              transform: 'translate3d(0, 0, 0)',
              opacity: '1',
              zIndex: '2',
            }
          }
          if (isTarget) {
            const mask = this.softWipeMask(progress, direction)
            return {
              transform: 'translate3d(0, 0, 0)',
              opacity: '1',
              zIndex: '3',
              WebkitMaskImage: mask,
              maskImage: mask,
            }
          }
          break
        }
        case PagedReaderTransition.PAGE_TURN: {
          if (isCurrent) {
            const rotation = pageCurlRotation(progress, direction)
            const edge = direction < 0 ? 'left' : 'right'
            const verticalOrigin = this.drag.curlVariant === 'top'
              ? 'top'
              : this.drag.curlVariant === 'bottom'
                ? 'bottom'
                : 'center'
            const cornerTilt = this.drag.curlVariant === 'top'
              ? -direction * progress * 18
              : this.drag.curlVariant === 'bottom'
                ? direction * progress * 18
                : 0
            const verticalShift = this.drag.curlVariant === 'top'
              ? progress * 8
              : this.drag.curlVariant === 'bottom'
                ? -progress * 8
                : 0
            const transform = this.vertical
              ? `rotateX(${-rotation}deg)`
              : `translate3d(0, ${verticalShift}vh, 0) rotateY(${rotation}deg) rotateZ(${cornerTilt}deg)`
            const transformOrigin = this.vertical
              ? `${direction < 0 ? 'top' : 'bottom'} center`
              : `${edge} ${verticalOrigin}`
            return {
              transform,
              transformOrigin,
              opacity: '1',
              zIndex: '4',
              filter: `drop-shadow(${direction * 14}px 2px ${8 + progress * 16}px rgba(0, 0, 0, ${0.18 + progress * 0.28}))`,
            }
          }
          if (isTarget) {
            const scale = 0.975 + progress * 0.025
            return {
              transform: `translate3d(0, 0, 0) scale(${scale})`,
              opacity: `${0.8 + progress * 0.2}`,
              zIndex: '1',
            }
          }
          break
        }
        case PagedReaderTransition.PAPER_CURL: {
          if (isCurrent) {
            return {
              transform: 'translate3d(0, 0, 0)',
              opacity: '1',
              zIndex: '4',
            }
          }
          if (isTarget) {
            return {
              transform: 'translate3d(0, 0, 0)',
              opacity: '1',
              zIndex: '1',
            }
          }
          break
        }
        case PagedReaderTransition.PUSH:
        case PagedReaderTransition.DEFAULT:
        default: {
          const pageOffset = (spreadIndex - baseIndex) *
            this.physicalIndexDirection * this.drag.axisSize
          const coordinate = pageOffset + offset
          const currentScale = effect === PagedReaderTransition.PUSH && isCurrent
            ? 1 - progress * 0.018
            : 1
          const targetScale = effect === PagedReaderTransition.PUSH && isTarget
            ? 0.982 + progress * 0.018
            : 1
          const scale = isCurrent ? currentScale : isTarget ? targetScale : 1
          return {
            transform: `${this.axisTranslate(coordinate)} scale(${scale})`,
            opacity: '1',
            zIndex: isTarget ? '3' : isCurrent ? '2' : '1',
            filter: effect === PagedReaderTransition.PUSH && (isCurrent || isTarget)
              ? `drop-shadow(${direction * 8}px 0 10px rgba(0, 0, 0, ${0.08 + progress * 0.14}))`
              : 'none',
          }
        }
      }

      return {
        transform: 'translate3d(0, 0, 0)',
        opacity: '0',
        zIndex: '0',
      }
    },
    axisTranslate(position: number): string {
      return this.vertical
        ? `translate3d(0, ${position}px, 0)`
        : `translate3d(${position}px, 0, 0)`
    },
    softWipeMask(progress: number, direction: number): string {
      if (progress <= 0) return 'linear-gradient(#0000, #0000)'
      if (progress >= 1) return 'linear-gradient(#000, #000)'

      const seam = direction < 0 ? 100 - progress * 100 : progress * 100
      const feather = 4
      const low = Math.max(0, seam - feather)
      const high = Math.min(100, seam + feather)

      if (this.vertical) {
        if (direction < 0) {
          return `linear-gradient(to bottom, transparent 0%, transparent ${low}%, black ${high}%, black 100%)`
        }
        return `linear-gradient(to bottom, black 0%, black ${low}%, transparent ${high}%, transparent 100%)`
      }

      if (direction < 0) {
        return `linear-gradient(to right, transparent 0%, transparent ${low}%, black ${high}%, black 100%)`
      }
      return `linear-gradient(to right, black 0%, black ${low}%, transparent ${high}%, transparent 100%)`
    },
    isPaperCurlCurrent(spreadIndex: number): boolean {
      return this.drag.prepared &&
        this.drag.targetIndex !== null &&
        this.effectiveTransition() === PagedReaderTransition.PAPER_CURL &&
        spreadIndex === this.transitionBaseIndex
    },
    onClickCapture(event: MouseEvent) {
      if (Date.now() < this.suppressClickUntil) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    toSpreadIndex(i: number): number {
      this.$debug('[toSpreadIndex]', `i:${i}`, `isDoublePages:${this.isDoublePages}`)
      if (this.spreads.length > 0) {
        if (this.isDoublePages) {
          for (let j = 0; j < this.spreads.length; j++) {
            for (let k = 0; k < this.spreads[j].length; k++) {
              if (this.spreads[j][k].number === i) return j
            }
          }
        } else {
          return i - 1
        }
      }
      return i - 1
    },
  },
})
</script>

<style scoped>
.paged-reader-root {
  position: relative;
  min-height: 100vh;
  overflow-anchor: none;
}

.full-height {
  height: 100%;
}

.custom-reader-stage {
  position: relative;
  min-height: 100vh;
  overflow-anchor: none;
}

.custom-layout-anchor {
  position: relative;
  visibility: hidden;
  pointer-events: none;
  min-height: 100vh;
  overflow-anchor: none;
}

.transition-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 1;
  perspective: 1800px;
  transform-style: preserve-3d;
  isolation: isolate;
  contain: layout style paint;
}

.transition-spread {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
  backface-visibility: hidden;
  transform-style: preserve-3d;
  contain: layout style paint;
}

.left-quarter {
  top: 0;
  left: 0;
  width: 25%;
  height: 100%;
  position: absolute;
}

.right-quarter {
  top: 0;
  right: 0;
  width: 25%;
  height: 100%;
  position: absolute;
}

.top-quarter {
  top: 0;
  height: 25%;
  width: 100%;
  position: absolute;
}

.bottom-quarter {
  bottom: 0;
  height: 25%;
  width: 100%;
  position: absolute;
}

.center-horizontal {
  top: 0;
  left: 25%;
  width: 50%;
  height: 100%;
  position: absolute;
}

.center-vertical {
  top: 25%;
  height: 50%;
  width: 100%;
  position: absolute;
}

.pre-render {
  display: block !important;
  position: fixed;
  right: -1000vw;
  top: -1000vh;
}
</style>
