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

  it('finds the board at a timeline time', () => {
    assert.strictEqual(timeline.boardIndexAtTime(boards, 0), 0)
    assert.strictEqual(timeline.boardIndexAtTime(boards, 4999), 1)
    assert.strictEqual(timeline.boardIndexAtTime(boards, 5000), 2)
    assert.strictEqual(timeline.boardIndexAtTime(boards, 9000), 2)
  })

  it('finds the insertion index at a boundary', () => {
    assert.strictEqual(timeline.insertionIndexAtTime(boards, 0), 0)
    assert.strictEqual(timeline.insertionIndexAtTime(boards, 2000), 1)
    assert.strictEqual(timeline.insertionIndexAtTime(boards, 9000), 3)
  })

  it('detects valid audio boards', () => {
    assert.strictEqual(timeline.sceneHasAudio({ boards: [{ audio: { filename: 'a.wav' } }] }), true)
    assert.strictEqual(timeline.sceneHasAudio({ boards: [{ audio: { filename: '' } }] }), false)
    assert.strictEqual(timeline.sceneHasAudio({ boards: [{ audio: null }] }), false)
  })
})
