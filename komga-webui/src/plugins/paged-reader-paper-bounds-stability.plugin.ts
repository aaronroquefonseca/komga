import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PageDtoWithUrl} from '@/types/komga-books'
import {installCurlDiagnostics} from './paged-reader-curl-diagnostics.plugin'
import {installDirectWideStability} from './paged-reader-direct-wide-stability.plugin'
import {installDoublePageDirectionStability} from './paged-reader-double-page-direction-stability.plugin'
import {installReaderRenderWindow} from './paged-reader-render-window.plugin'
import {installSafeCurlEffects} from './paged-reader-safe-curl-effects.plugin'
import {installSinglePageBlankGapStateMachine} from './paged-reader-single-page-blank-gap.plugin'
import {installWideCompositorStability} from './paged-reader-wide-compositor-stability.plugin'
import {installWideLiveDragGuard} from './paged-reader-wide-live-drag-guard.plugin'

type PaperBounds = {
  left: number
  top: number
  width: number
  height: number
}

type PaperBoundsSnapshot = {
  key: string
  bounds: PaperBounds
  heightOverWidth: number
}

function spreadIdentity(spread: PageDtoWithUrl[] | undefined): string {
  if (!spread || spread.length === 0) return '-'
  return spread
    .map(page => `${page.number}:${page.url}:${page.width || 0}x${page.height || 0}`)
    .join(',')
}

/**
 * A PagedReaderPaperSheet instance can survive many animation frames while
 * descendant images and helper overlays mount/unmount around it. Geometry must
 * belong to the physical transition, not to whichever DOM happened to finish
 * loading on the latest frame.
 */
function transitionKey(sheet: any): string | null {
  const reader = sheet.$parent as any
  if (!reader?.drag?.prepared || reader.drag.targetIndex === null) return null

  const root = sheet.$el instanceof HTMLElement
    ? sheet.$el.getBoundingClientRect()
    : null
  const rootWidth = Math.round(root?.width || window.innerWidth || 0)
  const rootHeight = Math.round(root?.height || window.innerHeight || 0)
  const targetSpread = reader.spreads?.[reader.drag.targetIndex] as PageDtoWithUrl[] | undefined

  return [
    reader.drag.currentIndex,
    reader.drag.targetIndex,
    reader.pageLayout,
    reader.flipDirection ? 'rtl' : 'ltr',
    sheet.scale,
    rootWidth,
    rootHeight,
    spreadIdentity(sheet.frontSpread),
    spreadIdentity(targetSpread),
  ].join('|')
}

function snapshot(sheet: any): PaperBoundsSnapshot | null {
  return (sheet.__curlPaperBoundsSnapshot || null) as PaperBoundsSnapshot | null
}

function saveSnapshot(sheet: any, key: string): void {
  if (!sheet.pageBoundsReady || !sheet.pageBounds) return
  const {left, top, width, height} = sheet.pageBounds
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return

  sheet.__curlPaperBoundsSnapshot = {
    key,
    bounds: {left, top, width, height},
    heightOverWidth: Number.isFinite(sheet.heightOverWidth)
      ? sheet.heightOverWidth
      : height / Math.max(1, width),
  } as PaperBoundsSnapshot
}

function restoreSnapshot(sheet: any, value: PaperBoundsSnapshot): void {
  const current = sheet.pageBounds
  const same = sheet.pageBoundsReady && current &&
    Math.abs(current.left - value.bounds.left) <= 0.01 &&
    Math.abs(current.top - value.bounds.top) <= 0.01 &&
    Math.abs(current.width - value.bounds.width) <= 0.01 &&
    Math.abs(current.height - value.bounds.height) <= 0.01 &&
    Math.abs(sheet.heightOverWidth - value.heightOverWidth) <= 0.0001

  if (same) return

  sheet.pageBounds = {...value.bounds}
  sheet.pageBoundsReady = true
  sheet.heightOverWidth = value.heightOverWidth
  if (typeof sheet.syncTouchGeometry === 'function') sheet.syncTouchGeometry()
}

/**
 * Do not freeze a CSS placeholder measurement before image natural dimensions
 * exist. Once a physical page has been measured from real image dimensions, the
 * snapshot remains immutable until the transition identity changes.
 */
function currentImagesReady(sheet: any): boolean {
  if (!(sheet.$el instanceof HTMLElement)) return true
  const images = Array.from(sheet.$el.querySelectorAll('.paper-current img')) as HTMLImageElement[]
  if (images.length === 0) return true
  return images.every(image => image.naturalWidth > 0 && image.naturalHeight > 0)
}

/**
 * Final geometry lifecycle guard. It intentionally renders nothing and changes
 * no curl equations. Its only responsibility is keeping one measured paper
 * rectangle for one drag/click transition.
 */
export function installPaperBoundsStability(): void {
  // Final wrappers deliberately run after every topology/compositor plugin.
  installSinglePageBlankGapStateMachine()
  // Keep a valid double-page leaf through the exact zero sample when a live drag
  // changes side. This is independent from direct single -> wide rendering.
  installDoublePageDirectionStability()
  installWideLiveDragGuard()

  // Restore the last visually validated direct-wide wrapper order from 775e513:
  // generic safe effects run first; the isolated direct-wide renderer runs later
  // and therefore its deterministic no-FX VNode tree is never rewritten.
  installSafeCurlEffects()
  installWideCompositorStability()
  installDirectWideStability()

  installReaderRenderWindow()
  installCurlDiagnostics()

  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!paperOptions?.methods || paperOptions.__paperBoundsStabilityInstalled) return
  paperOptions.__paperBoundsStabilityInstalled = true

  const originalMeasurePageBounds = paperOptions.methods.measurePageBounds
  if (typeof originalMeasurePageBounds === 'function') {
    paperOptions.methods.measurePageBounds = function (this: any): void {
      const key = transitionKey(this)
      if (!key) {
        this.__curlPaperBoundsSnapshot = null
        originalMeasurePageBounds.call(this)
        return
      }

      const frozen = snapshot(this)
      if (frozen?.key === key) {
        restoreSnapshot(this, frozen)
        return
      }

      if (frozen && frozen.key !== key) this.__curlPaperBoundsSnapshot = null

      if (!currentImagesReady(this)) {
        this.pageBoundsReady = false
        return
      }

      originalMeasurePageBounds.call(this)
      saveSnapshot(this, key)
    }
  }

  const originalSchedulePageBoundsMeasurement = paperOptions.methods.schedulePageBoundsMeasurement
  if (typeof originalSchedulePageBoundsMeasurement === 'function') {
    paperOptions.methods.schedulePageBoundsMeasurement = function (this: any): void {
      const key = transitionKey(this)
      const frozen = snapshot(this)
      if (key && frozen?.key === key) return
      originalSchedulePageBoundsMeasurement.call(this)
    }
  }

  const originalOnDescendantLoad = paperOptions.methods.onDescendantLoad
  if (typeof originalOnDescendantLoad === 'function') {
    paperOptions.methods.onDescendantLoad = function (this: any, event: Event): void {
      const key = transitionKey(this)
      const frozen = snapshot(this)
      if (key && frozen?.key === key) return
      originalOnDescendantLoad.call(this, event)
    }
  }
}
