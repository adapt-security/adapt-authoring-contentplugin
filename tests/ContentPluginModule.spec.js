import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import ContentPluginModule from '../lib/ContentPluginModule.js'

describe('ContentPluginModule.installPlugin()', () => {
  it('should install git URLs directly and persist gitUrl', async () => {
    const runCliCommand = mock.fn(async () => [{
      isInstallSuccessful: true,
      getInfo: async () => ({ name: 'adapt-hotgrid', version: '2.0.0', targetAttribute: '_component' }),
      getType: async () => 'component'
    }])
    const insertOrUpdate = mock.fn(async (data) => data)
    const processPluginFiles = mock.fn(async () => {
      throw new Error('processPluginFiles should not be called for git installs')
    })
    const context = {
      framework: { runCliCommand },
      processPluginFiles,
      insertOrUpdate,
      findOne: mock.fn(async () => ({ name: 'adapt-hotgrid', version: '999.0.0' })),
      processPluginSchemas: mock.fn(async () => {}),
      app: {
        errors: {
          CONTENTPLUGIN_ALREADY_EXISTS: { setData: (data) => Object.assign(new Error('already exists'), { data }) },
          CONTENTPLUGIN_CLI_INSTALL_FAILED: { setData: (data) => Object.assign(new Error('cli failed'), { data }) },
          CONTENTPLUGIN_ATTR_MISSING: { setData: (data) => Object.assign(new Error('attr missing'), { data }) }
        }
      }
    }

    const result = await ContentPluginModule.prototype.installPlugin.call(
      context,
      '',
      'https://github.com/org/adapt-hotgrid.git#v2.0.0',
      { force: false }
    )

    assert.equal(runCliCommand.mock.calls[0].arguments[0], 'installPlugins')
    assert.deepEqual(runCliCommand.mock.calls[0].arguments[1], {
      plugins: ['https://github.com/org/adapt-hotgrid.git#v2.0.0']
    })
    assert.equal(processPluginFiles.mock.callCount(), 0)
    assert.equal(insertOrUpdate.mock.calls[0].arguments[0].gitUrl, 'https://github.com/org/adapt-hotgrid.git')
    assert.equal(result.name, 'adapt-hotgrid')
  })
})

describe('ContentPluginModule.getMissingPlugins()', () => {
  it('should return gitUrl for missing git-installed plugins', async () => {
    const context = {
      find: async () => ([
        { name: 'adapt-hotgrid', version: '2.0.0', isLocalInstall: false, gitUrl: 'https://github.com/org/adapt-hotgrid.git' },
        { name: 'adapt-text', version: '1.0.0', isLocalInstall: false }
      ]),
      framework: {
        getManifestPlugins: async () => [],
        getInstalledPlugins: async () => []
      }
    }
    const result = await ContentPluginModule.prototype.getMissingPlugins.call(context)
    assert.deepEqual(result, [
      'https://github.com/org/adapt-hotgrid.git',
      'adapt-text@1.0.0'
    ])
  })
})

describe('ContentPluginModule.syncPluginData()', () => {
  it('should persist gitUrl for git sources', async () => {
    const insertOrUpdate = mock.fn(async () => {})
    const context = {
      log: mock.fn(),
      find: async () => [],
      insertOrUpdate,
      framework: {
        runCliCommand: async () => ([
          {
            name: 'adapt-hotgrid',
            matchedVersion: '2.0.0',
            isLocalSource: false,
            isGitSource: true,
            gitUrl: 'https://github.com/org/adapt-hotgrid.git',
            getInfo: async () => ({ name: 'adapt-hotgrid', version: '2.0.0' }),
            getType: async () => 'component'
          }
        ])
      }
    }

    await ContentPluginModule.prototype.syncPluginData.call(context)

    assert.equal(insertOrUpdate.mock.calls[0].arguments[0].gitUrl, 'https://github.com/org/adapt-hotgrid.git')
  })
})
