import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { addDefaultPlugins } from '../lib/utils/addDefaultPlugins.js'

function createMockContentplugin (plugins = []) {
  return { find: async () => plugins }
}

describe('addDefaultPlugins', () => {
  describe('when schemaName is not config', () => {
    it('should not modify data for non-config schemas', async () => {
      const contentplugin = createMockContentplugin([{ name: 'plugin-a' }])
      const data = {}
      await addDefaultPlugins(contentplugin, data, { schemaName: 'course' })
      assert.equal(data._enabledPlugins, undefined)
    })

    it('should not modify data for article schema', async () => {
      const contentplugin = createMockContentplugin([{ name: 'plugin-a' }])
      const data = { _enabledPlugins: ['existing'] }
      await addDefaultPlugins(contentplugin, data, { schemaName: 'article' })
      assert.deepEqual(data._enabledPlugins, ['existing'])
    })
  })

  describe('when schemaName is config', () => {
    it('should add default plugins to _enabledPlugins', async () => {
      const contentplugin = createMockContentplugin([{ name: 'plugin-a' }, { name: 'plugin-b' }])
      const data = {}
      await addDefaultPlugins(contentplugin, data, { schemaName: 'config' })
      assert.deepEqual(data._enabledPlugins, ['plugin-a', 'plugin-b'])
    })

    it('should create _enabledPlugins array if it does not exist', async () => {
      const contentplugin = createMockContentplugin([{ name: 'plugin-a' }])
      const data = {}
      await addDefaultPlugins(contentplugin, data, { schemaName: 'config' })
      assert.ok(Array.isArray(data._enabledPlugins))
      assert.deepEqual(data._enabledPlugins, ['plugin-a'])
    })

    it('should append to existing _enabledPlugins', async () => {
      const contentplugin = createMockContentplugin([{ name: 'plugin-b' }])
      const data = { _enabledPlugins: ['plugin-a'] }
      await addDefaultPlugins(contentplugin, data, { schemaName: 'config' })
      assert.deepEqual(data._enabledPlugins, ['plugin-a', 'plugin-b'])
    })

    it('should not duplicate plugins already in _enabledPlugins', async () => {
      const contentplugin = createMockContentplugin([{ name: 'plugin-a' }, { name: 'plugin-b' }])
      const data = { _enabledPlugins: ['plugin-a'] }
      await addDefaultPlugins(contentplugin, data, { schemaName: 'config' })
      assert.deepEqual(data._enabledPlugins, ['plugin-a', 'plugin-b'])
    })

    it('should not modify _enabledPlugins when no default plugins found', async () => {
      const contentplugin = createMockContentplugin([])
      const data = { _enabledPlugins: ['existing'] }
      await addDefaultPlugins(contentplugin, data, { schemaName: 'config' })
      assert.deepEqual(data._enabledPlugins, ['existing'])
    })

    it('should not create _enabledPlugins when no default plugins found', async () => {
      const contentplugin = createMockContentplugin([])
      const data = {}
      await addDefaultPlugins(contentplugin, data, { schemaName: 'config' })
      assert.equal(data._enabledPlugins, undefined)
    })

    it('should call find with isAddedByDefault true', async () => {
      let findQuery
      const contentplugin = {
        find: async (query) => {
          findQuery = query
          return []
        }
      }
      await addDefaultPlugins(contentplugin, {}, { schemaName: 'config' })
      assert.deepEqual(findQuery, { isAddedByDefault: true })
    })

    it('should handle a single default plugin', async () => {
      const contentplugin = createMockContentplugin([{ name: 'only-plugin' }])
      const data = {}
      await addDefaultPlugins(contentplugin, data, { schemaName: 'config' })
      assert.deepEqual(data._enabledPlugins, ['only-plugin'])
    })

    it('should handle many default plugins', async () => {
      const plugins = Array.from({ length: 10 }, (_, i) => ({ name: `plugin-${i}` }))
      const contentplugin = createMockContentplugin(plugins)
      const data = {}
      await addDefaultPlugins(contentplugin, data, { schemaName: 'config' })
      assert.equal(data._enabledPlugins.length, 10)
      plugins.forEach((p, i) => {
        assert.equal(data._enabledPlugins[i], p.name)
      })
    })

    it('should handle all plugins already enabled', async () => {
      const contentplugin = createMockContentplugin([{ name: 'plugin-a' }, { name: 'plugin-b' }])
      const data = { _enabledPlugins: ['plugin-a', 'plugin-b'] }
      await addDefaultPlugins(contentplugin, data, { schemaName: 'config' })
      assert.deepEqual(data._enabledPlugins, ['plugin-a', 'plugin-b'])
    })

    it('should preserve order of existing plugins', async () => {
      const contentplugin = createMockContentplugin([{ name: 'plugin-c' }])
      const data = { _enabledPlugins: ['plugin-b', 'plugin-a'] }
      await addDefaultPlugins(contentplugin, data, { schemaName: 'config' })
      assert.deepEqual(data._enabledPlugins, ['plugin-b', 'plugin-a', 'plugin-c'])
    })

    it('should handle _enabledPlugins as empty array', async () => {
      const contentplugin = createMockContentplugin([{ name: 'plugin-a' }])
      const data = { _enabledPlugins: [] }
      await addDefaultPlugins(contentplugin, data, { schemaName: 'config' })
      assert.deepEqual(data._enabledPlugins, ['plugin-a'])
    })
  })
})
