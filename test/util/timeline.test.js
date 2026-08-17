/* global describe it */
const assert = require('assert')

const timeline = require('../../src/js/shared/helpers/timeline')

describe('timeline helpers', () => {
  const boards = [
    { time: 0 },
    { time: 2000 },
    { time: 5000 }
  ]

  describe('#cursorTimeFromPointer', () => {
    it('accounts for scrolling and zoom', () => {
      assert.strictEqual(
        timeline.cursorTimeFromPointer({
          clientX: 250,
          rectLeft: 100,
          scrollLeft: 50,
          pixelsPerMsec: 0.1,
          scale: 2,
          sceneDuration: 10000
        }),
        1000
      )
    })

    it('clamps to the scene duration', () => {
      assert.strictEqual(
        timeline.cursorTimeFromPointer({
          clientX: 1000,
          rectLeft: 0,
          pixelsPerMsec: 1,
          sceneDuration: 100
        }),
        100
      )
    })

    it('uses Electron event.x when clientX is unavailable', () => {
      assert.strictEqual(
        timeline.cursorTimeFromPointer({
          event: { x: 250 },
          rectLeft: 100,
          scrollLeft: 50,
          pixelsPerMsec: 0.1,
          scale: 2,
          sceneDuration: 10000
        }),
        1000
      )
    })

    it('returns undefined for an event without a finite coordinate', () => {
      assert.strictEqual(
        timeline.cursorTimeFromPointer({
          event: { clientX: NaN, x: Infinity },
          rectLeft: 0,
          pixelsPerMsec: 1,
          sceneDuration: 1000
        }),
        undefined
      )
    })

    it('snaps to the later boundary on an exact tie', () => {
      assert.strictEqual(
        timeline.cursorTimeFromPointer({
          clientX: 3,
          rectLeft: 0,
          pixelsPerMsec: 1,
          sceneDuration: 100,
          snap: true,
          boundaries: [0, 2, 4, 100]
        }),
        4
      )
    })
  })

  describe('#pointerXFromEvent', () => {
    it('prefers clientX over Electron event.x', () => {
      assert.strictEqual(timeline.pointerXFromEvent({ clientX: 12, x: 34 }), 12)
    })

    it('falls back to event.x', () => {
      assert.strictEqual(timeline.pointerXFromEvent({ x: 34 }), 34)
    })

    it('returns undefined when both coordinates are invalid', () => {
      assert.strictEqual(timeline.pointerXFromEvent({ clientX: NaN, x: Infinity }), undefined)
    })
  })

  it('finds the board at a timeline time', () => {
    assert.strictEqual(timeline.boardIndexAtTime(boards, 0), 0)
    assert.strictEqual(timeline.boardIndexAtTime(boards, 4999), 1)
    assert.strictEqual(timeline.boardIndexAtTime(boards, 5000), 2)
    assert.strictEqual(timeline.boardIndexAtTime(boards, 9000), 2)
  })

  it('finds the insertion index at a boundary', () => {
    assert.strictEqual(timeline.insertionIndexAtTime(boards, 0), 0)
    assert.strictEqual(timeline.insertionIndexAtTime(boards, 2000), 1)
    assert.strictEqual(timeline.insertionIndexAtTime(boards, 5000), 2)
    assert.strictEqual(timeline.insertionIndexAtTime(boards, 9000), 3)
  })

  it('appends at the exact scene end', () => {
    assert.strictEqual(timeline.insertionIndexAtTime(boards, 7000), boards.length)
  })

  it('only inserts at the first position when the nearest boundary is zero', () => {
    const boundaries = [0, 2000, 5000, 7000]
    const nearFirst = timeline.snapTimeToBoundary(700, boundaries)
    const nearSecond = timeline.snapTimeToBoundary(1300, boundaries)

    assert.strictEqual(timeline.insertionIndexAtTime(boards, nearFirst), 0)
    assert.strictEqual(timeline.insertionIndexAtTime(boards, nearSecond), 1)
  })

  it('detects valid audio boards', () => {
    assert.strictEqual(timeline.sceneHasAudio({ boards: [{ audio: { filename: 'a.wav' } }] }), true)
    assert.strictEqual(timeline.sceneHasAudio({ boards: [{ audio: { filename: '' } }] }), false)
    assert.strictEqual(timeline.sceneHasAudio({ boards: [{ audio: null }] }), false)
  })

  it('keeps audio tails out of board insertion boundaries', () => {
    const scene = {
      boards: [
        { time: 0, duration: 1000 },
        { time: 1000, duration: 1000 },
        { time: 2000, duration: 1000, audio: { duration: 10000 } }
      ]
    }

    const visualDuration = timeline.boardTimelineDuration(
      scene,
      board => board.duration
    )

    assert.strictEqual(visualDuration, 3000)
    assert.strictEqual(
      timeline.insertionIndexAtTime(
        scene.boards,
        timeline.snapTimeToBoundary(2800, timeline.sceneBoundaryTimes(scene, visualDuration))
      ),
      scene.boards.length
    )
  })
})
