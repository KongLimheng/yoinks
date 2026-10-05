import assert from 'node:assert/strict'
import test from 'node:test'
import {buildPlaylistChoices} from './ytdlp.js'

test('buildPlaylistChoices provides stream quality presets for playlists', () => {
  const choices = buildPlaylistChoices()
  assert.equal(choices.length, 5)

  const best = choices[0]!
  assert.equal(best.kind, 'video')
  assert.match(best.label, /best quality/)
  assert.ok(best.args.includes('mp4'))

  const p1080 = choices[1]!
  assert.equal(p1080.kind, 'video')
  assert.match(p1080.label, /1080p/)
  assert.ok(p1080.args.some(a => a.includes('height<=1080')))

  const audio = choices.at(-1)!
  assert.equal(audio.kind, 'audio')
  assert.match(audio.label, /audio only/)
  assert.ok(audio.args.includes('mp3'))
})

test('downloadConcurrentPlaylist throws if no items selected', async () => {
  const {downloadConcurrentPlaylist} = await import('./ytdlp.js')
  await assert.rejects(
    () =>
      downloadConcurrentPlaylist(
        {
          ytdlp: 'yt-dlp',
          entries: [],
          choice: {kind: 'video', label: '1080p', args: []},
          outDir: '/tmp',
        },
        {onProgress: () => {}, onProcessing: () => {}},
      ),
    /No playlist items selected/,
  )
})
