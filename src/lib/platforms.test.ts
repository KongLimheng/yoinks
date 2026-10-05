import assert from 'node:assert/strict'
import test from 'node:test'
import {parseYouTubeUrl} from './platforms.js'

test('parseYouTubeUrl distinguishes single videos, playlists, and combined urls', () => {
  // Pure playlist
  assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/playlist?list=PL6gx4Cwl9DGAcbMi1sH6oAMk4JHw91mC_'), {
    isYouTube: true,
    hasVideo: false,
    hasPlaylist: true,
    videoId: undefined,
    playlistId: 'PL6gx4Cwl9DGAcbMi1sH6oAMk4JHw91mC_',
  })

  // Video with playlist attached
  assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/watch?v=HBxCHonP6Ro&list=PL6gx4Cwl9DGAcbMi1sH6oAMk4JHw91mC_'), {
    isYouTube: true,
    hasVideo: true,
    hasPlaylist: true,
    videoId: 'HBxCHonP6Ro',
    playlistId: 'PL6gx4Cwl9DGAcbMi1sH6oAMk4JHw91mC_',
  })

  // youtu.be with playlist
  assert.deepEqual(parseYouTubeUrl('https://youtu.be/HBxCHonP6Ro?list=PL6gx4Cwl9DGAcbMi1sH6oAMk4JHw91mC_'), {
    isYouTube: true,
    hasVideo: true,
    hasPlaylist: true,
    videoId: 'HBxCHonP6Ro',
    playlistId: 'PL6gx4Cwl9DGAcbMi1sH6oAMk4JHw91mC_',
  })

  // Standard single video
  assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), {
    isYouTube: true,
    hasVideo: true,
    hasPlaylist: false,
    videoId: 'dQw4w9WgXcQ',
    playlistId: undefined,
  })

  // Non-YouTube url
  assert.deepEqual(parseYouTubeUrl('https://vimeo.com/123456'), {
    isYouTube: false,
    hasVideo: false,
    hasPlaylist: false,
    videoId: undefined,
    playlistId: undefined,
  })
})
