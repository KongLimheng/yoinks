export type Platform = {
  key: string
  label: string
}

const PLATFORMS: Array<{hosts: string[]; platform: Platform}> = [
  {hosts: ['youtube.com', 'youtu.be', 'music.youtube.com'], platform: {key: 'youtube', label: 'YouTube'}},
  {hosts: ['x.com', 'twitter.com'], platform: {key: 'x', label: 'X / Twitter'}},
  {hosts: ['instagram.com'], platform: {key: 'instagram', label: 'Instagram'}},
  {hosts: ['threads.net', 'threads.com'], platform: {key: 'threads', label: 'Threads'}},
  {hosts: ['tiktok.com'], platform: {key: 'tiktok', label: 'TikTok'}},
  {hosts: ['vimeo.com'], platform: {key: 'vimeo', label: 'Vimeo'}},
  {hosts: ['twitch.tv'], platform: {key: 'twitch', label: 'Twitch'}},
  {hosts: ['reddit.com'], platform: {key: 'reddit', label: 'Reddit'}},
  {hosts: ['facebook.com', 'fb.watch'], platform: {key: 'facebook', label: 'Facebook'}},
]

export function detectPlatform(url: string): Platform {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return {key: 'unknown', label: 'Unknown site'}
  }

  for (const {hosts, platform} of PLATFORMS) {
    if (hosts.some(h => hostname === h || hostname.endsWith(`.${h}`))) {
      return platform
    }
  }

  return {key: 'generic', label: hostname}
}

export function isProbablyUrl(input: string): boolean {
  try {
    const u = new URL(input.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export type YouTubeUrlInfo = {
  isYouTube: boolean
  hasVideo: boolean
  hasPlaylist: boolean
  videoId?: string
  playlistId?: string
}

export function parseYouTubeUrl(input: string): YouTubeUrlInfo {
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return {isYouTube: false, hasVideo: false, hasPlaylist: false, videoId: undefined, playlistId: undefined}
  }

  const hostname = u.hostname.toLowerCase()
  const isYt = ['youtube.com', 'youtu.be', 'music.youtube.com'].some(
    h => hostname === h || hostname.endsWith(`.${h}`),
  )

  if (!isYt) {
    return {isYouTube: false, hasVideo: false, hasPlaylist: false, videoId: undefined, playlistId: undefined}
  }

  let videoId: string | undefined
  const playlistId = u.searchParams.get('list') ?? undefined

  if (hostname === 'youtu.be' || hostname.endsWith('.youtu.be')) {
    const segment = u.pathname.replace(/^\/+/, '').split('/')[0]
    if (segment) videoId = segment
  } else if (u.pathname === '/watch') {
    videoId = u.searchParams.get('v') ?? undefined
  } else if (u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/live/') || u.pathname.startsWith('/embed/')) {
    videoId = u.pathname.split('/')[2] || undefined
  }

  return {
    isYouTube: true,
    hasVideo: Boolean(videoId),
    hasPlaylist: Boolean(playlistId),
    videoId,
    playlistId,
  }
}

