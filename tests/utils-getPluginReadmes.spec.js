import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { getPluginReadmes } from '../lib/utils/getPluginReadmes.js'

describe('getPluginReadmes()', () => {
  let srcDir

  const writePlugin = async (category, name, readme) => {
    const dir = path.join(srcDir, category, name)
    await fs.mkdir(dir, { recursive: true })
    if (readme !== undefined) await fs.writeFile(path.join(dir, 'README.md'), readme)
  }

  beforeEach(async () => {
    srcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'readme-test-'))
    await writePlugin('components', 'adapt-contrib-text', '# Text')
    await writePlugin('extensions', 'adapt-contrib-spoor', '# Spoor')
    await writePlugin('menu', 'adapt-contrib-boxMenu', '# Box Menu')
    await writePlugin('theme', 'adapt-contrib-vanilla', '# Vanilla')
  })

  afterEach(async () => {
    await fs.rm(srcDir, { recursive: true, force: true })
  })

  it('should return every plugin README keyed by plugin name', async () => {
    const result = await getPluginReadmes(srcDir)
    assert.deepEqual(result, {
      'adapt-contrib-text': '# Text',
      'adapt-contrib-spoor': '# Spoor',
      'adapt-contrib-boxMenu': '# Box Menu',
      'adapt-contrib-vanilla': '# Vanilla'
    })
  })

  it('should limit the result to a single named plugin', async () => {
    const result = await getPluginReadmes(srcDir, 'adapt-contrib-spoor')
    assert.deepEqual(result, { 'adapt-contrib-spoor': '# Spoor' })
  })

  it('should return an empty object for an unknown plugin', async () => {
    assert.deepEqual(await getPluginReadmes(srcDir, 'does-not-exist'), {})
  })

  it('should ignore plugins without a README and non-plugin directories', async () => {
    await writePlugin('components', 'adapt-no-readme')
    await fs.mkdir(path.join(srcDir, 'core'), { recursive: true })
    await fs.writeFile(path.join(srcDir, 'core', 'README.md'), '# Core')

    const result = await getPluginReadmes(srcDir)
    assert.ok(!('adapt-no-readme' in result))
    assert.ok(!('core' in result))
  })
})
