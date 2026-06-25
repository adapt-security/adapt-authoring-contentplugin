import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import ContentPluginModule from '../lib/ContentPluginModule.js'

describe('ContentPluginModule.installPlugin()', () => {
  it('should install git URLs directly and persist gitUrl/gitRef', async () => {
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
    assert.equal(context.findOne.mock.callCount(), 0)
    assert.equal(processPluginFiles.mock.callCount(), 0)
    assert.equal(insertOrUpdate.mock.calls[0].arguments[0].gitUrl, 'https://github.com/org/adapt-hotgrid.git')
    assert.equal(insertOrUpdate.mock.calls[0].arguments[0].gitRef, 'v2.0.0')
    assert.equal(result.name, 'adapt-hotgrid')
  })

  it('should throw install failure with CLI plugin name and not persist failed install', async () => {
    const runCliCommand = mock.fn(async () => [{
      name: 'adapt-hotgrid',
      isInstallSuccessful: false
    }])
    const insertOrUpdate = mock.fn(async (data) => data)
    const context = {
      framework: { runCliCommand },
      insertOrUpdate,
      processPluginSchemas: mock.fn(async () => {}),
      app: {
        errors: {
          CONTENTPLUGIN_CLI_INSTALL_FAILED: { setData: (data) => Object.assign(new Error('cli failed'), { data }) },
          CONTENTPLUGIN_ATTR_MISSING: { setData: (data) => Object.assign(new Error('attr missing'), { data }) }
        }
      }
    }

    await assert.rejects(
      ContentPluginModule.prototype.installPlugin.call(context, '', 'https://github.com/org/adapt-hotgrid.git#v2.0.0'),
      e => {
        assert.equal(e.message, 'cli failed')
        assert.equal(e.data.name, 'adapt-hotgrid')
        return true
      }
    )
    assert.equal(insertOrUpdate.mock.callCount(), 0)
  })

  it('should throw missing attr with resolved plugin name', async () => {
    const runCliCommand = mock.fn(async () => [{
      name: 'adapt-hotgrid',
      isInstallSuccessful: true,
      getInfo: async () => ({ name: 'adapt-hotgrid', version: '2.0.0' }),
      getType: async () => 'component'
    }])
    const insertOrUpdate = mock.fn(async (data) => data)
    const context = {
      framework: { runCliCommand },
      insertOrUpdate,
      processPluginSchemas: mock.fn(async () => {}),
      app: {
        errors: {
          CONTENTPLUGIN_CLI_INSTALL_FAILED: { setData: (data) => Object.assign(new Error('cli failed'), { data }) },
          CONTENTPLUGIN_ATTR_MISSING: { setData: (data) => Object.assign(new Error('attr missing'), { data }) }
        }
      }
    }

    await assert.rejects(
      ContentPluginModule.prototype.installPlugin.call(context, '', 'https://github.com/org/adapt-hotgrid.git#v2.0.0'),
      e => {
        assert.equal(e.message, 'attr missing')
        assert.equal(e.data.name, 'adapt-hotgrid')
        return true
      }
    )
    assert.equal(insertOrUpdate.mock.callCount(), 0)
  })

  it('should omit gitRef when the git URL has no ref', async () => {
    const runCliCommand = mock.fn(async () => [{
      isInstallSuccessful: true,
      getInfo: async () => ({ name: 'adapt-hotgrid', version: '2.0.0', targetAttribute: '_component' }),
      getType: async () => 'component'
    }])
    const insertOrUpdate = mock.fn(async (data) => data)
    const context = {
      framework: { runCliCommand },
      insertOrUpdate,
      processPluginSchemas: mock.fn(async () => {}),
      app: {
        errors: {
          CONTENTPLUGIN_CLI_INSTALL_FAILED: { setData: (data) => Object.assign(new Error('cli failed'), { data }) },
          CONTENTPLUGIN_ATTR_MISSING: { setData: (data) => Object.assign(new Error('attr missing'), { data }) }
        }
      }
    }

    const result = await ContentPluginModule.prototype.installPlugin.call(
      context,
      '',
      'https://github.com/org/adapt-hotgrid.git',
      { force: false }
    )

    const persisted = insertOrUpdate.mock.calls[0].arguments[0]
    assert.equal(persisted.gitUrl, 'https://github.com/org/adapt-hotgrid.git')
    assert.equal('gitRef' in persisted, false)
    assert.equal(result.name, 'adapt-hotgrid')
  })
})

describe('ContentPluginModule.getMissingPlugins()', () => {
  it('should return gitUrl and gitRef for missing git-installed plugins', async () => {
    const context = {
      find: async () => ([
        {
          name: 'adapt-hotgrid',
          version: '2.0.0',
          isLocalInstall: false,
          gitUrl: 'https://github.com/org/adapt-hotgrid.git',
          gitRef: 'v2.0.0'
        },
        { name: 'adapt-text', version: '1.0.0', isLocalInstall: false }
      ]),
      framework: {
        getManifestPlugins: async () => [],
        getInstalledPlugins: async () => []
      }
    }
    const result = await ContentPluginModule.prototype.getMissingPlugins.call(context)
    assert.deepEqual(result, [
      'https://github.com/org/adapt-hotgrid.git#v2.0.0',
      'adapt-text@1.0.0'
    ])
  })
})

describe('ContentPluginModule.syncPluginData()', () => {
  it('should persist gitUrl and gitRef for git sources', async () => {
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
            gitRef: 'v2.0.0',
            getInfo: async () => ({ name: 'adapt-hotgrid', version: '2.0.0' }),
            getType: async () => 'component'
          }
        ])
      }
    }

    await ContentPluginModule.prototype.syncPluginData.call(context)

    assert.equal(insertOrUpdate.mock.calls[0].arguments[0].gitUrl, 'https://github.com/org/adapt-hotgrid.git')
    assert.equal(insertOrUpdate.mock.calls[0].arguments[0].gitRef, 'v2.0.0')
  })

  it('should omit gitRef for git sources without a ref', async () => {
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

    const persisted = insertOrUpdate.mock.calls[0].arguments[0]
    assert.equal(persisted.gitUrl, 'https://github.com/org/adapt-hotgrid.git')
    assert.equal('gitRef' in persisted, false)
  })
})
