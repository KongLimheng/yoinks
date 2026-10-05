import {isThemeMode, type ThemeMode} from '../theme.js'

export type CliArgs = {
  help: boolean
  version: boolean
  initialUrl?: string
  themeMode?: ThemeMode
  outputDir?: string
  playlistMode?: 'playlist' | 'video'
  concurrency?: number
  playlistItems?: string
  error?: string
}

export function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {help: false, version: false}
  const positional: string[] = []

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '-h' || arg === '--help') {
      result.help = true
    } else if (arg === '-v' || arg === '--version') {
      result.version = true
    } else if (arg === '--theme') {
      const value = args[++index]
      if (!value) return {...result, error: '--theme needs a value: auto, light, or dark'}
      if (!isThemeMode(value)) return {...result, error: `unknown theme “${value}” — use auto, light, or dark`}
      result.themeMode = value
    } else if (arg.startsWith('--theme=')) {
      const value = arg.slice('--theme='.length)
      if (!isThemeMode(value)) return {...result, error: `unknown theme “${value}” — use auto, light, or dark`}
      result.themeMode = value
    } else if (arg === '-o' || arg === '--output' || arg === '--dir') {
      const value = args[++index]
      if (!value) return {...result, error: `${arg} needs a directory path`}
      result.outputDir = value
    } else if (arg.startsWith('--output=') || arg.startsWith('--dir=')) {
      const value = arg.slice(arg.indexOf('=') + 1)
      if (!value) return {...result, error: `${arg.split('=')[0]} needs a directory path`}
      result.outputDir = value
    } else if (arg === '-c' || arg === '--concurrency') {
      const value = args[++index]
      if (!value) return {...result, error: `${arg} needs a positive number`}
      const n = Number.parseInt(value, 10)
      if (!Number.isInteger(n) || n <= 0) return {...result, error: '--concurrency must be a positive integer'}
      result.concurrency = n
    } else if (arg.startsWith('--concurrency=')) {
      const value = arg.slice('--concurrency='.length)
      if (!value) return {...result, error: '--concurrency needs a positive number'}
      const n = Number.parseInt(value, 10)
      if (!Number.isInteger(n) || n <= 0) return {...result, error: '--concurrency must be a positive integer'}
      result.concurrency = n
    } else if (arg === '--items' || arg === '--playlist-items') {
      const value = args[++index]
      if (!value) return {...result, error: `${arg} needs a range specification (e.g. 1-5, 8)`}
      result.playlistItems = value
    } else if (arg.startsWith('--items=') || arg.startsWith('--playlist-items=')) {
      const value = arg.slice(arg.indexOf('=') + 1)
      if (!value) return {...result, error: `${arg.split('=')[0]} needs a range specification (e.g. 1-5, 8)`}
      result.playlistItems = value
    } else if (arg === '--playlist' || arg === '--yes-playlist') {
      result.playlistMode = 'playlist'
    } else if (arg === '--no-playlist') {
      result.playlistMode = 'video'
    } else if (arg.startsWith('-')) {
      return {...result, error: `unknown option “${arg}”`}
    } else {
      positional.push(arg)
    }
  }

  if (positional.length > 1) return {...result, error: 'expected a single url'}
  if (positional[0]) result.initialUrl = positional[0]
  return result
}
