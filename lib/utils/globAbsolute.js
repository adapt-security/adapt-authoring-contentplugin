import fs from 'fs/promises'
import path from 'path'

/**
 * Glob for files and return absolute paths.
 *
 * Wraps Node's built-in `fs.glob` (async iterator) and collects
 * matches into an array of absolute paths.
 *
 * @param {string} pattern - Glob pattern
 * @param {string} cwd - Directory to search in
 * @returns {Promise<string[]>} Matching absolute paths
 */
export async function globAbsolute (pattern, cwd) {
  return Array.fromAsync(fs.glob(pattern, { cwd }), match => path.join(cwd, match))
}
