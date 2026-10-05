import assert from 'node:assert/strict'
import test from 'node:test'
import {parseItemRange, formatRangeSummary} from './range.js'

test('parseItemRange parses all, single indices, ranges and mixed specs', () => {
  assert.deepEqual(parseItemRange('all', 5), {
    valid: true,
    indices: [1, 2, 3, 4, 5],
    count: 5,
    normalized: '1-5',
  })

  assert.deepEqual(parseItemRange('', 3), {
    valid: true,
    indices: [1, 2, 3],
    count: 3,
    normalized: '1-3',
  })

  assert.deepEqual(parseItemRange('2', 10), {
    valid: true,
    indices: [2],
    count: 1,
    normalized: '2',
  })

  assert.deepEqual(parseItemRange('1-3, 5, 7-8', 10), {
    valid: true,
    indices: [1, 2, 3, 5, 7, 8],
    count: 6,
    normalized: '1-3, 5, 7-8',
  })

  // Handles colon separator, whitespace, and reverse ranges
  assert.deepEqual(parseItemRange('5-2', 10), {
    valid: true,
    indices: [2, 3, 4, 5],
    count: 4,
    normalized: '2-5',
  })
})

test('parseItemRange rejects invalid or out of bounds inputs', () => {
  const invalid1 = parseItemRange('abc', 10)
  assert.equal(invalid1.valid, false)
  assert.match(invalid1.error ?? '', /not a valid number/)

  const invalid2 = parseItemRange('15', 10)
  assert.equal(invalid2.valid, false)
  assert.match(invalid2.error ?? '', /out of bounds/)

  const invalid3 = parseItemRange('1-foo', 10)
  assert.equal(invalid3.valid, false)
  assert.match(invalid3.error ?? '', /invalid range/)
})

test('formatRangeSummary generates readable previews', () => {
  const entries = [
    {id: '1', title: 'Intro'},
    {id: '2', title: 'Setup'},
    {id: '3', title: 'Basics'},
    {id: '4', title: 'Advanced'},
  ]

  assert.equal(formatRangeSummary([1], entries), '1 video: #1 Intro')
  assert.equal(formatRangeSummary([1, 2, 3], entries), '3 videos selected (#1 … #3)')
  assert.equal(formatRangeSummary([]), 'no videos selected')
})
