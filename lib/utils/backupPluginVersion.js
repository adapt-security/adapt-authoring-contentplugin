import fs from 'fs/promises'
import path from 'path'
import { readJson } from './readJson.js'

/**
 * Creates a versioned backup of an existing plugin directory.
 *
 * Reads the plugin version from package.json (or bower.json as fallback),
 * removes any stale backup at the target path, then renames the plugin
 * directory to `<pluginPath>-v<version>`.
 *
 * @param {string} pluginPath - Absolute path to the plugin directory
 * @param {string} pluginName - Human-readable plugin name (for logging)
 * @param {Function} [log] - Optional logging callback `(level, msg) => void`
 * @returns {Promise<string|null>} Path to the backup directory, or null if no backup was needed
 */
export async function backupPluginVersion (pluginPath, pluginName, log) {
  try {
    await fs.access(pluginPath)
  } catch (e) { // No plugin, no backup needed
    return null
  }
  let existingVersion
  try {
    const pkg = await readJson(path.join(pluginPath, 'package.json'))
    existingVersion = pkg.version
  } catch (e) {
    try {
      const bower = await readJson(path.join(pluginPath, 'bower.json'))
      existingVersion = bower.version
    } catch (e2) {
      if (log) log('warn', `Could not read version for backup of ${pluginName}`)
      existingVersion = `unknown-${Date.now()}`
    }
  }
  const backupDir = `${pluginPath}-v${existingVersion}`
  await fs.rename(pluginPath, backupDir)
  if (log) log('info', `Backed up ${pluginName}@${existingVersion}`)
  return backupDir
}
