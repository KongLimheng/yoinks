import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import {resolveDestination, sanitizeFolderName} from './path-utils.js'

test('resolveDestination expands ~ and handles relative/absolute paths', () => {
  const fakeHome = '/Users/tester'

  assert.equal(resolveDestination('', fakeHome), path.join(fakeHome, 'Downloads'))
  assert.equal(resolveDestination('   ', fakeHome), path.join(fakeHome, 'Downloads'))
  assert.equal(resolveDestination('~', fakeHome), fakeHome)
  assert.equal(resolveDestination('~/Videos', fakeHome), '/Users/tester/Videos')
  assert.equal(resolveDestination('~/Downloads/My Playlist', fakeHome), '/Users/tester/Downloads/My Playlist')
  assert.equal(resolveDestination('/tmp/folder', fakeHome), '/tmp/folder')
})

test('sanitizeFolderName cleans illegal characters and formats cleanly', () => {
  assert.equal(sanitizeFolderName('Python 3.4 Programming: Tutorials/Part 1*?'), 'Python 3.4 Programming_ Tutorials_Part 1')
  assert.equal(sanitizeFolderName('   Cool   Folder...  '), 'Cool Folder')
  assert.equal(sanitizeFolderName(''), 'Playlist')
  assert.equal(sanitizeFolderName('???///:::***'), 'Playlist')
})
