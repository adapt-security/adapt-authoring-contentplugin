import fs from 'fs/promises'
import { glob } from 'glob'
import { getMostRecentBackup } from './getMostRecentBackup.js'

/**
 * Cleans up old plugin version backups, keeping only the most recent one.
 *
 * @param {string} pluginDir - Base directory containing plugins
 * @param {string} pluginName - Name of the plugin
 * @param {Function} [log] - Optional logging callback `(level, msg) => void`
 * @returns {Promise<void>}
 */
export async function cleanupOldPluginBackups (pluginDir, pluginName, log) {
  const pattern = `${pluginName}-v*`
  const backups = await glob(pattern, { cwd: pluginDir, absolute: true })

  if (backups.length <= 1) {
    return
  }

  const mostRecent = await getMostRecentBackup(pluginDir, pluginName)

  const backupsToRemove = backups.filter(backup => backup !== mostRecent)
  for (const backup of backupsToRemove) {
    await fs.rm(backup, { recursive: true })
    if (log) log('info', `Removed old backup: ${backup}`)
  }
}
