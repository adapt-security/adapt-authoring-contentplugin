/**
 * Adds default plugins to a course config's _enabledPlugins list.
 * Intended to be tapped into the content module's preInsertHook.
 * @param {Object} contentplugin The contentplugin module instance
 * @param {Object} data The insert data (mutated in place)
 * @param {Object} options
 * @param {String} options.schemaName The schema name for the insert
 */
async function addDefaultPlugins (contentplugin, data, { schemaName }) {
  if (schemaName !== 'config') {
    return
  }
  const defaultPlugins = await contentplugin.find({ isAddedByDefault: true })
  if (!defaultPlugins.length) {
    return
  }
  if (!data._enabledPlugins) data._enabledPlugins = []
  defaultPlugins.forEach(({ name }) => !data._enabledPlugins.includes(name) && data._enabledPlugins.push(name))
}

export { addDefaultPlugins }
