import fs from 'fs/promises'

/**
 * Reads and parses a JSON file.
 * @param {string} filepath - Absolute path to the JSON file
 * @returns {Promise<Object>}
 */
export async function readJson (filepath) {
  return JSON.parse(await fs.readFile(filepath))
}
