import fs from 'fs/promises'
import path from 'path'
import { readJson } from './readJson.js'
import { backupPluginVersion } from './backupPluginVersion.js'
import { cleanupOldPluginBackups } from './cleanupOldPluginBackups.js'

/**
 * Processes local plugin source files for installation.
 *
 * If `sourcePath` is just a filename (no directory component), returns a
 * non-local install descriptor.  Otherwise reads the package metadata from
 * the source, backs up any existing version, cleans old backups, and copies
 * the source files into their persistent location under `pluginDir`.
 *
 * @param {Object} pluginData - Plugin metadata (must include `name` and `sourcePath`)
 * @param {string} pluginDir - Persistent plugin storage directory
 * @param {Function} [log] - Optional logging callback `(level, msg) => void`
 * @returns {Promise<Object>} Package metadata with `sourcePath` and `isLocalInstall` fields
 * @throws {Error} If the source contains no valid package.json or bower.json
 */
export async function processPluginFiles (pluginData, pluginDir, log) {
  let sourcePath = pluginData.sourcePath
  if (sourcePath === path.basename(sourcePath)) { // no local files
    return { name: pluginData.name, version: sourcePath, isLocalInstall: false }
  }
  const contents = await fs.readdir(sourcePath)
  if (contents.length === 1) { // deal with a nested root folder
    sourcePath = path.join(pluginData.sourcePath, contents[0])
  }
  let pkg
  try {
    try {
      pkg = await readJson(path.join(sourcePath, 'package.json'))
    } catch (e) {
      pkg = await readJson(path.join(sourcePath, 'bower.json'))
    }
    pkg.sourcePath = path.join(pluginDir, pkg.name)
    pkg.isLocalInstall = true
  } catch (e) {
    throw new Error(`Invalid plugin zip: no package.json or bower.json found in ${sourcePath}`)
  }

  // Back up the existing version if it exists
  await backupPluginVersion(pkg.sourcePath, pkg.name, log)

  // Clean up old backups (keep only 1 previous version)
  await cleanupOldPluginBackups(pluginDir, pkg.name, log)

  // move the files into the persistent location
  await fs.cp(sourcePath, pkg.sourcePath, { recursive: true })
  await fs.rm(sourcePath, { recursive: true })
  return pkg
}
