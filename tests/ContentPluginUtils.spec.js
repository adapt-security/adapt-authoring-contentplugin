import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import {
  readJson,
  backupPluginVersion,
  getMostRecentBackup,
  cleanupOldPluginBackups,
  restorePluginFromBackup,
  processPluginFiles
} from '../lib/utils.js'

// ---------------------------------------------------------------------------
// readJson
// ---------------------------------------------------------------------------
describe('readJson()', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpu-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('should parse a valid JSON file', async () => {
    const filePath = path.join(tmpDir, 'data.json')
    await fs.writeFile(filePath, JSON.stringify({ name: 'test', version: '1.0.0' }))
    const result = await readJson(filePath)
    assert.deepEqual(result, { name: 'test', version: '1.0.0' })
  })

  it('should throw on invalid JSON', async () => {
    const filePath = path.join(tmpDir, 'bad.json')
    await fs.writeFile(filePath, '{ not valid }')
    await assert.rejects(() => readJson(filePath), SyntaxError)
  })

  it('should throw ENOENT when file does not exist', async () => {
    await assert.rejects(
      () => readJson(path.join(tmpDir, 'nope.json')),
      (err) => err.code === 'ENOENT'
    )
  })
})

// ---------------------------------------------------------------------------
// backupPluginVersion
// ---------------------------------------------------------------------------
describe('backupPluginVersion()', () => {
  let tmpDir
  let log

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpu-test-'))
    log = mock.fn()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  /**
   * Helper: create a fake plugin directory with a package.json.
   */
  async function createPlugin (name, version, { useBower = false } = {}) {
    const pluginPath = path.join(tmpDir, name)
    await fs.mkdir(pluginPath, { recursive: true })
    const filename = useBower ? 'bower.json' : 'package.json'
    await fs.writeFile(
      path.join(pluginPath, filename),
      JSON.stringify({ name, version })
    )
    return pluginPath
  }

  it('should return null when the plugin directory does not exist', async () => {
    const result = await backupPluginVersion(
      path.join(tmpDir, 'nonexistent'),
      'nonexistent',
      log
    )
    assert.equal(result, null)
    assert.equal(log.mock.callCount(), 0)
  })

  it('should rename the plugin directory to a versioned backup', async () => {
    const pluginPath = await createPlugin('adapt-hotgrid', '4.3.5')

    const result = await backupPluginVersion(pluginPath, 'adapt-hotgrid', log)

    const expectedBackup = `${pluginPath}-v4.3.5`
    assert.equal(result, expectedBackup)

    // Original should be gone, backup should exist
    await assert.rejects(() => fs.access(pluginPath), { code: 'ENOENT' })
    await fs.access(expectedBackup) // should not throw
  })

  it('should read version from bower.json when package.json is absent', async () => {
    const pluginPath = await createPlugin('adapt-vanilla', '2.1.0', { useBower: true })

    const result = await backupPluginVersion(pluginPath, 'adapt-vanilla', log)

    assert.equal(result, `${pluginPath}-v2.1.0`)
  })

  it('should use unknown-<timestamp> when neither package.json nor bower.json exist', async () => {
    const pluginPath = path.join(tmpDir, 'adapt-empty')
    await fs.mkdir(pluginPath)

    const result = await backupPluginVersion(pluginPath, 'adapt-empty', log)

    assert.ok(result.startsWith(`${pluginPath}-vunknown-`))
    // Should have logged a warning
    const warns = log.mock.calls.filter(c => c.arguments[0] === 'warn')
    assert.equal(warns.length, 1)
  })

  it('should succeed when a backup directory already exists (bug #2 regression)', async () => {
    const pluginPath = await createPlugin('adapt-hotgrid', '4.3.5')
    const backupDir = `${pluginPath}-v4.3.5`

    // Pre-create a stale backup with content (simulates previous test run)
    await fs.mkdir(backupDir, { recursive: true })
    await fs.writeFile(path.join(backupDir, 'stale-file.txt'), 'old data')

    // This would fail with ENOTEMPTY before the fix
    const result = await backupPluginVersion(pluginPath, 'adapt-hotgrid', log)

    assert.equal(result, backupDir)
    // Original should be gone
    await assert.rejects(() => fs.access(pluginPath), { code: 'ENOENT' })
    // Backup should exist and contain the new package.json, not the stale file
    const pkg = JSON.parse(await fs.readFile(path.join(backupDir, 'package.json'), 'utf8'))
    assert.equal(pkg.version, '4.3.5')
    await assert.rejects(
      () => fs.access(path.join(backupDir, 'stale-file.txt')),
      { code: 'ENOENT' }
    )
  })

  it('should log an info message on success', async () => {
    const pluginPath = await createPlugin('adapt-text', '1.0.0')

    await backupPluginVersion(pluginPath, 'adapt-text', log)

    const infoCalls = log.mock.calls.filter(c => c.arguments[0] === 'info')
    assert.equal(infoCalls.length, 1)
    assert.ok(infoCalls[0].arguments[1].includes('adapt-text'))
  })

  it('should work without a log callback', async () => {
    const pluginPath = await createPlugin('adapt-nolog', '1.0.0')

    // Should not throw even though log is undefined
    const result = await backupPluginVersion(pluginPath, 'adapt-nolog')

    assert.equal(result, `${pluginPath}-v1.0.0`)
  })
})

// ---------------------------------------------------------------------------
// getMostRecentBackup
// ---------------------------------------------------------------------------
describe('getMostRecentBackup()', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpu-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('should return null when no backups exist', async () => {
    const result = await getMostRecentBackup(tmpDir, 'adapt-hotgrid')
    assert.equal(result, null)
  })

  it('should return the only backup when there is one', async () => {
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-v1.0.0'))

    const result = await getMostRecentBackup(tmpDir, 'adapt-hotgrid')

    assert.equal(result, path.join(tmpDir, 'adapt-hotgrid-v1.0.0'))
  })

  it('should return the highest semver version', async () => {
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-v1.0.0'))
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-v2.3.1'))
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-v1.9.9'))

    const result = await getMostRecentBackup(tmpDir, 'adapt-hotgrid')

    assert.equal(result, path.join(tmpDir, 'adapt-hotgrid-v2.3.1'))
  })

  it('should handle non-semver versions with alphabetical fallback', async () => {
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-vunknown-100'))
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-vunknown-200'))

    const result = await getMostRecentBackup(tmpDir, 'adapt-hotgrid')

    assert.equal(result, path.join(tmpDir, 'adapt-hotgrid-vunknown-200'))
  })

  it('should not match backups for other plugins', async () => {
    await fs.mkdir(path.join(tmpDir, 'adapt-text-v1.0.0'))

    const result = await getMostRecentBackup(tmpDir, 'adapt-hotgrid')

    assert.equal(result, null)
  })
})

// ---------------------------------------------------------------------------
// cleanupOldPluginBackups
// ---------------------------------------------------------------------------
describe('cleanupOldPluginBackups()', () => {
  let tmpDir
  let log

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpu-test-'))
    log = mock.fn()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('should do nothing when no backups exist', async () => {
    await cleanupOldPluginBackups(tmpDir, 'adapt-hotgrid', log)
    assert.equal(log.mock.callCount(), 0)
  })

  it('should do nothing when only one backup exists', async () => {
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-v1.0.0'))

    await cleanupOldPluginBackups(tmpDir, 'adapt-hotgrid', log)

    // Backup should still exist
    await fs.access(path.join(tmpDir, 'adapt-hotgrid-v1.0.0'))
    assert.equal(log.mock.callCount(), 0)
  })

  it('should remove all but the most recent backup', async () => {
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-v1.0.0'))
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-v2.0.0'))
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-v3.0.0'))

    await cleanupOldPluginBackups(tmpDir, 'adapt-hotgrid', log)

    // v3.0.0 should survive, the others should be gone
    await fs.access(path.join(tmpDir, 'adapt-hotgrid-v3.0.0'))
    await assert.rejects(() => fs.access(path.join(tmpDir, 'adapt-hotgrid-v1.0.0')), { code: 'ENOENT' })
    await assert.rejects(() => fs.access(path.join(tmpDir, 'adapt-hotgrid-v2.0.0')), { code: 'ENOENT' })
  })

  it('should log info for each removed backup', async () => {
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-v1.0.0'))
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-v2.0.0'))

    await cleanupOldPluginBackups(tmpDir, 'adapt-hotgrid', log)

    const infoCalls = log.mock.calls.filter(c => c.arguments[0] === 'info')
    assert.equal(infoCalls.length, 1)
  })

  it('should not affect backups from other plugins', async () => {
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-v1.0.0'))
    await fs.mkdir(path.join(tmpDir, 'adapt-hotgrid-v2.0.0'))
    await fs.mkdir(path.join(tmpDir, 'adapt-text-v1.0.0'))

    await cleanupOldPluginBackups(tmpDir, 'adapt-hotgrid', log)

    // adapt-text backup should be untouched
    await fs.access(path.join(tmpDir, 'adapt-text-v1.0.0'))
  })
})

// ---------------------------------------------------------------------------
// restorePluginFromBackup
// ---------------------------------------------------------------------------
describe('restorePluginFromBackup()', () => {
  let tmpDir
  let log

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpu-test-'))
    log = mock.fn()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('should return null when no backup exists', async () => {
    const result = await restorePluginFromBackup(tmpDir, 'adapt-hotgrid', log)
    assert.equal(result, null)
  })

  it('should restore the most recent backup into the plugin directory', async () => {
    const backupDir = path.join(tmpDir, 'adapt-hotgrid-v2.0.0')
    await fs.mkdir(backupDir)
    await fs.writeFile(path.join(backupDir, 'package.json'), JSON.stringify({ name: 'adapt-hotgrid', version: '2.0.0' }))

    const result = await restorePluginFromBackup(tmpDir, 'adapt-hotgrid', log)

    assert.equal(result.name, 'adapt-hotgrid')
    assert.equal(result.version, '2.0.0')
    // Plugin dir should now exist, backup dir should be gone
    await fs.access(path.join(tmpDir, 'adapt-hotgrid'))
    await assert.rejects(() => fs.access(backupDir), { code: 'ENOENT' })
  })

  it('should remove the current plugin directory before restoring', async () => {
    // Create current version
    const pluginPath = path.join(tmpDir, 'adapt-hotgrid')
    await fs.mkdir(pluginPath)
    await fs.writeFile(path.join(pluginPath, 'package.json'), JSON.stringify({ name: 'adapt-hotgrid', version: '3.0.0' }))
    // Create backup
    const backupDir = path.join(tmpDir, 'adapt-hotgrid-v2.0.0')
    await fs.mkdir(backupDir)
    await fs.writeFile(path.join(backupDir, 'package.json'), JSON.stringify({ name: 'adapt-hotgrid', version: '2.0.0' }))

    const result = await restorePluginFromBackup(tmpDir, 'adapt-hotgrid', log)

    assert.equal(result.version, '2.0.0')
  })

  it('should read version from bower.json if no package.json', async () => {
    const backupDir = path.join(tmpDir, 'adapt-hotgrid-v1.0.0')
    await fs.mkdir(backupDir)
    await fs.writeFile(path.join(backupDir, 'bower.json'), JSON.stringify({ name: 'adapt-hotgrid', version: '1.0.0' }))

    const result = await restorePluginFromBackup(tmpDir, 'adapt-hotgrid', log)

    assert.equal(result.version, '1.0.0')
  })

  it('should throw when backup has neither package.json nor bower.json', async () => {
    const backupDir = path.join(tmpDir, 'adapt-hotgrid-v1.0.0')
    await fs.mkdir(backupDir)
    await fs.writeFile(path.join(backupDir, 'readme.txt'), 'no metadata')

    await assert.rejects(
      () => restorePluginFromBackup(tmpDir, 'adapt-hotgrid', log),
      (err) => err.message.includes('Could not read package.json or bower.json')
    )
  })

  it('should log an info message on success', async () => {
    const backupDir = path.join(tmpDir, 'adapt-hotgrid-v1.0.0')
    await fs.mkdir(backupDir)
    await fs.writeFile(path.join(backupDir, 'package.json'), JSON.stringify({ name: 'adapt-hotgrid', version: '1.0.0' }))

    await restorePluginFromBackup(tmpDir, 'adapt-hotgrid', log)

    const infoCalls = log.mock.calls.filter(c => c.arguments[0] === 'info')
    assert.equal(infoCalls.length, 1)
    assert.ok(infoCalls[0].arguments[1].includes('adapt-hotgrid'))
  })
})

// ---------------------------------------------------------------------------
// processPluginFiles
// ---------------------------------------------------------------------------
describe('processPluginFiles()', () => {
  let tmpDir
  let pluginDir
  let log

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpu-test-'))
    pluginDir = path.join(tmpDir, 'plugins')
    await fs.mkdir(pluginDir)
    log = mock.fn()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('should return a non-local install when sourcePath has no directory component', async () => {
    const result = await processPluginFiles(
      { name: 'adapt-hotgrid', sourcePath: '4.3.5' },
      pluginDir,
      log
    )
    assert.deepEqual(result, { name: 'adapt-hotgrid', version: '4.3.5', isLocalInstall: false })
  })

  it('should read package.json and copy source to pluginDir', async () => {
    // Create source directory with plugin files
    const sourcePath = path.join(tmpDir, 'source', 'adapt-hotgrid')
    await fs.mkdir(sourcePath, { recursive: true })
    await fs.writeFile(
      path.join(sourcePath, 'package.json'),
      JSON.stringify({ name: 'adapt-hotgrid', version: '4.3.5' })
    )
    await fs.writeFile(path.join(sourcePath, 'index.js'), 'module.exports = {}')

    const result = await processPluginFiles(
      { name: 'adapt-hotgrid', sourcePath },
      pluginDir,
      log
    )

    assert.equal(result.name, 'adapt-hotgrid')
    assert.equal(result.version, '4.3.5')
    assert.equal(result.isLocalInstall, true)
    assert.equal(result.sourcePath, path.join(pluginDir, 'adapt-hotgrid'))

    // Plugin should now be in pluginDir
    const copiedPkg = await readJson(path.join(pluginDir, 'adapt-hotgrid', 'package.json'))
    assert.equal(copiedPkg.version, '4.3.5')

    // Source should be removed
    await assert.rejects(() => fs.access(sourcePath), { code: 'ENOENT' })
  })

  it('should fall back to bower.json when package.json is absent', async () => {
    const sourcePath = path.join(tmpDir, 'source', 'adapt-vanilla')
    await fs.mkdir(sourcePath, { recursive: true })
    await fs.writeFile(
      path.join(sourcePath, 'bower.json'),
      JSON.stringify({ name: 'adapt-vanilla', version: '2.0.0' })
    )
    await fs.writeFile(path.join(sourcePath, 'index.js'), '')

    const result = await processPluginFiles(
      { name: 'adapt-vanilla', sourcePath },
      pluginDir,
      log
    )

    assert.equal(result.name, 'adapt-vanilla')
    assert.equal(result.isLocalInstall, true)
  })

  it('should handle a nested root folder in the source', async () => {
    // Source has a single subfolder containing the actual plugin
    const sourcePath = path.join(tmpDir, 'source')
    await fs.mkdir(path.join(sourcePath, 'adapt-hotgrid'), { recursive: true })
    await fs.writeFile(
      path.join(sourcePath, 'adapt-hotgrid', 'package.json'),
      JSON.stringify({ name: 'adapt-hotgrid', version: '1.0.0' })
    )

    const result = await processPluginFiles(
      { name: 'adapt-hotgrid', sourcePath },
      pluginDir,
      log
    )

    assert.equal(result.name, 'adapt-hotgrid')
    assert.equal(result.isLocalInstall, true)
  })

  it('should throw when source has no package.json or bower.json', async () => {
    const sourcePath = path.join(tmpDir, 'source', 'bad-plugin')
    await fs.mkdir(sourcePath, { recursive: true })
    await fs.writeFile(path.join(sourcePath, 'readme.txt'), 'no metadata')

    await assert.rejects(
      () => processPluginFiles(
        { name: 'bad-plugin', sourcePath },
        pluginDir,
        log
      ),
      (err) => err.message.startsWith('Invalid plugin zip')
    )
  })

  it('should back up existing plugin before copying new version', async () => {
    // Pre-existing plugin in pluginDir
    const existingPath = path.join(pluginDir, 'adapt-hotgrid')
    await fs.mkdir(existingPath)
    await fs.writeFile(
      path.join(existingPath, 'package.json'),
      JSON.stringify({ name: 'adapt-hotgrid', version: '3.0.0' })
    )

    // New source
    const sourcePath = path.join(tmpDir, 'source', 'adapt-hotgrid')
    await fs.mkdir(sourcePath, { recursive: true })
    await fs.writeFile(
      path.join(sourcePath, 'package.json'),
      JSON.stringify({ name: 'adapt-hotgrid', version: '4.0.0' })
    )
    await fs.writeFile(path.join(sourcePath, 'index.js'), '')

    const result = await processPluginFiles(
      { name: 'adapt-hotgrid', sourcePath },
      pluginDir,
      log
    )

    assert.equal(result.version, '4.0.0')
    // Backup should exist
    await fs.access(path.join(pluginDir, 'adapt-hotgrid-v3.0.0'))
    // New version should be in place
    const pkg = await readJson(path.join(pluginDir, 'adapt-hotgrid', 'package.json'))
    assert.equal(pkg.version, '4.0.0')
  })
})
