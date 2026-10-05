import assert from 'node:assert/strict'
import test from 'node:test'
import {
  toggleIndex,
  toggleAll,
  computeScrollWindow,
  resolveConfirmedIndices,
} from './video-picker.js'

test('toggleIndex adds and removes index immutably', () => {
  const initial = new Set<number>()
  const s1 = toggleIndex(initial, 3)
  assert.deepEqual(Array.from(s1), [3])
  assert.equal(initial.size, 0, 'original set is not mutated')

  const s2 = toggleIndex(s1, 5)
  assert.deepEqual(Array.from(s2).sort(), [3, 5])

  const s3 = toggleIndex(s2, 3)
  assert.deepEqual(Array.from(s3), [5])
})

test('toggleAll selects all or clears when all are selected', () => {
  const allIndices = [1, 2, 3, 4, 5]

  // when empty, selects all
  const s1 = toggleAll(new Set(), allIndices)
  assert.equal(s1.size, 5)
  assert.deepEqual(Array.from(s1).sort(), [1, 2, 3, 4, 5])

  // when partial, selects all
  const s2 = toggleAll(new Set([1, 3]), allIndices)
  assert.equal(s2.size, 5)
  assert.deepEqual(Array.from(s2).sort(), [1, 2, 3, 4, 5])

  // when already all selected, clears all
  const s3 = toggleAll(new Set([1, 2, 3, 4, 5]), allIndices)
  assert.equal(s3.size, 0)

  // handles empty input
  const sEmpty = toggleAll(new Set(), [])
  assert.equal(sEmpty.size, 0)
})

test('computeScrollWindow scrolls window smoothly with cursor', () => {
  const limit = 5
  const total = 12

  // focused at 0, offset should be 0
  assert.equal(computeScrollWindow(0, 0, total, limit), 0)

  // focused at 4 (last visible item of first page), offset stays 0
  assert.equal(computeScrollWindow(4, 0, total, limit), 0)

  // focused at 5 (one past visible window), offset shifts to 1
  assert.equal(computeScrollWindow(5, 0, total, limit), 1)

  // focused at 8 with current offset 1, offset shifts to 8 - 5 + 1 = 4
  assert.equal(computeScrollWindow(8, 1, total, limit), 4)

  // moving back up: focused at 2 with current offset 4, offset moves back to 2
  assert.equal(computeScrollWindow(2, 4, total, limit), 2)

  // focused at last item (11), offset clamped to max (12 - 5 = 7)
  assert.equal(computeScrollWindow(11, 4, total, limit), 7)

  // when total <= limit, offset always 0
  assert.equal(computeScrollWindow(2, 0, 3, limit), 0)
})

test('resolveConfirmedIndices returns selected or falls back to focused', () => {
  const allIndices = [1, 2, 3, 4, 5]

  // multiple selected -> sorted array
  assert.deepEqual(resolveConfirmedIndices(new Set([4, 1, 3]), 0, allIndices), [1, 3, 4])

  // single selected -> single array
  assert.deepEqual(resolveConfirmedIndices(new Set([2]), 4, allIndices), [2])

  // none selected -> falls back to focused item
  assert.deepEqual(resolveConfirmedIndices(new Set(), 2, allIndices), [3])
  assert.deepEqual(resolveConfirmedIndices(new Set(), 0, allIndices), [1])
})

test('VideoPicker renders checkboxes and un-truncated full title preview', async () => {
  const [{default: React}, {renderToString}, {ThemeProvider}, {VideoPicker}] = await Promise.all([
    import('react'),
    import('ink'),
    import('../theme.js'),
    import('./video-picker.js'),
  ])

  const longTitle = 'The Power of Imagination — Onstage and Off | Suki Hillier | Complete Very Long Full Title Without Truncation'
  const entries = [
    {id: '1', index: 1, title: longTitle, duration: 307},
    {id: '2', index: 2, title: 'Why I Love My Bad Days | Alexi Pappas', duration: 311},
    {id: '3', index: 3, title: 'Inside the Mind of a Master Procrastinator', duration: 843},
  ]

  const output = renderToString(
    React.createElement(ThemeProvider, {
      mode: 'dark',
      children: React.createElement(VideoPicker, {
        entries,
        playlistTitle: 'TED Collection',
        width: 60,
        selectedIndices: new Set([1]),
        focusedIndex: 0,
        scrollOffset: 0,
        limit: 5,
        onToggleIndex: () => {},
        onToggleAll: () => {},
        onFocusChange: () => {},
        onConfirm: () => {},
        onCancel: () => {},
      }),
    }),
  )

  // Verify checkbox indicators
  assert.match(output, /\[✓\] 01\./)
  assert.match(output, /\[ \] 02\./)

  // Verify action button with count
  assert.match(output, /\[ ↵ yoink 1 video \]/)

  // Verify un-truncated full title preview section contains the full title text across wrapped lines
  assert.match(output, /Complete Very Long Full Title Without/)
  assert.match(output, /Truncation/)
  assert.match(output, /▸ #01/)
  assert.match(output, /· \[✓\] selected/)
})

