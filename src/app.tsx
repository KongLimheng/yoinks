import React, {useCallback, useEffect, useRef, useState} from 'react'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {Box, Text, useApp, useInput, useStdout} from 'ink'
import SelectInput, {type IndicatorProps, type ItemProps} from 'ink-select-input'
import Spinner from 'ink-spinner'
import {FramedInput} from './components/framed-input.js'
import {FullScreen} from './components/fullscreen.js'
import {Logo} from './components/logo.js'
import {Panel} from './components/panel.js'
import {ProgressBar} from './components/progress-bar.js'
import {Shortcuts} from './components/shortcuts.js'
import {TextInput} from './components/text-input.js'
import {VideoPicker, computeScrollWindow, resolveConfirmedIndices, toggleAll, toggleIndex} from './components/video-picker.js'
import {clickTargetAt, findFrameRow, frameRowSpan, type ClickTarget} from './lib/click-map.js'
import {formatBytes, formatDuration, formatEta, formatSpeed, shortenPath, truncate, wrapText} from './lib/format.js'
import {addToHistory, loadHistory} from './lib/history.js'
import {formatRangeSummary, parseItemRange} from './lib/range.js'
import {resolveDestination, sanitizeFolderName} from './lib/path-utils.js'
import {detectPlatform, isProbablyUrl, parseYouTubeUrl, type Platform} from './lib/platforms.js'
import {useMouseClick} from './lib/use-mouse-click.js'
import {nextThemeMode, ThemeProvider, type ThemeMode, useTheme} from './theme.js'
import {
  buildChoices,
  buildPlaylistChoices,
  download,
  ensureYtDlp,
  findFfmpeg,
  probe,
  probePlaylist,
  type ConcurrentDownloadProgress,
  type DownloadChoice,
  type DownloadProgress,
  type DownloadResult,
  type MediaInfo,
  type PlaylistEntry,
} from './lib/ytdlp.js'

const YOINK_BUTTON = 'yoink'
const DONE_LABEL = '↵ yoink another'
const TAGLINE = 'yoink any video. paste. yoink. done.'

const choiceLabel = (choice: DownloadChoice) => `${choice.kind === 'audio' ? '♪ ' : '▶ '}${choice.label}`

function ChoiceIndicator({isSelected}: IndicatorProps) {
  const theme = useTheme()
  return (
    <Box marginRight={1}>
      <Text color={theme.primary}>{isSelected ? '❯' : ' '}</Text>
    </Box>
  )
}

function ChoiceItem({isSelected, label}: ItemProps) {
  const theme = useTheme()
  return (
    <Text color={theme.primary} bold={isSelected}>
      {label}
    </Text>
  )
}

// explicit blank lines — empty <Box height={1}/> spacers can collapse, and
// ink boxes default to flexShrink=1, so spacers are the first thing yoga
// crushes when content overflows the terminal
const Gap = ({lines = 1}: {lines?: number}) => (
  <Box flexDirection="column" flexShrink={0}>
    {Array.from({length: lines}, (_, i) => (
      <Text key={i}> </Text>
    ))}
  </Box>
)

// fixed-width slots — the centered line must not change width as values tick,
// otherwise the whole layout shifts on every progress update
function partLabel(progress: DownloadProgress): string {
  // explains the bar resetting between files (video, then audio)
  return progress.totalParts > 1 ? `part ${progress.part + 1}/${progress.totalParts}  ` : ''
}

function downloadMeta(progress: DownloadProgress): string {
  const speed = progress.speed ? formatSpeed(progress.speed) : ''
  const eta = progress.eta ? `${formatEta(progress.eta)} left` : ''
  return `${partLabel(progress)}${speed.padStart(10)}  ${eta.padEnd(12)}`
}

function indeterminateMeta(progress: DownloadProgress): string {
  const bytes = formatBytes(progress.downloadedBytes)
  const speed = progress.speed ? formatSpeed(progress.speed) : ''
  return `${partLabel(progress)}${bytes.padStart(8)}  ${speed.padEnd(10)}`
}

export type Outcome = {
  filepath?: string
  folderpath?: string
  count?: number
}

type Phase =
  | {name: 'input'; warning?: string}
  | {name: 'selectTarget'; url: string}
  | {name: 'probing'; status: string}
  | {name: 'picking'}
  | {name: 'playlistRangeMenu'; choice: DownloadChoice}
  | {name: 'playlistRangeInput'; choice: DownloadChoice; warning?: string}
  | {name: 'playlistVideoPicker'; choice: DownloadChoice}
  | {
      name: 'saveLocation'
      choice: DownloadChoice
      defaultPath: string
      playlistItems?: string
      selectedSingleTitle?: string
      warning?: string
    }
  | {
      name: 'downloading'
      choice: DownloadChoice
      progress?: DownloadProgress
      concurrentProgress?: ConcurrentDownloadProgress
      processing: boolean
      refreshing?: boolean
    }
  | {name: 'done'; filepath?: string; folderpath?: string; count?: number}
  | {name: 'error'; message: string}

const HINTS: Record<Phase['name'], Array<[string, string]>> = {
  input: [
    ['↵', 'yoink'],
    ['^c', 'quit'],
  ],
  selectTarget: [
    ['↑↓', 'choose'],
    ['↵', 'select'],
    ['esc', 'back'],
    ['^c', 'quit'],
  ],
  probing: [
    ['esc', 'cancel'],
    ['^c', 'quit'],
  ],
  picking: [
    ['↑↓', 'choose'],
    ['↵', 'choose'],
    ['esc', 'back'],
    ['^c', 'quit'],
  ],
  playlistRangeMenu: [
    ['↑↓', 'choose'],
    ['↵', 'select'],
    ['esc', 'back'],
    ['^c', 'quit'],
  ],
  playlistRangeInput: [
    ['↵', 'next'],
    ['esc', 'back'],
    ['^c', 'quit'],
  ],
  playlistVideoPicker: [
    ['↑↓', 'choose'],
    ['space', 'toggle'],
    ['a', 'all'],
    ['↵', 'yoink'],
    ['esc', 'back'],
    ['^c', 'quit'],
  ],
  saveLocation: [
    ['↵', 'yoink'],
    ['esc', 'back'],
    ['^c', 'quit'],
  ],
  downloading: [
    ['esc', 'cancel'],
    ['^c', 'quit'],
  ],
  done: [['^c', 'quit']],
  error: [
    ['↵', 'try again'],
    ['^c', 'quit'],
  ],
}

type AppProps = {
  initialUrl?: string
  clipboardUrl?: string
  initialThemeMode?: ThemeMode
  outputDir?: string
  playlistMode?: 'playlist' | 'video'
  concurrency?: number
  playlistItems?: string
  onOutcome: (outcome: Outcome) => void
}

export function App({initialThemeMode = 'auto', ...props}: AppProps) {
  const [themeMode, setThemeMode] = useState(initialThemeMode)
  const cycleTheme = useCallback(() => {
    setThemeMode(nextThemeMode)
  }, [])

  return (
    <ThemeProvider mode={themeMode}>
      <AppContent {...props} cycleTheme={cycleTheme} />
    </ThemeProvider>
  )
}

function AppContent({
  initialUrl,
  clipboardUrl,
  outputDir,
  playlistMode,
  concurrency,
  playlistItems: cliPlaylistItems,
  onOutcome,
  cycleTheme,
}: {
  initialUrl?: string
  clipboardUrl?: string
  outputDir?: string
  playlistMode?: 'playlist' | 'video'
  concurrency?: number
  playlistItems?: string
  onOutcome: (outcome: Outcome) => void
  cycleTheme: () => void
}) {
  const theme = useTheme()
  const {exit} = useApp()
  const {stdout} = useStdout()
  const [url, setUrl] = useState(initialUrl ?? '')
  const [urlInput, setUrlInput] = useState('')
  const [history, setHistory] = useState(loadHistory)
  const [platform, setPlatform] = useState<Platform>()
  const [info, setInfo] = useState<MediaInfo>()
  const [choices, setChoices] = useState<DownloadChoice[]>([])
  const [savePathInput, setSavePathInput] = useState('')
  const [rangeInput, setRangeInput] = useState('')
  const [pickerSelected, setPickerSelected] = useState<Set<number>>(() => new Set())
  const [pickerFocused, setPickerFocused] = useState<number>(0)
  const [pickerOffset, setPickerOffset] = useState<number>(0)
  const ytdlpRef = useRef('')
  const highlightRef = useRef(0) // choice under the cursor, for the ↵ hint click
  const targetHighlightRef = useRef<'playlist' | 'video'>('playlist')
  const rangeMenuHighlightRef = useRef<string>('all')
  const infoJsonRef = useRef<string | undefined>(undefined)
  const abortRef = useRef<AbortController | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>(initialUrl ? {name: 'probing', status: 'warming up…'} : {name: 'input'})

  const columns = stdout?.columns && stdout.columns > 0 ? stdout.columns : 80
  const boxWidth = Math.max(14, Math.min(64, columns - 6))
  const contentWidth = Math.max(10, Math.min(columns - 4, 78))
  const playlistEntries: PlaylistEntry[] =
    info && 'isPlaylist' in info && info.isPlaylist ? info.entries ?? [] : []

  const startProbe = useCallback(
    async (targetUrl: string, mode?: 'playlist' | 'video') => {
      const controller = new AbortController()
      abortRef.current = controller
      setPlatform(detectPlatform(targetUrl))
      setPhase({name: 'probing', status: 'warming up…'})
      try {
        const ytdlp =
          ytdlpRef.current ||
          (await ensureYtDlp(status => setPhase({name: 'probing', status}), controller.signal))
        ytdlpRef.current = ytdlp
        if (controller.signal.aborted) return

        const yt = parseYouTubeUrl(targetUrl)
        const isPlaylist = mode === 'playlist' || (yt.hasPlaylist && !yt.hasVideo && mode !== 'video')

        if (isPlaylist) {
          setPhase({name: 'probing', status: 'fetching playlist info…'})
          const playlistInfo = await probePlaylist(ytdlp, targetUrl, controller.signal)
          if (controller.signal.aborted) return
          setInfo(playlistInfo)
          setChoices(buildPlaylistChoices())
          highlightRef.current = 0
          setPhase({name: 'picking'})
        } else {
          setPhase({name: 'probing', status: 'fetching video info…'})
          const {info: videoInfo, infoJsonPath} = await probe(ytdlp, targetUrl, controller.signal)
          if (controller.signal.aborted) return
          infoJsonRef.current = infoJsonPath
          setInfo(videoInfo)
          setChoices(buildChoices(videoInfo))
          highlightRef.current = 0
          setPhase({name: 'picking'})
        }
      } catch (error) {
        if (controller.signal.aborted) return
        setPhase({name: 'error', message: error instanceof Error ? error.message : String(error)})
      }
    },
    [],
  )

  const initiateUrl = useCallback(
    (targetUrl: string) => {
      const yt = parseYouTubeUrl(targetUrl)
      if (yt.hasVideo && yt.hasPlaylist && !playlistMode) {
        setUrl(targetUrl)
        setPlatform(detectPlatform(targetUrl))
        setPhase({name: 'selectTarget', url: targetUrl})
      } else if (playlistMode === 'playlist' || (yt.hasPlaylist && !yt.hasVideo && playlistMode !== 'video')) {
        setUrl(targetUrl)
        void startProbe(targetUrl, 'playlist')
      } else {
        setUrl(targetUrl)
        void startProbe(targetUrl, 'video')
      }
    },
    [playlistMode, startProbe],
  )

  useEffect(() => {
    if (initialUrl) initiateUrl(initialUrl)
  }, [initialUrl, initiateUrl])

  const resetToInput = useCallback(() => {
    setUrl('')
    setUrlInput('')
    setPlatform(undefined)
    setInfo(undefined)
    setChoices([])
    setPhase({name: 'input'})
  }, [])

  const cancelRun = useCallback(() => {
    abortRef.current?.abort()
    resetToInput()
    setUrlInput(url) // keep the link around so a cancel isn't destructive
  }, [resetToInput, url])

  useInput(
    (input, key) => {
      if (key.ctrl && input === 't') {
        cycleTheme()
        return
      }
      if (key.escape) {
        if (phase.name === 'saveLocation') {
          if (info?.isPlaylist && !cliPlaylistItems) {
            setPhase({name: 'playlistRangeMenu', choice: phase.choice})
          } else {
            setPhase({name: 'picking'})
          }
          return
        }
        if (phase.name === 'playlistRangeInput' || phase.name === 'playlistVideoPicker') {
          setPhase({name: 'playlistRangeMenu', choice: phase.choice})
          return
        }
        if (phase.name === 'playlistRangeMenu') {
          setPhase({name: 'picking'})
          return
        }
        if (
          phase.name === 'selectTarget' ||
          phase.name === 'picking' ||
          phase.name === 'error' ||
          phase.name === 'done'
        ) {
          resetToInput()
          return
        }
        if (phase.name === 'probing' || phase.name === 'downloading') {
          cancelRun()
          return
        }
      }
      if (key.return && (phase.name === 'error' || phase.name === 'done')) resetToInput()
    },
    {isActive: Boolean(process.stdin.isTTY)},
  )

  const handleUrlSubmit = (value: string) => {
    const trimmed = value.trim()
    if (!isProbablyUrl(trimmed)) {
      setPhase({name: 'input', warning: 'that doesn’t look like a link — paste a full url'})
      return
    }
    initiateUrl(trimmed)
  }

  const clipboardOffered = Boolean(clipboardUrl) && urlInput === ''
  const clipboardAccepted = Boolean(clipboardUrl) && urlInput === clipboardUrl

  const goToSaveLocation = (
    choice: DownloadChoice,
    selectedItems?: string,
    singleTitle?: string,
  ) => {
    const baseDir = outputDir ? resolveDestination(outputDir) : path.join(os.homedir(), 'Downloads')
    let defaultDest = baseDir
    let isSingleFromPlaylist = false

    if (info?.isPlaylist) {
      if (selectedItems) {
        const parsed = parseItemRange(selectedItems, info.itemCount)
        if (parsed.valid && parsed.indices.length === 1) {
          isSingleFromPlaylist = true
          if (!singleTitle) {
            singleTitle = playlistEntries.find(e => (e.index ?? 0) === parsed.indices[0])?.title
          }
        }
      }
      if (!isSingleFromPlaylist) {
        defaultDest = path.join(baseDir, sanitizeFolderName(info.title))
      }
    }

    const displayPath = defaultDest.startsWith(os.homedir())
      ? `~${defaultDest.slice(os.homedir().length)}`
      : defaultDest

    setSavePathInput(displayPath)
    setPhase({
      name: 'saveLocation',
      choice,
      defaultPath: displayPath,
      playlistItems: selectedItems,
      selectedSingleTitle: singleTitle,
    })
  }

  const handlePick = (item: {value: number}) => {
    const choice = choices[item.value]
    if (!choice) return

    if (info?.isPlaylist) {
      if (cliPlaylistItems) {
        goToSaveLocation(choice, cliPlaylistItems)
      } else {
        rangeMenuHighlightRef.current = 'all'
        setPhase({name: 'playlistRangeMenu', choice})
      }
    } else {
      goToSaveLocation(choice)
    }
  }

  const handleRangeMenuSelect = (item: {value: string}) => {
    if (phase.name !== 'playlistRangeMenu') return
    const choice = phase.choice
    if (item.value === 'all') {
      goToSaveLocation(choice, undefined)
    } else if (item.value === 'range') {
      setRangeInput('')
      setPhase({name: 'playlistRangeInput', choice})
    } else if (item.value === 'browse') {
      setPickerSelected(new Set())
      setPickerFocused(0)
      setPickerOffset(0)
      setPhase({name: 'playlistVideoPicker', choice})
    }
  }

  const handleRangeInputSubmit = (value: string) => {
    if (phase.name !== 'playlistRangeInput') return
    const trimmed = value.trim()
    if (!trimmed) {
      setPhase({
        name: 'playlistRangeInput',
        choice: phase.choice,
        warning: 'please enter a range or episode number (e.g. 1-5, 8)',
      })
      return
    }
    const maxCount = info?.isPlaylist ? info.itemCount : 1000
    const parsed = parseItemRange(trimmed, maxCount)
    if (!parsed.valid || parsed.indices.length === 0) {
      setPhase({
        name: 'playlistRangeInput',
        choice: phase.choice,
        warning: parsed.error ?? 'invalid range format',
      })
      return
    }
    goToSaveLocation(phase.choice, parsed.indices.join(','))
  }

  const handleVideoPickerConfirm = (indices: number[]) => {
    if (phase.name !== 'playlistVideoPicker') return
    const choice = phase.choice
    if (indices.length === 1) {
      const entry = playlistEntries.find(e => (e.index ?? 0) === indices[0])
      goToSaveLocation(choice, String(indices[0]), entry?.title)
    } else {
      goToSaveLocation(choice, indices.join(','))
    }
  }

  const startDownload = (choice: DownloadChoice, destination: string, playlistItems?: string) => {
    const controller = new AbortController()
    abortRef.current = controller
    setPhase({name: 'downloading', choice, processing: false})
    void (async () => {
      const handlers = {
        onProgress: (progress: DownloadProgress) =>
          setPhase(prev => (prev.name === 'downloading' ? {...prev, progress, processing: false} : prev)),
        onConcurrentProgress: (concurrentProgress: ConcurrentDownloadProgress) =>
          setPhase(prev => (prev.name === 'downloading' ? {...prev, concurrentProgress, processing: false} : prev)),
        onProcessing: () =>
          setPhase(prev => (prev.name === 'downloading' ? {...prev, processing: true} : prev)),
      }
      try {
        await fs.mkdir(destination, {recursive: true})
        const ffmpegLocation = await findFfmpeg()
        const isPlaylist = Boolean(info?.isPlaylist)
        const totalItems = info?.isPlaylist ? info.itemCount : undefined
        const entries = info?.isPlaylist ? info.entries : undefined
        const base = {
          ytdlp: ytdlpRef.current,
          ffmpegLocation,
          url,
          choice,
          outDir: destination,
          isPlaylist,
          totalItems,
          entries,
          playlistItems,
          concurrency: concurrency ?? 3,
        }
        let result: DownloadResult
        try {
          result = await download(
            {...base, infoJsonPath: !isPlaylist ? infoJsonRef.current : undefined},
            handlers,
            controller.signal,
          )
        } catch (error) {
          if (controller.signal.aborted) throw error
          if (!isPlaylist) {
            setPhase(prev =>
              prev.name === 'downloading' ? {...prev, progress: undefined, refreshing: true} : prev,
            )
            result = await download(base, handlers, controller.signal)
          } else {
            throw error
          }
        }
        onOutcome(result)
        setHistory(addToHistory(url))
        setPhase({
          name: 'done',
          filepath: result.filepath,
          folderpath: result.folderpath,
          count: result.itemCount,
        })
      } catch (error) {
        if (controller.signal.aborted) return
        setPhase({name: 'error', message: error instanceof Error ? error.message : String(error)})
      }
    })()
  }

  const handleSaveLocationSubmit = (value: string) => {
    if (phase.name !== 'saveLocation') return
    const choice = phase.choice
    const destination = resolveDestination(value || phase.defaultPath)
    startDownload(choice, destination, phase.playlistItems)
  }

  let hints: Array<[string, string]> = [...HINTS[phase.name], ['^t', `theme:${theme.mode}`]]
  if (phase.name === 'input' && history.length > 0) {
    hints = [hints[0]!, ['↑', 'history'], ...hints.slice(1)]
  }

  // Anything a mouse user would expect to press is clickable. Targets are
  // found by their text in the rendered frame (see lib/click-map.ts), so
  // there is no layout math to keep in sync.
  const hintAction = (key: string): (() => void) | undefined => {
    if (key === '^c') return () => exit()
    if (key === '^t') return cycleTheme
    if (key === 'esc') {
      if (phase.name === 'saveLocation') {
        return () => {
          if (info?.isPlaylist && !cliPlaylistItems) {
            setPhase({name: 'playlistRangeMenu', choice: phase.choice})
          } else {
            setPhase({name: 'picking'})
          }
        }
      }
      if (phase.name === 'playlistRangeInput' || phase.name === 'playlistVideoPicker') {
        return () => setPhase({name: 'playlistRangeMenu', choice: phase.choice})
      }
      if (phase.name === 'playlistRangeMenu') {
        return () => setPhase({name: 'picking'})
      }
      return phase.name === 'probing' || phase.name === 'downloading' ? cancelRun : resetToInput
    }
    if (key === '↵') {
      if (phase.name === 'input') return () => handleUrlSubmit(urlInput)
      if (phase.name === 'selectTarget') return () => void startProbe(phase.url, targetHighlightRef.current)
      if (phase.name === 'picking') return () => handlePick({value: highlightRef.current})
      if (phase.name === 'playlistRangeMenu') return () => handleRangeMenuSelect({value: rangeMenuHighlightRef.current})
      if (phase.name === 'playlistRangeInput') return () => handleRangeInputSubmit(rangeInput)
      if (phase.name === 'playlistVideoPicker') {
        return () => {
          const confirmed = resolveConfirmedIndices(
            pickerSelected,
            pickerFocused,
            playlistEntries.map((e, i) => e.index ?? i + 1),
          )
          handleVideoPickerConfirm(confirmed)
        }
      }
      if (phase.name === 'saveLocation') return () => handleSaveLocationSubmit(savePathInput)
      if (phase.name === 'error' || phase.name === 'done') return resetToInput
    }
    return undefined // ↑↓ / ↑ stay keyboard-only
  }
  const clickTargets: ClickTarget[] = []
  if (phase.name === 'input') {
    // the frame button rows above/below the label are part of the button
    clickTargets.push({match: `  ${YOINK_BUTTON}  `, padY: 1, action: () => handleUrlSubmit(urlInput)})
  }
  if (phase.name === 'selectTarget') {
    clickTargets.push({match: 'Full playlist', action: () => void startProbe(phase.url, 'playlist')})
    clickTargets.push({match: 'This video only', action: () => void startProbe(phase.url, 'video')})
  }
  if (phase.name === 'picking') {
    for (const [index, choice] of choices.entries()) {
      clickTargets.push({match: choiceLabel(choice), action: () => handlePick({value: index})})
    }
  }
  if (phase.name === 'playlistRangeMenu') {
    clickTargets.push({match: 'All videos', action: () => handleRangeMenuSelect({value: 'all'})})
    clickTargets.push({match: 'Enter range / episodes', action: () => handleRangeMenuSelect({value: 'range'})})
    clickTargets.push({match: 'Browse & select videos', action: () => handleRangeMenuSelect({value: 'browse'})})
    clickTargets.push({match: 'Browse & pick', action: () => handleRangeMenuSelect({value: 'browse'})})
  }
  if (phase.name === 'playlistRangeInput') {
    clickTargets.push({match: '  next  ', padY: 1, action: () => handleRangeInputSubmit(rangeInput)})
  }
  if (phase.name === 'playlistVideoPicker') {
    const limit = 5
    const visibleEntries = playlistEntries.slice(pickerOffset, pickerOffset + limit)
    for (const [i, entry] of visibleEntries.entries()) {
      const globalIdx = pickerOffset + i
      const itemIndex = entry.index ?? globalIdx + 1
      const isSelected = pickerSelected.has(itemIndex)
      const check = isSelected ? '[✓] ' : '[ ] '
      const num = `${String(itemIndex).padStart(2, '0')}. `
      clickTargets.push({
        match: `${check}${num}`,
        action: () => {
          setPickerFocused(globalIdx)
          setPickerSelected(prev => toggleIndex(prev, itemIndex))
        },
      })
    }
    const focusedEntry = playlistEntries[pickerFocused] ?? playlistEntries[0]
    const focusedItemIndex = focusedEntry?.index ?? pickerFocused + 1
    const yoinkBtn =
      pickerSelected.size === 1
        ? '[ ↵ yoink 1 video ]'
        : pickerSelected.size > 1
        ? `[ ↵ yoink ${pickerSelected.size} videos ]`
        : `[ ↵ yoink video #${focusedItemIndex} ]`
    clickTargets.push({
      match: yoinkBtn,
      action: () => {
        const confirmed = resolveConfirmedIndices(
          pickerSelected,
          pickerFocused,
          playlistEntries.map((e, i) => e.index ?? i + 1),
        )
        handleVideoPickerConfirm(confirmed)
      },
    })
    clickTargets.push({
      match: pickerSelected.size === playlistEntries.length ? '[ clear selection ]' : '[ select all ]',
      action: () => {
        setPickerSelected(prev =>
          toggleAll(
            prev,
            playlistEntries.map((e, i) => e.index ?? i + 1),
          ),
        )
      },
    })
  }
  if (phase.name === 'saveLocation') {
    clickTargets.push({match: `  ${YOINK_BUTTON}  `, padY: 1, action: () => handleSaveLocationSubmit(savePathInput)})
  }
  if (phase.name === 'done') {
    clickTargets.push({match: DONE_LABEL, padX: 4, padY: 1, action: resetToInput})
  }
  for (const [key, label] of hints) {
    const action = hintAction(key)
    if (action) clickTargets.push({match: `${key} ${label}`, action})
  }

  useMouseClick(
    (x, y) => {
      // the logo takes you home — it's the 3 rows one gap above the tagline
      const taglineRow = findFrameRow(TAGLINE)
      if (taglineRow > 3 && y - 1 >= taglineRow - 4 && y - 1 <= taglineRow - 2) {
        const span = frameRowSpan(y - 1)
        if (span && x >= span[0] - 1 && x <= span[1] + 1) {
          if (phase.name === 'probing' || phase.name === 'downloading') cancelRun()
          else if (phase.name !== 'input') resetToInput()
          return
        }
      }
      clickTargetAt(x, y, clickTargets)?.action()
    },
    Boolean(process.stdin.isTTY),
  )

  return (
    <FullScreen>
      <Logo />
      <Gap />
      <Text color={theme.primary}>{TAGLINE}</Text>
      <Text color={theme.gray} dimColor={theme.dimSecondary}>youtube · x · instagram · threads · tiktok · +1800 more</Text>
      <Gap />

      {phase.name === 'input' && (
        <Box flexDirection="column" alignItems="center">
          <FramedInput title="Paste a link" width={boxWidth} button={YOINK_BUTTON}>
            <TextInput
              value={urlInput}
              onChange={setUrlInput}
              onSubmit={handleUrlSubmit}
              placeholder="https://youtube.com/watch?v=…"
              width={boxWidth - 6}
              history={history}
              submitOnPaste={isProbablyUrl}
              onTab={() => {
                if (clipboardOffered) setUrlInput(clipboardUrl!)
              }}
            />
          </FramedInput>
          {phase.warning ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>✗ {phase.warning}</Text>
          ) : clipboardOffered ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>link in your clipboard — ⇥ to paste it</Text>
          ) : clipboardAccepted ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>from your clipboard — ↵ to yoink it</Text>
          ) : null}
        </Box>
      )}

      {phase.name === 'selectTarget' && (
        <Box width={contentWidth} justifyContent="center">
          <Panel title="Select Download" width={Math.min(46, boxWidth)}>
            <Box flexDirection="column" paddingBottom={1}>
              <Text color={theme.gray} dimColor={theme.dimSecondary}>
                This link includes both a video and a playlist:
              </Text>
            </Box>
            <SelectInput
              indicatorComponent={ChoiceIndicator}
              itemComponent={ChoiceItem}
              items={[
                {key: 'playlist', label: '▶ Full playlist', value: 'playlist'},
                {key: 'video', label: '▶ This video only', value: 'video'},
              ]}
              onSelect={item => {
                void startProbe(phase.url, item.value as 'playlist' | 'video')
              }}
              onHighlight={item => (targetHighlightRef.current = item.value as 'playlist' | 'video')}
            />
          </Panel>
        </Box>
      )}

      {phase.name === 'probing' && (
        <Box flexDirection="column" alignItems="center">
          <FramedInput title={platform ? platform.label : 'Paste a link'} width={boxWidth} button={YOINK_BUTTON} buttonDim>
            <Text color={theme.gray} dimColor={theme.dimSecondary}>{url.length > boxWidth - 8 ? `${url.slice(0, boxWidth - 9)}…` : url}</Text>
          </FramedInput>
        </Box>
      )}

      {phase.name === 'picking' && platform && (
        <Box width={contentWidth}>
          <Box flexDirection="column" flexGrow={1} flexBasis={0} paddingTop={1} paddingRight={3}>
            {/* wrapped by hand so continuation lines stay flush left —
                ink's wrapping keeps the break's space as a 1-cell indent */}
            {wrapText(info?.title ?? '', Math.max(10, contentWidth - 41)).map((line, index) => (
              <Text key={index} bold color={theme.primary}>
                {line}
              </Text>
            ))}
            <Gap />
            <Text color={theme.gray} dimColor={theme.dimSecondary}>
              ▸ {platform.label}
              {info && 'isPlaylist' in info && info.isPlaylist
                ? ` · ${info.itemCount} videos`
                : ''}
              {info?.duration ? ` · ${formatDuration(info.duration)}` : ''}
              {info?.uploader ? ` · ${info.uploader}` : ''}
            </Text>
          </Box>
          <Panel title="Download" width={38}>
            <SelectInput
              indicatorComponent={ChoiceIndicator}
              itemComponent={ChoiceItem}
              items={choices.map((choice, index) => ({
                key: String(index),
                label: choiceLabel(choice),
                value: index,
              }))}
              onSelect={handlePick}
              onHighlight={item => (highlightRef.current = item.value)}
            />
          </Panel>
        </Box>
      )}

      {phase.name === 'playlistRangeMenu' && (
        <Box width={contentWidth} justifyContent="center">
          <Panel title="Playlist Range" width={Math.min(50, boxWidth)}>
            <Box flexDirection="column" paddingBottom={1}>
              <Text color={theme.gray} dimColor={theme.dimSecondary}>
                {info?.title ? truncate(info.title, 44) : 'Choose what to download:'}
              </Text>
            </Box>
            <SelectInput
              indicatorComponent={ChoiceIndicator}
              itemComponent={ChoiceItem}
              items={[
                {key: 'all', label: `▶ All videos (1-${info?.isPlaylist ? info.itemCount : 'end'})`, value: 'all'},
                {key: 'range', label: '▶ Enter range / episodes (e.g. 1-10, 15)', value: 'range'},
                {key: 'browse', label: '▶ Browse & select videos', value: 'browse'},
              ]}
              onSelect={handleRangeMenuSelect}
              onHighlight={item => (rangeMenuHighlightRef.current = item.value as string)}
            />
          </Panel>
        </Box>
      )}

      {phase.name === 'playlistRangeInput' && (
        <Box flexDirection="column" alignItems="center">
          <FramedInput
            title="Enter episode / video range"
            width={boxWidth}
            button="next"
          >
            <TextInput
              value={rangeInput}
              onChange={setRangeInput}
              onSubmit={handleRangeInputSubmit}
              placeholder="e.g. 1-5, 8, 11-13 or all"
              width={boxWidth - 6}
            />
          </FramedInput>
          {phase.warning ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>✗ {phase.warning}</Text>
          ) : (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>
              {`playlist has ${info?.isPlaylist ? info.itemCount : 0} videos — ↵ to confirm`}
            </Text>
          )}
        </Box>
      )}

      {phase.name === 'playlistVideoPicker' && (
        <Box width={contentWidth} justifyContent="center">
          <VideoPicker
            entries={playlistEntries}
            playlistTitle={info?.title}
            width={Math.max(52, Math.min(columns - 6, 74))}
            selectedIndices={pickerSelected}
            focusedIndex={pickerFocused}
            scrollOffset={pickerOffset}
            limit={5}
            onToggleIndex={idx => setPickerSelected(prev => toggleIndex(prev, idx))}
            onToggleAll={() =>
              setPickerSelected(prev =>
                toggleAll(
                  prev,
                  playlistEntries.map((e, i) => e.index ?? i + 1),
                ),
              )
            }
            onFocusChange={next => {
              setPickerFocused(next)
              setPickerOffset(computeScrollWindow(next, pickerOffset, playlistEntries.length, 5))
            }}
            onConfirm={() => {
              const confirmed = resolveConfirmedIndices(
                pickerSelected,
                pickerFocused,
                playlistEntries.map((e, i) => e.index ?? i + 1),
              )
              handleVideoPickerConfirm(confirmed)
            }}
            onCancel={() => setPhase({name: 'playlistRangeMenu', choice: phase.choice})}
          />
        </Box>
      )}

      {phase.name === 'saveLocation' && (
        <Box flexDirection="column" alignItems="center">
          <FramedInput
            title={phase.selectedSingleTitle ? 'Save video to' : (info?.isPlaylist ? 'Save playlist to' : 'Save to')}
            width={boxWidth}
            button={YOINK_BUTTON}
          >
            <TextInput
              value={savePathInput}
              onChange={setSavePathInput}
              onSubmit={handleSaveLocationSubmit}
              placeholder="~/Downloads"
              width={boxWidth - 6}
            />
          </FramedInput>
          {phase.warning ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>✗ {phase.warning}</Text>
          ) : (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>
              {phase.selectedSingleTitle
                ? `${truncate(phase.selectedSingleTitle, 40)} — ↵ to yoink`
                : info?.isPlaylist
                ? 'will create a folder for your playlist — ↵ to yoink'
                : '↵ to yoink to this folder'}
            </Text>
          )}
        </Box>
      )}

      {phase.name === 'downloading' && (
        <Box flexDirection="column" alignItems="center">
          <Text color={theme.gray} dimColor={theme.dimSecondary}>
            {info?.title ? `${truncate(info.title, 42)} · ` : ''}
            {phase.choice.label}
          </Text>
          {phase.concurrentProgress ? (
            <>
              <Text color={theme.primary} bold>
                {`[${phase.concurrentProgress.completedItems}/${phase.concurrentProgress.totalItems} videos completed]${
                  phase.concurrentProgress.overallSpeed
                    ? ` · ${formatSpeed(phase.concurrentProgress.overallSpeed)}`
                    : ''
                }`}
              </Text>
              <Gap />
              <ProgressBar
                percent={
                  phase.concurrentProgress.totalItems > 0
                    ? phase.concurrentProgress.completedItems / phase.concurrentProgress.totalItems
                    : 0
                }
              />
              <Gap />
              {phase.concurrentProgress.activeWorkers.length > 0 ? (
                phase.concurrentProgress.activeWorkers.map(w => {
                  const pctStr = `${Math.round(w.percent * 100)}%`.padStart(4)
                  const spdStr = w.speed ? formatSpeed(w.speed) : ''
                  const title = truncate(w.itemTitle ?? `Video #${w.itemIndex}`, 30)
                  return (
                    <Text key={w.itemIndex}>
                      <Text color={theme.primary} bold>{`#${String(w.itemIndex).padStart(2, ' ')} `}</Text>
                      <Text color={theme.gray} dimColor={theme.dimSecondary}>{title.padEnd(32)}</Text>
                      <Text color={theme.primary}>{pctStr}</Text>
                      {spdStr ? <Text color={theme.gray} dimColor={theme.dimSecondary}>{`  ${spdStr}`}</Text> : null}
                    </Text>
                  )
                })
              ) : (
                <Text color={theme.gray} dimColor={theme.dimSecondary}>
                  <Text color={theme.primary}><Spinner type="dots" /></Text> preparing downloads…
                </Text>
              )}
            </>
          ) : (
            <>
              {phase.progress?.itemIndex ? (
                <Text color={theme.primary} bold>
                  {`[${phase.progress.itemIndex}/${phase.progress.totalItems ?? (info?.isPlaylist ? info.itemCount : '?')}] `}
                  <Text color={theme.gray} dimColor={theme.dimSecondary}>
                    {truncate(phase.progress.itemTitle ?? '', 36)}
                  </Text>
                </Text>
              ) : null}
              <Gap />
              {/* every branch is exactly three rows — bar, gap, meta — so the layout never jumps */}
              {phase.processing ? (
                <>
                  <ProgressBar percent={1} />
                  <Gap />
                  <Text>
                    <Text color={theme.primary}>
                      <Spinner type="dots" />
                    </Text>
                    <Text color={theme.gray} dimColor={theme.dimSecondary}> processing…</Text>
                  </Text>
                </>
              ) : phase.progress?.totalBytes ? (
                <>
                  <ProgressBar percent={phase.progress.downloadedBytes / phase.progress.totalBytes} />
                  <Gap />
                  <Text color={theme.gray} dimColor={theme.dimSecondary}>{downloadMeta(phase.progress)}</Text>
                </>
              ) : phase.progress ? (
                <>
                  <Text>
                    <Text color={theme.primary}>
                      <Spinner type="dots" />
                    </Text>
                    <Text color={theme.gray} dimColor={theme.dimSecondary}> downloading…</Text>
                  </Text>
                  <Gap />
                  <Text color={theme.gray} dimColor={theme.dimSecondary}>{indeterminateMeta(phase.progress)}</Text>
                </>
              ) : (
                <>
                  <ProgressBar percent={0} />
                  <Gap />
                  <Text>
                    <Text color={theme.primary}>
                      <Spinner type="dots" />
                    </Text>
                    <Text color={theme.gray} dimColor={theme.dimSecondary}>
                      {phase.refreshing ? ' link expired — grabbing a fresh one…' : ' starting download…'}
                    </Text>
                  </Text>
                </>
              )}
            </>
          )}
        </Box>
      )}

      {phase.name === 'done' && (
        <Box flexDirection="column" alignItems="center">
          <Text>
            <Text bold color={theme.primary}>✓ yoinked! </Text>
            <Text color={theme.primary}>
              {phase.folderpath
                ? `find your ${phase.count ? `${phase.count} ` : ''}files in:`
                : 'find your file in:'}
            </Text>
          </Text>
          <Text color={theme.gray} dimColor={theme.dimSecondary}>
            {shortenPath(phase.folderpath ?? phase.filepath ?? '', os.homedir(), 60)}
          </Text>
          <Gap />
          <Box
            borderStyle="round"
            borderColor={theme.gray}
            borderDimColor={theme.dimSecondary}
            borderBackgroundColor={theme.background}
            paddingX={3}
          >
            <Text bold color={theme.primary}>{DONE_LABEL}</Text>
          </Box>
        </Box>
      )}

      {phase.name === 'error' && (
        <Box flexDirection="column" alignItems="center" width={Math.max(10, Math.min(columns - 6, 72))}>
          <Text bold color={theme.primary}>✗ {phase.message}</Text>
        </Box>
      )}

      {hints.length > 0 ? (
        <>
          <Gap lines={2} />
          <Shortcuts
            items={hints}
            leading={
              phase.name === 'probing' ? (
                <Text>
                  <Text color={theme.primary}>
                    <Spinner type="dots" />
                  </Text>
                  <Text color={theme.gray} dimColor={theme.dimSecondary}> {phase.status}</Text>
                </Text>
              ) : undefined
            }
          />
        </>
      ) : null}
    </FullScreen>
  )
}
