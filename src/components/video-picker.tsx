import React from 'react'
import {Box, Text, useInput} from 'ink'
import {Panel} from './panel.js'
import {formatDuration, truncate, wrapText} from '../lib/format.js'
import {useTheme} from '../theme.js'
import type {PlaylistEntry} from '../lib/ytdlp.js'

/**
 * Toggle an item's index in the selected set.
 */
export function toggleIndex(selected: Set<number>, index: number): Set<number> {
  const next = new Set(selected)
  if (next.has(index)) {
    next.delete(index)
  } else {
    next.add(index)
  }
  return next
}

/**
 * Toggle all indices: if all are selected, clear all; otherwise, select all.
 */
export function toggleAll(selected: Set<number>, allIndices: number[]): Set<number> {
  if (allIndices.length === 0) return new Set()
  if (selected.size === allIndices.length) {
    return new Set()
  }
  return new Set(allIndices)
}

/**
 * Compute the new scrollOffset so focusedIndex stays within [scrollOffset, scrollOffset + limit - 1].
 */
export function computeScrollWindow(
  focusedIndex: number,
  currentOffset: number,
  totalItems: number,
  limit: number,
): number {
  if (totalItems <= limit) return 0
  const maxOffset = Math.max(0, totalItems - limit)
  let nextOffset = currentOffset

  if (focusedIndex < nextOffset) {
    nextOffset = focusedIndex
  } else if (focusedIndex >= nextOffset + limit) {
    nextOffset = focusedIndex - limit + 1
  }

  return Math.max(0, Math.min(maxOffset, nextOffset))
}

/**
 * Resolve final confirmed 1-based indices.
 * If at least 1 video is checked, returns checked indices.
 * If 0 videos are checked, falls back to the currently focused video.
 */
export function resolveConfirmedIndices(
  selected: Set<number>,
  focusedIndex: number,
  allIndices: number[],
): number[] {
  if (selected.size > 0) {
    return Array.from(selected).sort((a, b) => a - b)
  }
  const fallback = allIndices[focusedIndex] ?? allIndices[0] ?? 1
  return [fallback]
}

export type VideoPickerProps = {
  entries: PlaylistEntry[]
  playlistTitle?: string
  width: number
  selectedIndices: Set<number>
  focusedIndex: number
  scrollOffset: number
  limit?: number
  onToggleIndex: (index: number) => void
  onToggleAll: () => void
  onFocusChange: (index: number) => void
  onConfirm: () => void
  onCancel: () => void
}

export function VideoPicker({
  entries,
  playlistTitle,
  width,
  selectedIndices,
  focusedIndex,
  scrollOffset,
  limit = 5,
  onToggleIndex,
  onToggleAll,
  onFocusChange,
  onConfirm,
  onCancel,
}: VideoPickerProps) {
  const theme = useTheme()
  const innerWidth = Math.max(10, width - 6)

  useInput(
    (input, key) => {
      if (key.upArrow || input === 'k') {
        const next = Math.max(0, focusedIndex - 1)
        onFocusChange(next)
      } else if (key.downArrow || input === 'j') {
        const next = Math.min(entries.length - 1, focusedIndex + 1)
        onFocusChange(next)
      } else if (input === ' ') {
        const itemIndex = entries[focusedIndex]?.index ?? focusedIndex + 1
        onToggleIndex(itemIndex)
      } else if (input === 'a') {
        onToggleAll()
      } else if (key.return) {
        onConfirm()
      } else if (key.escape) {
        onCancel()
      }
    },
    {isActive: true},
  )

  const visibleEntries = entries.slice(scrollOffset, scrollOffset + limit)
  const remainingBelow = Math.max(0, entries.length - (scrollOffset + limit))

  const focusedEntry = entries[focusedIndex] ?? entries[0]
  const focusedItemIndex = focusedEntry?.index ?? focusedIndex + 1
  const isFocusedSelected = selectedIndices.has(focusedItemIndex)
  const allSelected = entries.length > 0 && selectedIndices.size === entries.length

  const yoinkButtonText =
    selectedIndices.size === 1
      ? '[ ↵ yoink 1 video ]'
      : selectedIndices.size > 1
      ? `[ ↵ yoink ${selectedIndices.size} videos ]`
      : `[ ↵ yoink video #${focusedItemIndex} ]`

  const selectAllButtonText = allSelected ? '[ clear selection ]' : '[ select all ]'

  return (
    <Panel title="Select Videos" width={width}>
      <Box flexDirection="column" paddingBottom={1}>
        <Text color={theme.gray} dimColor={theme.dimSecondary}>
          {playlistTitle ? truncate(playlistTitle, innerWidth - 20) : 'Playlist'} ·{' '}
          <Text color={theme.primary} bold>
            {selectedIndices.size}/{entries.length} selected
          </Text>
        </Text>
      </Box>

      {/* Top scroll indicator */}
      <Box height={1}>
        {scrollOffset > 0 ? (
          <Text color={theme.gray} dimColor={theme.dimSecondary}>
            {'  ▲ '}{scrollOffset}{' more above'}
          </Text>
        ) : (
          <Text> </Text>
        )}
      </Box>

      {/* Video item rows */}
      <Box flexDirection="column">
        {visibleEntries.map((entry, i) => {
          const globalIdx = scrollOffset + i
          const itemIndex = entry.index ?? globalIdx + 1
          const isFocused = globalIdx === focusedIndex
          const isSelected = selectedIndices.has(itemIndex)
          const cursor = isFocused ? '❯ ' : '  '
          const check = isSelected ? '[✓] ' : '[ ] '
          const num = `${String(itemIndex).padStart(2, '0')}. `
          const dur = entry.duration ? ` ${formatDuration(entry.duration)}` : ''
          const maxTitleLen = Math.max(10, innerWidth - 2 - 4 - 4 - dur.length - 2)
          const titleTrunc = truncate(entry.title, maxTitleLen)

          return (
            <Box key={itemIndex}>
              <Text color={theme.primary}>{cursor}</Text>
              <Text color={isSelected ? theme.primary : theme.gray} bold={isSelected}>
                {check}
              </Text>
              <Text color={theme.primary} bold={isFocused}>
                {num}
              </Text>
              <Text color={isFocused ? theme.primary : theme.gray} bold={isFocused}>
                {titleTrunc.padEnd(maxTitleLen)}
              </Text>
              {dur ? <Text color={theme.gray} dimColor={theme.dimSecondary}>{dur}</Text> : null}
            </Box>
          )
        })}
      </Box>

      {/* Bottom scroll indicator */}
      <Box height={1}>
        {remainingBelow > 0 ? (
          <Text color={theme.gray} dimColor={theme.dimSecondary}>
            {'  ▼ '}{remainingBelow}{' more below'}
          </Text>
        ) : (
          <Text> </Text>
        )}
      </Box>

      {/* Divider */}
      <Text color={theme.gray} dimColor={theme.dimSecondary}>
        {'─'.repeat(Math.max(10, innerWidth))}
      </Text>

      {/* Full Title Preview Card */}
      <Box flexDirection="column" marginY={1}>
        <Text>
          <Text color={theme.primary} bold>{`▸ #${String(focusedItemIndex).padStart(2, '0')} `}</Text>
          {focusedEntry?.duration ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>{`(${formatDuration(focusedEntry.duration)}) `}</Text>
          ) : null}
          <Text color={isFocusedSelected ? theme.primary : theme.gray} dimColor={!isFocusedSelected}>
            {isFocusedSelected ? '· [✓] selected' : '· [ ] not selected'}
          </Text>
        </Text>
        <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
          {wrapText(focusedEntry?.title ?? '', Math.max(10, innerWidth - 4)).map((line, idx) => (
            <Text key={idx} bold color={theme.primary}>
              {line}
            </Text>
          ))}
        </Box>
      </Box>

      {/* Action Buttons */}
      <Box justifyContent="space-between" paddingTop={1}>
        <Text bold color={theme.primary}>
          {yoinkButtonText}
        </Text>
        <Text color={theme.gray} dimColor={theme.dimSecondary}>
          {selectAllButtonText}
        </Text>
      </Box>
    </Panel>
  )
}
