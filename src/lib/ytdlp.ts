import {spawn, type ChildProcess} from 'node:child_process'
import {createWriteStream} from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {formatBytes} from './format.js'

const YOINKS_DIR = path.join(os.homedir(), '.yoinks', 'bin')
const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

function ytDlpAssetName(): string {
  if (process.platform === 'win32') return 'yt-dlp.exe'
  if (process.platform === 'darwin') return 'yt-dlp_macos'
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
}

// async on purpose: a spawnSync here blocks the event loop, which freezes
// ink mid-frame — the user hits enter and sees nothing until it returns
function commandWorks(cmd: string, args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(cmd, args, {stdio: 'ignore', timeout: 10_000})
    } catch {
      resolve(false)
      return
    }
    child.on('error', () => resolve(false))
    child.on('close', code => resolve(code === 0))
  })
}

/**
 * Resolve a usable yt-dlp binary: system install first, then a previously
 * downloaded copy, then download the standalone binary from GitHub releases.
 */
export async function ensureYtDlp(onStatus: (message: string) => void, signal?: AbortSignal): Promise<string> {
  if (await commandWorks('yt-dlp', ['--version'])) return 'yt-dlp'

  const local = path.join(YOINKS_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  if (await commandWorks(local, ['--version'])) return local

  onStatus('first run: fetching yt-dlp…')
  await fs.mkdir(YOINKS_DIR, {recursive: true})

  const url = `${RELEASE_BASE}/${ytDlpAssetName()}`
  const response = await fetch(url, {signal})
  if (!response.ok || !response.body) {
    throw new Error(`Could not download yt-dlp (${response.status}). Check your connection and try again.`)
  }

  const tmp = `${local}.download`
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tmp), {signal})
  await fs.chmod(tmp, 0o755)
  await fs.rename(tmp, local)
  return local
}

/**
 * Find ffmpeg for stream merging / mp3 extraction: system install first,
 * ffmpeg-static as fallback. Returns undefined if neither exists — yt-dlp
 * still works for single-file formats without it.
 */
export async function findFfmpeg(): Promise<string | undefined> {
  if (await commandWorks('ffmpeg', ['-version'])) return undefined // on PATH, yt-dlp finds it itself
  try {
    const mod = await import('ffmpeg-static')
    const ffmpegPath = (mod.default ?? mod) as unknown as string | null
    if (ffmpegPath && (await commandWorks(ffmpegPath, ['-version']))) return ffmpegPath
  } catch {
    // ffmpeg-static not installed or unsupported platform
  }
  return undefined
}

export type VideoInfo = {
  isPlaylist?: false
  title: string
  uploader?: string
  duration?: number
  webpage_url?: string
  extractor_key?: string
  formats?: RawFormat[]
}

export type PlaylistEntry = {
  id: string
  title: string
  duration?: number
  url?: string
  index?: number
}

export type PlaylistInfo = {
  isPlaylist: true
  id?: string
  title: string
  uploader?: string
  itemCount: number
  duration?: number
  entries?: PlaylistEntry[]
}

export type MediaInfo = VideoInfo | PlaylistInfo

type RawFormat = {
  format_id: string
  ext?: string
  vcodec?: string
  acodec?: string
  height?: number
  width?: number
  abr?: number
  tbr?: number
  filesize?: number
  filesize_approx?: number
}

export type ProbeResult = {
  info: VideoInfo
  /** Raw -J output saved to disk so downloads can skip re-extraction via --load-info-json. */
  infoJsonPath: string
}

export async function probe(ytdlp: string, url: string, signal?: AbortSignal): Promise<ProbeResult> {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(ytdlp, ['-J', '--no-playlist', '--no-warnings', url], {signal})
    let out = ''
    let stderr = ''
    child.stdout.on('data', chunk => (out += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(cleanYtDlpError(stderr) || `yt-dlp exited with code ${code}`))
      } else {
        resolve(out)
      }
    })
  })

  let info: VideoInfo
  try {
    info = JSON.parse(stdout) as VideoInfo
  } catch {
    throw new Error('Could not parse video info from yt-dlp.')
  }

  const infoJsonPath = path.join(os.tmpdir(), `yoinks-info-${process.pid}-${Date.now()}.json`)
  await fs.writeFile(infoJsonPath, stdout)
  return {info, infoJsonPath}
}

export async function probePlaylist(ytdlp: string, url: string, signal?: AbortSignal): Promise<PlaylistInfo> {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(ytdlp, ['-J', '--flat-playlist', '--no-warnings', url], {signal})
    let out = ''
    let stderr = ''
    child.stdout.on('data', chunk => (out += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(cleanYtDlpError(stderr) || `yt-dlp exited with code ${code}`))
      } else {
        resolve(out)
      }
    })
  })

  let raw: {
    id?: string
    title?: string
    uploader?: string
    channel?: string
    playlist_count?: number
    entries?: PlaylistEntry[]
  }
  try {
    raw = JSON.parse(stdout)
  } catch {
    throw new Error('Could not parse playlist info from yt-dlp.')
  }

  const entries: PlaylistEntry[] = (raw.entries ?? []).map((e, idx) => ({
    ...e,
    index: idx + 1,
  }))
  const totalDuration = entries.reduce((acc, e) => acc + (typeof e.duration === 'number' ? e.duration : 0), 0)

  return {
    isPlaylist: true,
    id: raw.id,
    title: raw.title || 'YouTube Playlist',
    uploader: raw.uploader || raw.channel,
    itemCount: raw.playlist_count ?? entries.length,
    duration: totalDuration > 0 ? totalDuration : undefined,
    entries,
  }
}

export type DownloadChoice = {
  label: string
  kind: 'video' | 'audio'
  args: string[]
}

const MAX_VIDEO_CHOICES = 8

export function buildPlaylistChoices(): DownloadChoice[] {
  return [
    {
      kind: 'video',
      label: 'best quality · mp4',
      args: ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'],
    },
    {
      kind: 'video',
      label: '1080p max · mp4',
      args: ['-f', 'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b', '--merge-output-format', 'mp4'],
    },
    {
      kind: 'video',
      label: '720p max · mp4',
      args: ['-f', 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b', '--merge-output-format', 'mp4'],
    },
    {
      kind: 'video',
      label: '480p max · mp4',
      args: ['-f', 'bv*[height<=480]+ba/b[height<=480]/bv*+ba/b', '--merge-output-format', 'mp4'],
    },
    {
      kind: 'audio',
      label: 'audio only · mp3',
      args: ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'],
    },
  ]
}

export function buildChoices(info: VideoInfo): DownloadChoice[] {
  const formats = info.formats ?? []
  const choices: DownloadChoice[] = []

  const audioOnly = formats.filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
  const bestAudio = [...audioOnly].sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))[0]
  const audioSize = bestAudio?.filesize ?? bestAudio?.filesize_approx

  const videos = formats.filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
  const heights = [...new Set(videos.map(f => f.height as number))].sort((a, b) => b - a)

  for (const height of heights.slice(0, MAX_VIDEO_CHOICES)) {
    const candidates = videos.filter(f => f.height === height)
    const best = [...candidates].sort((a, b) => scoreVideo(b) - scoreVideo(a))[0]
    const muxed = best.acodec && best.acodec !== 'none'
    const size = (best.filesize ?? best.filesize_approx ?? 0) + (muxed ? 0 : audioSize ?? 0)
    const sizeLabel = size > 0 ? ` · ~${formatBytes(size)}` : ''
    choices.push({
      kind: 'video',
      label: `${height}p · mp4${sizeLabel}`,
      args: [
        '-f',
        `bv*[height=${height}]+ba/b[height=${height}]/bv*[height<=${height}]+ba/b`,
        '--merge-output-format',
        'mp4',
      ],
    })
  }

  if (choices.length === 0) {
    choices.push({
      kind: 'video',
      label: 'best available · mp4',
      args: ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'],
    })
  }

  const audioSizeLabel = audioSize ? ` · ~${formatBytes(audioSize)}` : ''
  choices.push({
    kind: 'audio',
    label: `audio only · mp3${audioSizeLabel}`,
    args: ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'],
  })

  return choices
}

function scoreVideo(f: RawFormat): number {
  let score = f.tbr ?? 0
  if (f.ext === 'mp4') score += 10_000
  if (f.vcodec?.startsWith('avc')) score += 5_000
  return score
}

export type DownloadProgress = {
  downloadedBytes: number
  totalBytes?: number
  speed?: number
  eta?: number
  part: number
  /** How many files this download resolves to (video+audio merges are 2). */
  totalParts: number
  itemIndex?: number
  totalItems?: number
  itemTitle?: string
}

export type DownloadResult = {
  filepath?: string
  folderpath?: string
  itemCount?: number
}

import {parseItemRange} from './range.js'

export type ActiveWorkerProgress = {
  itemIndex: number
  itemTitle: string
  downloadedBytes: number
  totalBytes?: number
  speed?: number
  eta?: number
  percent: number
}

export type ConcurrentDownloadProgress = {
  completedItems: number
  totalItems: number
  activeWorkers: ActiveWorkerProgress[]
  overallSpeed?: number
}

export type DownloadHandlers = {
  onProgress: (progress: DownloadProgress) => void
  onProcessing: () => void
  onConcurrentProgress?: (progress: ConcurrentDownloadProgress) => void
}

const PROGRESS_PREFIX = 'YOINK|'
const PROGRESS_TEMPLATE = `${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`

let activeChild: ChildProcess | undefined
const allActiveProcesses = new Set<ChildProcess>()
process.on('exit', () => {
  activeChild?.kill('SIGTERM')
  for (const child of allActiveProcesses) child.kill('SIGTERM')
})

export type DownloadOptions = {
  ytdlp: string
  ffmpegLocation?: string
  url: string
  /** When set, reuse the probe's metadata instead of re-extracting — starts much faster. */
  infoJsonPath?: string
  choice: DownloadChoice
  outDir: string
  isPlaylist?: boolean
  totalItems?: number
  playlistItems?: string
  concurrency?: number
  entries?: PlaylistEntry[]
  selectedIndices?: number[]
}

export async function downloadConcurrentPlaylist(
  opts: {
    ytdlp: string
    ffmpegLocation?: string
    entries: PlaylistEntry[]
    selectedIndices?: number[]
    playlistItems?: string
    choice: DownloadChoice
    outDir: string
    concurrency?: number
  },
  handlers: DownloadHandlers,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  let indices: number[]
  if (opts.selectedIndices && opts.selectedIndices.length > 0) {
    indices = opts.selectedIndices
  } else if (opts.playlistItems) {
    const parsed = parseItemRange(opts.playlistItems, opts.entries.length)
    indices = parsed.valid && parsed.indices.length > 0 ? parsed.indices : opts.entries.map((_, i) => i + 1)
  } else {
    indices = opts.entries.map((_, i) => i + 1)
  }

  const tasks = indices
    .map(idx => ({index: idx, entry: opts.entries[idx - 1]!}))
    .filter(t => Boolean(t.entry))

  if (tasks.length === 0) {
    throw new Error('No playlist items selected.')
  }

  const limit = Math.max(1, Math.min(opts.concurrency ?? 3, tasks.length))
  const activeMap = new Map<number, ActiveWorkerProgress>()
  const activeChildren = new Set<ChildProcess>()
  const allDestinations: string[] = []
  let completedItems = 0
  let aborted = false
  let nextTaskIndex = 0

  const emitConcurrent = () => {
    const activeWorkers = Array.from(activeMap.values())
    const overallSpeed = activeWorkers.reduce((acc, w) => acc + (w.speed ?? 0), 0)
    handlers.onConcurrentProgress?.({
      completedItems,
      totalItems: tasks.length,
      activeWorkers,
      overallSpeed: overallSpeed > 0 ? overallSpeed : undefined,
    })
  }

  emitConcurrent()

  const runTask = async (task: {index: number; entry: PlaylistEntry}) => {
    if (aborted || signal?.aborted) return
    const videoUrl = task.entry.url || `https://www.youtube.com/watch?v=${task.entry.id}`
    const filenameTemplate = path.join(
      opts.outDir,
      `${String(task.index).padStart(2, '0')} - %(title).60s.%(ext)s`,
    )

    const args = [
      videoUrl,
      ...opts.choice.args,
      '--no-playlist',
      '-N',
      '4',
      '--no-warnings',
      '--newline',
      '--no-quiet',
      '--progress',
      '--progress-template',
      `download:${PROGRESS_TEMPLATE}`,
      '--print',
      'after_move:FILE:%(filepath)s',
      '--no-simulate',
      '-o',
      filenameTemplate,
    ]
    if (opts.ffmpegLocation) args.push('--ffmpeg-location', opts.ffmpegLocation)

    activeMap.set(task.index, {
      itemIndex: task.index,
      itemTitle: task.entry.title,
      downloadedBytes: 0,
      percent: 0,
    })
    emitConcurrent()

    await new Promise<void>((resolve, reject) => {
      let child: ChildProcess
      try {
        child = spawn(opts.ytdlp, args, {signal})
      } catch (err) {
        activeMap.delete(task.index)
        completedItems++
        emitConcurrent()
        resolve()
        return
      }

      activeChildren.add(child)
      allActiveProcesses.add(child)

      let buffer = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line) continue
          if (line.startsWith(PROGRESS_PREFIX)) {
            const [downloaded, total, totalEstimate, speed, eta] = line.slice(PROGRESS_PREFIX.length).split('|')
            const downloadedBytes = toNumber(downloaded) ?? 0
            const totalBytes = toNumber(total) ?? toNumber(totalEstimate)
            const speedNum = toNumber(speed)
            const etaNum = toNumber(eta)
            const percent = totalBytes && totalBytes > 0 ? Math.min(1, downloadedBytes / totalBytes) : 0
            activeMap.set(task.index, {
              itemIndex: task.index,
              itemTitle: task.entry.title,
              downloadedBytes,
              totalBytes,
              percent,
              speed: speedNum,
              eta: etaNum,
            })
            emitConcurrent()
          } else if (line.startsWith('FILE:')) {
            const target = line.slice('FILE:'.length).trim()
            if (target) allDestinations.push(target)
          } else if (line.startsWith('[download] Destination: ')) {
            allDestinations.push(line.slice('[download] Destination: '.length))
          }
        }
      })

      child.on('close', code => {
        activeChildren.delete(child)
        allActiveProcesses.delete(child)
        activeMap.delete(task.index)
        if (signal?.aborted) {
          reject(new Error('Download cancelled.'))
          return
        }
        completedItems++
        emitConcurrent()
        resolve()
      })

      child.on('error', () => {
        activeChildren.delete(child)
        allActiveProcesses.delete(child)
        activeMap.delete(task.index)
        completedItems++
        emitConcurrent()
        resolve()
      })
    })
  }

  const worker = async () => {
    while (nextTaskIndex < tasks.length && !aborted && !signal?.aborted) {
      const task = tasks[nextTaskIndex++]!
      await runTask(task)
    }
  }

  if (signal) {
    signal.addEventListener('abort', () => {
      aborted = true
      for (const child of activeChildren) {
        child.kill('SIGTERM')
      }
      void removePartials(allDestinations)
    })
  }

  const workers = Array.from({length: limit}, () => worker())
  await Promise.all(workers)

  if (signal?.aborted) {
    void removePartials(allDestinations)
    throw new Error('Download cancelled.')
  }

  return {
    filepath: tasks.length === 1 && allDestinations[0] ? allDestinations[0] : undefined,
    folderpath: tasks.length === 1 && allDestinations[0] ? undefined : opts.outDir,
    itemCount: completedItems,
  }
}

export function download(
  opts: DownloadOptions,
  handlers: DownloadHandlers,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  if (opts.isPlaylist && opts.entries && opts.entries.length > 0) {
    return downloadConcurrentPlaylist(
      {
        ytdlp: opts.ytdlp,
        ffmpegLocation: opts.ffmpegLocation,
        entries: opts.entries,
        selectedIndices: opts.selectedIndices,
        playlistItems: opts.playlistItems,
        choice: opts.choice,
        outDir: opts.outDir,
        concurrency: opts.concurrency,
      },
      handlers,
      signal,
    )
  }

  const outputTemplate = opts.isPlaylist
    ? path.join(opts.outDir, '%(playlist_index)02d - %(title).60s.%(ext)s')
    : path.join(opts.outDir, '%(title).60s.%(ext)s')

  const args = [
    ...(opts.infoJsonPath ? ['--load-info-json', opts.infoJsonPath] : [opts.url]),
    ...opts.choice.args,
    opts.isPlaylist ? '--yes-playlist' : '--no-playlist',
    ...(opts.isPlaylist ? ['--ignore-errors'] : []),
    ...(opts.playlistItems ? ['--playlist-items', opts.playlistItems] : []),
    '-N',
    '4',
    '--no-warnings',
    '--newline',
    // --print implies --quiet, which suppresses progress bars and the
    // [Merger]/[ExtractAudio] lines we detect the processing phase from
    '--no-quiet',
    '--progress',
    '--progress-template',
    `download:${PROGRESS_TEMPLATE}`,
    '--print',
    'download:ITEM:%(playlist_index)s/%(n_entries)s|%(title)s',
    '--print',
    'after_move:FILE:%(filepath)s',
    '--no-simulate',
    '-o',
    outputTemplate,
  ]
  if (opts.ffmpegLocation) args.push('--ffmpeg-location', opts.ffmpegLocation)

  return new Promise((resolve, reject) => {
    const child = spawn(opts.ytdlp, args, {signal})
    activeChild = child

    let stderr = ''
    let lastFilepath = ''
    let part = 0
    let totalParts = 1
    let lastDownloaded = 0
    let buffer = ''
    let currentItemIndex: number | undefined
    let currentTotalItems: number | undefined = opts.totalItems
    let currentItemTitle: string | undefined
    let downloadedCount = 0
    // every file yt-dlp writes this run, so a cancel can clean up after itself
    const destinations: string[] = []

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        if (line.startsWith(PROGRESS_PREFIX)) {
          const [downloaded, total, totalEstimate, speed, eta] = line.slice(PROGRESS_PREFIX.length).split('|')
          const downloadedBytes = toNumber(downloaded) ?? 0
          if (downloadedBytes < lastDownloaded) part++
          lastDownloaded = downloadedBytes
          handlers.onProgress({
            downloadedBytes,
            totalBytes: toNumber(total) ?? toNumber(totalEstimate),
            speed: toNumber(speed),
            eta: toNumber(eta),
            part,
            totalParts,
            itemIndex: currentItemIndex,
            totalItems: currentTotalItems,
            itemTitle: currentItemTitle,
          })
        } else if (line.startsWith('ITEM:')) {
          const rest = line.slice('ITEM:'.length)
          const pipeIndex = rest.indexOf('|')
          const countPart = pipeIndex === -1 ? rest : rest.slice(0, pipeIndex)
          const title = pipeIndex === -1 ? '' : rest.slice(pipeIndex + 1)
          const [idxStr, totalStr] = countPart.split('/')
          currentItemIndex = toNumber(idxStr)
          currentTotalItems = toNumber(totalStr) ?? opts.totalItems
          currentItemTitle = title || undefined
        } else if (line.startsWith('FILE:')) {
          const target = line.slice('FILE:'.length).trim()
          if (target) {
            destinations.push(target)
            lastFilepath = target
            downloadedCount++
          }
        } else if (line.includes('Downloading 1 format(s):')) {
          // "[info] xxx: Downloading 1 format(s): 395+251" — each id is one file
          totalParts = (line.split('format(s):')[1] ?? '').trim().split('+').length
        } else if (line.includes('[Merger]') || line.includes('[ExtractAudio]')) {
          const merging = /^\[Merger\] Merging formats into "(.+)"$/.exec(line)?.[1]
          const extracting = /^\[ExtractAudio\] Destination: (.+)$/.exec(line)?.[1]
          const target = merging ?? extracting
          if (target) destinations.push(target)
          handlers.onProcessing()
        } else if (line.startsWith('[download] Destination: ')) {
          destinations.push(line.slice('[download] Destination: '.length))
        } else if (path.isAbsolute(line)) {
          lastFilepath = line
        }
      }
    })
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', reject)
    child.on('close', code => {
      activeChild = undefined
      if (signal?.aborted) {
        // cancelled on purpose — don't leave half-written files behind
        void removePartials(destinations)
        reject(new Error('Download cancelled.'))
        return
      }
      if (code === 0) {
        if (opts.isPlaylist) {
          resolve({
            folderpath: opts.outDir,
            itemCount: downloadedCount || opts.totalItems,
          })
        } else if (lastFilepath) {
          resolve({filepath: lastFilepath})
        } else {
          resolve({filepath: destinations.at(-1) || opts.outDir})
        }
      } else {
        reject(new Error(cleanYtDlpError(stderr) || `Download failed (yt-dlp exit code ${code}).`))
      }
    })
  })
}

function removePartials(destinations: string[]): Promise<unknown> {
  return Promise.allSettled(
    destinations
      .flatMap(dest => [dest, `${dest}.part`, `${dest}.ytdl`])
      .map(file => fs.rm(file, {force: true})),
  )
}

function toNumber(value: string | undefined): number | undefined {
  if (!value || value === 'NA' || value === 'None') return undefined
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : undefined
}

function cleanYtDlpError(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('ERROR:'))
  const last = lines.at(-1)
  return last ? last.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '') : ''
}
