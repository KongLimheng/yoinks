export type RangeParseResult = {
  valid: boolean
  indices: number[]
  count: number
  normalized?: string
  error?: string
}

/**
 * Parse an episode/video range specification (e.g. "1-5", "3", "1,3,5-8", "all")
 * against a playlist with maxItems.
 */
export function parseItemRange(spec: string, maxItems: number): RangeParseResult {
  const trimmed = spec.trim()
  if (!trimmed || trimmed.toLowerCase() === 'all') {
    const indices = Array.from({length: maxItems}, (_, i) => i + 1)
    return {
      valid: true,
      indices,
      count: indices.length,
      normalized: maxItems > 1 ? `1-${maxItems}` : '1',
    }
  }

  const parts = trimmed.split(/[,;\s]+/).filter(Boolean)
  const resultSet = new Set<number>()

  for (const part of parts) {
    if (part.includes('-') || part.includes(':')) {
      const sep = part.includes('-') ? '-' : ':'
      const [startStr, endStr] = part.split(sep)
      let start = startStr ? Number.parseInt(startStr, 10) : 1
      let end = endStr ? Number.parseInt(endStr, 10) : maxItems

      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        return {valid: false, indices: [], count: 0, error: `invalid range “${part}”`}
      }

      if (start > end) {
        const temp = start
        start = end
        end = temp
      }

      start = Math.max(1, start)
      end = Math.min(maxItems, end)

      if (start > maxItems) {
        return {
          valid: false,
          indices: [],
          count: 0,
          error: `range “${part}” exceeds playlist length (${maxItems} videos)`,
        }
      }

      for (let i = start; i <= end; i++) {
        resultSet.add(i)
      }
    } else {
      const num = Number.parseInt(part, 10)
      if (!Number.isInteger(num)) {
        return {valid: false, indices: [], count: 0, error: `“${part}” is not a valid number`}
      }
      if (num < 1 || num > maxItems) {
        return {
          valid: false,
          indices: [],
          count: 0,
          error: `index ${num} is out of bounds (playlist has ${maxItems} videos)`,
        }
      }
      resultSet.add(num)
    }
  }

  const indices = Array.from(resultSet).sort((a, b) => a - b)
  if (indices.length === 0) {
    return {valid: false, indices: [], count: 0, error: 'no videos selected'}
  }

  const normalized = buildNormalizedRange(indices)
  return {
    valid: true,
    indices,
    count: indices.length,
    normalized,
  }
}

function buildNormalizedRange(indices: number[]): string {
  if (indices.length === 0) return ''
  const chunks: string[] = []
  let rangeStart = indices[0]!
  let prev = indices[0]!

  for (let i = 1; i < indices.length; i++) {
    const curr = indices[i]!
    if (curr === prev + 1) {
      prev = curr
    } else {
      chunks.push(rangeStart === prev ? String(rangeStart) : `${rangeStart}-${prev}`)
      rangeStart = curr
      prev = curr
    }
  }
  chunks.push(rangeStart === prev ? String(rangeStart) : `${rangeStart}-${prev}`)
  return chunks.join(', ')
}

export function formatRangeSummary(
  indices: number[],
  entries?: Array<{id: string; title: string}>,
): string {
  if (indices.length === 0) return 'no videos selected'
  if (indices.length === 1) {
    const idx = indices[0]!
    const title = entries?.[idx - 1]?.title
    return title ? `1 video: #${idx} ${title}` : `1 video: #${idx}`
  }
  const first = indices[0]!
  const last = indices[indices.length - 1]!
  return `${indices.length} videos selected (#${first} … #${last})`
}
