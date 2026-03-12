import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import { globAbsolute } from '../lib/utils/globAbsolute.js'

describe('globAbsolute()', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'glob-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('should return absolute paths for matching files', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.json'), '{}')
    await fs.writeFile(path.join(tmpDir, 'b.json'), '{}')

    const results = await globAbsolute('*.json', tmpDir)

    assert.equal(results.length, 2)
    results.forEach(r => assert.ok(path.isAbsolute(r)))
    assert.ok(results.includes(path.join(tmpDir, 'a.json')))
    assert.ok(results.includes(path.join(tmpDir, 'b.json')))
  })

  it('should return an empty array when nothing matches', async () => {
    const results = await globAbsolute('*.txt', tmpDir)
    assert.deepEqual(results, [])
  })

  it('should only match the given pattern', async () => {
    await fs.writeFile(path.join(tmpDir, 'match.json'), '{}')
    await fs.writeFile(path.join(tmpDir, 'skip.txt'), '')

    const results = await globAbsolute('*.json', tmpDir)

    assert.equal(results.length, 1)
    assert.equal(results[0], path.join(tmpDir, 'match.json'))
  })

  it('should support wildcard patterns', async () => {
    await fs.mkdir(path.join(tmpDir, 'plugin-v1.0.0'))
    await fs.mkdir(path.join(tmpDir, 'plugin-v2.0.0'))
    await fs.mkdir(path.join(tmpDir, 'other-v1.0.0'))

    const results = await globAbsolute('plugin-v*', tmpDir)

    assert.equal(results.length, 2)
    assert.ok(results.includes(path.join(tmpDir, 'plugin-v1.0.0')))
    assert.ok(results.includes(path.join(tmpDir, 'plugin-v2.0.0')))
  })
})
