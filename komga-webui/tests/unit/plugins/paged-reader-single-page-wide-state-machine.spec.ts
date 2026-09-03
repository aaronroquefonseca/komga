import {anchorWideSourceBounds} from '@/plugins/paged-reader-single-page-wide-state-machine.plugin'

function sheet() {
  const element = document.createElement('div')
  jest.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 360,
    bottom: 716,
    width: 360,
    height: 716,
    x: 0,
    y: 0,
    toJSON: () => JSON.stringify({}),
  })
  return {
    $el: element,
    pageBoundsReady: true,
    pageBounds: {left: 0, top: 223, width: 180, height: 270},
  }
}

describe('single-page wide state machine', () => {
  it('reanchors the measured virtual half whenever curl direction changes', () => {
    const value = sheet()

    anchorWideSourceBounds(value, {
      currentWide: true,
      front: {page: {} as any, crop: 'right'},
    })
    expect(value.pageBounds.left).toBe(180)

    anchorWideSourceBounds(value, {
      currentWide: true,
      front: {page: {} as any, crop: 'left'},
    })
    expect(value.pageBounds.left).toBe(0)
  })
})
