import assert from 'node:assert/strict'
import test from 'node:test'
import {parseArgs} from './args.js'
import {isThemeMode, nextThemeMode, themeFor} from '../theme.js'

test('parses a url and a spaced theme option without confusing the value for the url', () => {
  assert.deepEqual(parseArgs(['--theme', 'light', 'https://example.com/video']), {
    help: false,
    version: false,
    themeMode: 'light',
    initialUrl: 'https://example.com/video',
  })
})

test('parses an equals-style theme option after the url', () => {
  assert.deepEqual(parseArgs(['https://example.com/video', '--theme=dark']), {
    help: false,
    version: false,
    themeMode: 'dark',
    initialUrl: 'https://example.com/video',
  })
})

test('parses output directory, playlist, concurrency, and items options', () => {
  assert.deepEqual(parseArgs(['-o', '/path/to/downloads', 'https://example.com/video']), {
    help: false,
    version: false,
    outputDir: '/path/to/downloads',
    initialUrl: 'https://example.com/video',
  })
  assert.deepEqual(parseArgs(['--output=/path/to/downloads', '--playlist', '-c', '4', '--items=1-5']), {
    help: false,
    version: false,
    outputDir: '/path/to/downloads',
    playlistMode: 'playlist',
    concurrency: 4,
    playlistItems: '1-5',
  })
  assert.deepEqual(parseArgs(['--dir', '~/Music', '--no-playlist', '--concurrency=2', '--playlist-items', '1,3,5']), {
    help: false,
    version: false,
    outputDir: '~/Music',
    playlistMode: 'video',
    concurrency: 2,
    playlistItems: '1,3,5',
  })
})

test('rejects missing, invalid, and unknown options', () => {
  assert.match(parseArgs(['--theme']).error ?? '', /needs a value/)
  assert.match(parseArgs(['--theme', 'sepia']).error ?? '', /unknown theme/)
  assert.match(parseArgs(['-o']).error ?? '', /needs a directory path/)
  assert.match(parseArgs(['--output=']).error ?? '', /needs a directory path/)
  assert.match(parseArgs(['-c']).error ?? '', /needs a positive number/)
  assert.match(parseArgs(['-c', '0']).error ?? '', /positive integer/)
  assert.match(parseArgs(['--concurrency=foo']).error ?? '', /positive integer/)
  assert.match(parseArgs(['--items']).error ?? '', /needs a range specification/)
  assert.match(parseArgs(['--items=']).error ?? '', /needs a range specification/)
  assert.match(parseArgs(['--wat']).error ?? '', /unknown option/)
  assert.match(parseArgs(['one', 'two']).error ?? '', /single url/)
})

test('recognizes only supported modes and cycles through all of them', () => {
  assert.equal(isThemeMode('auto'), true)
  assert.equal(isThemeMode('light'), true)
  assert.equal(isThemeMode('dark'), true)
  assert.equal(isThemeMode('sepia'), false)
  assert.equal(nextThemeMode('auto'), 'light')
  assert.equal(nextThemeMode('light'), 'dark')
  assert.equal(nextThemeMode('dark'), 'auto')
})

test('auto delegates to terminal colors while forced modes own the full surface', () => {
  assert.deepEqual(themeFor('auto'), {
    mode: 'auto',
    primary: undefined,
    gray: undefined,
    dark: undefined,
    background: undefined,
    dimSecondary: true,
    inverseButton: true,
  })

  assert.equal(themeFor('light').background, '#ffffff')
  assert.equal(themeFor('light').primary, '#18181b')
  assert.equal(themeFor('dark').background, '#18181b')
  assert.equal(themeFor('dark').primary, '#ffffff')
})
