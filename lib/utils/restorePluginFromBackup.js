import fs from 'fs/promises'
import path from 'path'
import { getMostRecentBackup } from './getMostRecentBackup.js'
import { readJson } from './readJson.js'

/**
 * Restores a plugin from its most recent versioned backup.
 *
 * Finds the newest backup directory, removes the current plugin directory
 * (if present), renames the backup into place, and reads the package metadata.
 *
 * @param {string} pluginDir - Base directory containing plugins
 * @param {string} pluginName - Name of the plugin to restore
 * @param {Function} [log] - Optional logging callback `(level, msg) => void`
 * @returns {Promise<Object|null>} Package metadata from the restored backup,
 *   or null if no backup was found
 * @throws {Error} If the restored backup contains no package.json or bower.json
 */
export async function restorePluginFromBackup (pluginDir, pluginName, log) {
  const pluginPath = path.join(pluginDir, pluginName)
  const mostRecentBackup = await getMostRecentBackup(pluginDir, pluginName)

  if (!mostRecentBackup) {
    return null
  }
  // Remove current version if it exists
  try {
    await fs.access(pluginPath)
    await fs.rm(pluginPath, { recursive: true })
  } catch (e) {
    // Current version doesn't exist, that's fine
  }
  // Restore the backup
  await fs.rename(mostRecentBackup, pluginPath)
  if (log) log('info', `Restored ${pluginName} from backup`)
  try {
    return await readJson(path.join(pluginPath, 'package.json'))
  } catch (e) {
    try {
      return await readJson(path.join(pluginPath, 'bower.json'))
    } catch (e2) {
      throw new Error(`Could not read package.json or bower.json from backup of ${pluginName}`)
    }
  }
}
