import { glob } from 'glob'
import path from 'path'
import semver from 'semver'

/**
 * Gets the most recent backup for a plugin based on version sorting.
 *
 * Scans for directories matching `<pluginName>-v*` in the given directory,
 * sorts by semver (falling back to alphabetical for non-semver), and
 * returns the most recent.
 *
 * @param {string} pluginDir - Base directory containing plugins
 * @param {string} pluginName - Name of the plugin
 * @returns {Promise<string|null>} Absolute path to the most recent backup, or null if none found
 */
export async function getMostRecentBackup (pluginDir, pluginName) {
  const pattern = `${pluginName}-v*`
  const backups = await glob(pattern, { cwd: pluginDir, absolute: true })

  if (backups.length === 0) {
    return null
  }

  // Sort by version (newest first)
  backups.sort((a, b) => {
    const versionA = path.basename(a).replace(`${pluginName}-v`, '')
    const versionB = path.basename(b).replace(`${pluginName}-v`, '')

    if (semver.valid(versionA) && semver.valid(versionB)) {
      return semver.rcompare(versionA, versionB)
    }

    return b.localeCompare(a)
  })

  return backups[0]
}
