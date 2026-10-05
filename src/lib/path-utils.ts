import os from 'node:os'
import path from 'node:path'

/**
 * Expand leading ~ to homedir and resolve relative paths to absolute paths.
 * If input is empty, defaults to ~/Downloads.
 */
export function resolveDestination(inputPath: string, homedir = os.homedir()): string {
  const trimmed = inputPath.trim()
  if (!trimmed) return path.join(homedir, 'Downloads')

  let expanded = trimmed
  if (expanded === '~') {
    expanded = homedir
  } else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = path.join(homedir, expanded.slice(2))
  }

  return path.resolve(expanded)
}

/**
 * Sanitize a string for safe use as a directory or file name across platforms.
 */
export function sanitizeFolderName(name: string): string {
  const sanitized = name
    // replace illegal characters on Windows/Linux/macOS
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    // collapse multiple underscores or spaces
    .replace(/_+/g, '_')
    .replace(/\s+/g, ' ')
    // remove trailing dots/spaces/underscores
    .replace(/[. _]+$/, '')
    .replace(/^[. _]+/, '')
    .trim()

  return sanitized.slice(0, 100) || 'Playlist'
}
