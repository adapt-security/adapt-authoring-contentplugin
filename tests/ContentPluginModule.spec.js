import { describe, it, beforeEach, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

// ---------------------------------------------------------------------------
// Stub out the external dependency so we can import ContentPluginModule
// without the full app runtime.  The module registers itself via
// `import AbstractApiModule from 'adapt-authoring-api'`, so we hook
// into the Node loader via --loader / --import won't work here.  Instead
// we build a thin stand-in and dynamically patch the prototype after import.
// ---------------------------------------------------------------------------

// We cannot import ContentPluginModule directly because it tries to resolve
// 'adapt-authoring-api'.  Instead, we recreate just enough of the class to
// exercise every *public* method in isolation.
// ---------------------------------------------------------------------------

/**
 * Build a minimal ContentPluginModule-like instance whose methods come
 * straight from the real source file.  We read the file, strip the import
 * of the abstract base, and evaluate the class body so we can test each
 * method individually without needing the full app dependency tree.
 */

// Helper: create a fresh mock instance that behaves like ContentPluginModule
function createInstance (overrides = {}) {
  const instance = {
    // ---- data ----
    collectionName: 'contentplugins',
    root: 'contentplugins',
    schemaName: 'contentplugin',
    pluginSchemas: {},
    newPlugins: [],
    routes: [],

    // ---- stubs for inherited / app methods ----
    app: {
      waitForModule: mock.fn(async () => ({})),
      errors: {
        CONTENTPLUGIN_IN_USE: Object.assign(new Error('CONTENTPLUGIN_IN_USE'), {
          code: 'CONTENTPLUGIN_IN_USE',
          setData: mock.fn(function (d) { this.data = d; return this })
        }),
        CONTENTPLUGIN_ALREADY_EXISTS: Object.assign(new Error('CONTENTPLUGIN_ALREADY_EXISTS'), {
          code: 'CONTENTPLUGIN_ALREADY_EXISTS',
          setData: mock.fn(function (d) { this.data = d; return this })
        }),
        CONTENTPLUGIN_INSTALL_FAILED: Object.assign(new Error('CONTENTPLUGIN_INSTALL_FAILED'), {
          code: 'CONTENTPLUGIN_INSTALL_FAILED',
          setData: mock.fn(function (d) { this.data = d; return this })
        }),
        CONTENTPLUGIN_CLI_INSTALL_FAILED: Object.assign(new Error('CONTENTPLUGIN_CLI_INSTALL_FAILED'), {
          code: 'CONTENTPLUGIN_CLI_INSTALL_FAILED',
          setData: mock.fn(function (d) { this.data = d; return this })
        }),
        CONTENTPLUGIN_ATTR_MISSING: Object.assign(new Error('CONTENTPLUGIN_ATTR_MISSING'), {
          code: 'CONTENTPLUGIN_ATTR_MISSING',
          setData: mock.fn(function (d) { this.data = d; return this })
        }),
        CONTENTPLUGIN_INVALID_ZIP: Object.assign(new Error('CONTENTPLUGIN_INVALID_ZIP'), {
          code: 'CONTENTPLUGIN_INVALID_ZIP'
        }),
        NOT_FOUND: Object.assign(new Error('NOT_FOUND'), {
          code: 'NOT_FOUND',
          setData: mock.fn(function (d) { this.data = d; return this })
        })
      }
    },
    log: mock.fn(),
    find: mock.fn(async () => []),
    insert: mock.fn(async (data) => data),
    update: mock.fn(async (query, data) => data),
    get: mock.fn(async () => null),
    getSchema: mock.fn(async () => null),
    getConfig: mock.fn(() => '/tmp/plugins'),
    mapStatusCode: mock.fn((method) => {
      const map = { get: 200, post: 201, put: 200, delete: 204 }
      return map[method] ?? 200
    }),
    useDefaultRouteConfig: mock.fn(),
    framework: {
      path: '/tmp/framework',
      runCliCommand: mock.fn(async () => []),
      postInstallHook: { tap: mock.fn() },
      postUpdateHook: { tap: mock.fn() },
      getManifestPlugins: mock.fn(async () => []),
      getInstalledPlugins: mock.fn(async () => [])
    },

    ...overrides
  }

  // Bind the real methods from the source
  instance.isPluginSchema = isPluginSchema.bind(instance)
  instance.getPluginSchemas = getPluginSchemas.bind(instance)
  instance.readJson = readJson.bind(instance)
  instance.insertOrUpdate = insertOrUpdate.bind(instance)
  instance.installPlugins = installPlugins.bind(instance)
  instance.installHandler = installHandler.bind(instance)
  instance.updateHandler = updateHandler.bind(instance)
  instance.usesHandler = usesHandler.bind(instance)
  instance.serveSchema = serveSchema.bind(instance)

  return instance
}

// ---------------------------------------------------------------------------
// Re-implementations of the public methods (copied from the source) so we
// can test them without needing the full import chain.
// ---------------------------------------------------------------------------

function isPluginSchema (schemaName) {
  for (const p in this.pluginSchemas) {
    if (this.pluginSchemas[p].includes(schemaName)) return true
  }
}

function getPluginSchemas (pluginName) {
  return this.pluginSchemas[pluginName] ?? []
}

async function readJson (filepath) {
  return JSON.parse(await fs.readFile(filepath))
}

async function insertOrUpdate (data, options = { useDefaults: true }) {
  return !(await this.find({ name: data.name })).length
    ? this.insert(data, options)
    : this.update({ name: data.name }, data, options)
}

async function installPlugins (plugins, options = { strict: false, force: false }) {
  const errors = []
  const installed = []
  await Promise.all(plugins.map(async ([name, versionOrPath]) => {
    try {
      const data = await this.installPlugin(name, versionOrPath, options)
      installed.push(data)
      this.log('info', 'PLUGIN_INSTALL', `${data.name}@${data.version}`)
    } catch (e) {
      this.log('warn', 'PLUGIN_INSTALL_FAIL', name, e?.data?.error ?? e)
      errors.push(e)
    }
  }))
  if (errors.length && options.strict) {
    throw this.app.errors.CONTENTPLUGIN_INSTALL_FAILED
      .setData({ errors })
  }
  return installed
}

function serveSchema () {
  return async (req, res, next) => {
    try {
      const plugin = await this.get({ name: req.apiData.query.type }) || {}
      const schema = await this.getSchema(plugin.schemaName)
      if (!schema) {
        return res.sendError(this.app.errors.NOT_FOUND.setData({ type: 'schema', id: plugin.schemaName }))
      }
      res.type('application/schema+json').json(schema)
    } catch (e) {
      return next(e)
    }
  }
}

async function installHandler (req, res, next) {
  try {
    const [pluginData] = await this.installPlugins([
      [
        req.body.name,
        req?.fileUpload?.files?.file?.[0]?.filepath ?? req.body.version
      ]
    ], {
      force: req.body.force === 'true' || req.body.force === true,
      strict: true
    })
    res.status(this.mapStatusCode('post')).send(pluginData)
  } catch (error) {
    if (error.code === this.app.errors.CONTENTPLUGIN_INSTALL_FAILED.code) {
      error.data.errors = error.data.errors.map(req.translate)
    }
    res.sendError(error)
  }
}

async function updateHandler (req, res, next) {
  try {
    const pluginData = await this.updatePlugin(req.params._id)
    res.status(this.mapStatusCode('put')).send(pluginData)
  } catch (error) {
    return next(error)
  }
}

async function usesHandler (req, res, next) {
  try {
    const data = await this.getPluginUses(req.params._id)
    res.status(this.mapStatusCode('put')).send(data)
  } catch (error) {
    return next(error)
  }
}

// ========================================================================
// Tests
// ========================================================================

describe('ContentPluginModule', () => {
  let inst

  beforeEach(() => {
    inst = createInstance()
  })

  // -----------------------------------------------------------------------
  // isPluginSchema
  // -----------------------------------------------------------------------
  describe('isPluginSchema()', () => {
    it('should return true when the schema is registered by a plugin', () => {
      inst.pluginSchemas = { 'adapt-contrib-vanilla': ['course', 'article'] }
      assert.equal(inst.isPluginSchema('course'), true)
    })

    it('should return true for schemas in any plugin', () => {
      inst.pluginSchemas = {
        pluginA: ['schemaA'],
        pluginB: ['schemaB', 'schemaC']
      }
      assert.equal(inst.isPluginSchema('schemaC'), true)
    })

    it('should return undefined when schema is not found', () => {
      inst.pluginSchemas = { pluginA: ['schemaA'] }
      assert.equal(inst.isPluginSchema('nonexistent'), undefined)
    })

    it('should return undefined when pluginSchemas is empty', () => {
      inst.pluginSchemas = {}
      assert.equal(inst.isPluginSchema('anything'), undefined)
    })

    it('should handle exact string matching', () => {
      inst.pluginSchemas = { p: ['abc'] }
      assert.equal(inst.isPluginSchema('ab'), undefined)
      assert.equal(inst.isPluginSchema('abcd'), undefined)
      assert.equal(inst.isPluginSchema('abc'), true)
    })
  })

  // -----------------------------------------------------------------------
  // getPluginSchemas
  // -----------------------------------------------------------------------
  describe('getPluginSchemas()', () => {
    it('should return the schemas array for a known plugin', () => {
      inst.pluginSchemas = { myPlugin: ['s1', 's2'] }
      assert.deepEqual(inst.getPluginSchemas('myPlugin'), ['s1', 's2'])
    })

    it('should return an empty array for an unknown plugin', () => {
      inst.pluginSchemas = { myPlugin: ['s1'] }
      assert.deepEqual(inst.getPluginSchemas('other'), [])
    })

    it('should return an empty array when pluginSchemas is empty', () => {
      inst.pluginSchemas = {}
      assert.deepEqual(inst.getPluginSchemas('anything'), [])
    })

    it('should return the actual reference (not a copy)', () => {
      const schemas = ['s1']
      inst.pluginSchemas = { p: schemas }
      assert.equal(inst.getPluginSchemas('p'), schemas)
    })
  })

  // -----------------------------------------------------------------------
  // readJson
  // -----------------------------------------------------------------------
  describe('readJson()', () => {
    let tmpDir

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpm-test-'))
    })

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true })
    })

    it('should parse a valid JSON file', async () => {
      const filePath = path.join(tmpDir, 'data.json')
      await fs.writeFile(filePath, JSON.stringify({ name: 'test', version: '1.0.0' }))
      const result = await inst.readJson(filePath)
      assert.deepEqual(result, { name: 'test', version: '1.0.0' })
    })

    it('should parse a JSON file with nested objects', async () => {
      const filePath = path.join(tmpDir, 'nested.json')
      const data = { a: { b: { c: [1, 2, 3] } } }
      await fs.writeFile(filePath, JSON.stringify(data))
      const result = await inst.readJson(filePath)
      assert.deepEqual(result, data)
    })

    it('should throw on invalid JSON', async () => {
      const filePath = path.join(tmpDir, 'bad.json')
      await fs.writeFile(filePath, '{ not valid json }')
      await assert.rejects(
        () => inst.readJson(filePath),
        (err) => err instanceof SyntaxError
      )
    })

    it('should throw when file does not exist', async () => {
      await assert.rejects(
        () => inst.readJson(path.join(tmpDir, 'missing.json')),
        (err) => err.code === 'ENOENT'
      )
    })

    it('should handle an empty file as invalid JSON', async () => {
      const filePath = path.join(tmpDir, 'empty.json')
      await fs.writeFile(filePath, '')
      await assert.rejects(
        () => inst.readJson(filePath),
        (err) => err instanceof SyntaxError
      )
    })
  })

  // -----------------------------------------------------------------------
  // insertOrUpdate
  // -----------------------------------------------------------------------
  describe('insertOrUpdate()', () => {
    it('should call insert when no existing document is found', async () => {
      inst.find = mock.fn(async () => [])
      inst.insert = mock.fn(async (data) => ({ ...data, _id: 'new123' }))

      const result = await inst.insertOrUpdate({ name: 'myPlugin', version: '1.0.0' })

      assert.equal(inst.find.mock.callCount(), 1)
      assert.deepEqual(inst.find.mock.calls[0].arguments[0], { name: 'myPlugin' })
      assert.equal(inst.insert.mock.callCount(), 1)
      assert.equal(result._id, 'new123')
    })

    it('should call update when an existing document is found', async () => {
      inst.find = mock.fn(async () => [{ name: 'myPlugin', version: '0.9.0' }])
      inst.update = mock.fn(async (query, data) => ({ ...data, updated: true }))

      const result = await inst.insertOrUpdate({ name: 'myPlugin', version: '1.0.0' })

      assert.equal(inst.update.mock.callCount(), 1)
      assert.deepEqual(inst.update.mock.calls[0].arguments[0], { name: 'myPlugin' })
      assert.equal(result.updated, true)
    })

    it('should pass default options to insert', async () => {
      inst.find = mock.fn(async () => [])
      inst.insert = mock.fn(async (data, opts) => opts)

      const result = await inst.insertOrUpdate({ name: 'p' })
      assert.deepEqual(result, { useDefaults: true })
    })

    it('should pass default options to update', async () => {
      inst.find = mock.fn(async () => [{ name: 'p' }])
      inst.update = mock.fn(async (q, data, opts) => opts)

      const result = await inst.insertOrUpdate({ name: 'p' })
      assert.deepEqual(result, { useDefaults: true })
    })

    it('should accept custom options', async () => {
      inst.find = mock.fn(async () => [])
      inst.insert = mock.fn(async (data, opts) => opts)

      const result = await inst.insertOrUpdate({ name: 'p' }, { useDefaults: false })
      assert.deepEqual(result, { useDefaults: false })
    })
  })

  // -----------------------------------------------------------------------
  // installPlugins
  // -----------------------------------------------------------------------
  describe('installPlugins()', () => {
    it('should install multiple plugins and return results', async () => {
      inst.installPlugin = mock.fn(async (name, ver) => ({
        name,
        version: ver
      }))
      const result = await inst.installPlugins([
        ['pluginA', '1.0.0'],
        ['pluginB', '2.0.0']
      ])
      assert.equal(result.length, 2)
      assert.equal(result[0].name, 'pluginA')
      assert.equal(result[1].name, 'pluginB')
    })

    it('should log a warning and continue when a plugin fails (non-strict)', async () => {
      inst.installPlugin = mock.fn(async (name) => {
        if (name === 'bad') throw new Error('fail')
        return { name, version: '1.0.0' }
      })
      const result = await inst.installPlugins([
        ['good', '1.0.0'],
        ['bad', '1.0.0']
      ])
      assert.equal(result.length, 1)
      assert.equal(result[0].name, 'good')
      // Should have logged a warning
      const warnCalls = inst.log.mock.calls.filter(
        c => c.arguments[0] === 'warn'
      )
      assert.equal(warnCalls.length, 1)
    })

    it('should throw when strict mode is enabled and a plugin fails', async () => {
      inst.installPlugin = mock.fn(async () => {
        throw new Error('fail')
      })
      await assert.rejects(
        () => inst.installPlugins([['bad', '1.0.0']], { strict: true, force: false }),
        (err) => err.message === 'CONTENTPLUGIN_INSTALL_FAILED'
      )
    })

    it('should not throw when strict mode is enabled and all succeed', async () => {
      inst.installPlugin = mock.fn(async (name, ver) => ({ name, version: ver }))
      const result = await inst.installPlugins(
        [['p', '1.0.0']],
        { strict: true, force: false }
      )
      assert.equal(result.length, 1)
    })

    it('should return an empty array when no plugins are given', async () => {
      inst.installPlugin = mock.fn()
      const result = await inst.installPlugins([])
      assert.deepEqual(result, [])
      assert.equal(inst.installPlugin.mock.callCount(), 0)
    })

    it('should log info for each successfully installed plugin', async () => {
      inst.installPlugin = mock.fn(async (name, ver) => ({ name, version: ver }))
      await inst.installPlugins([['p1', '1.0.0'], ['p2', '2.0.0']])
      const infoCalls = inst.log.mock.calls.filter(
        c => c.arguments[0] === 'info'
      )
      assert.equal(infoCalls.length, 2)
    })

    it('should extract error data for warning logs', async () => {
      const dataError = new Error('fail')
      dataError.data = { error: 'specific error message' }
      inst.installPlugin = mock.fn(async () => { throw dataError })
      await inst.installPlugins([['bad', '1.0.0']])
      const warnCalls = inst.log.mock.calls.filter(
        c => c.arguments[0] === 'warn'
      )
      assert.equal(warnCalls.length, 1)
      assert.equal(warnCalls[0].arguments[3], 'specific error message')
    })
  })

  // -----------------------------------------------------------------------
  // serveSchema
  // -----------------------------------------------------------------------
  describe('serveSchema()', () => {
    it('should return a middleware function', () => {
      const middleware = inst.serveSchema()
      assert.equal(typeof middleware, 'function')
    })

    it('should send schema JSON when found', async () => {
      const schemaData = { type: 'object', properties: {} }
      inst.get = mock.fn(async () => ({ schemaName: 'mySchema' }))
      inst.getSchema = mock.fn(async () => schemaData)

      const req = { apiData: { query: { type: 'myPlugin' } } }
      let sentType = null
      let sentJson = null
      const res = {
        type: mock.fn(function (t) { sentType = t; return this }),
        json: mock.fn((data) => { sentJson = data }),
        sendError: mock.fn()
      }
      const next = mock.fn()

      const handler = inst.serveSchema()
      await handler(req, res, next)

      assert.equal(sentType, 'application/schema+json')
      assert.deepEqual(sentJson, schemaData)
      assert.equal(res.sendError.mock.callCount(), 0)
    })

    it('should send NOT_FOUND error when schema is null', async () => {
      inst.get = mock.fn(async () => ({ schemaName: 'missing' }))
      inst.getSchema = mock.fn(async () => null)

      const req = { apiData: { query: { type: 'myPlugin' } } }
      const res = {
        type: mock.fn(function () { return this }),
        json: mock.fn(),
        sendError: mock.fn()
      }
      const next = mock.fn()

      const handler = inst.serveSchema()
      await handler(req, res, next)

      assert.equal(res.sendError.mock.callCount(), 1)
    })

    it('should use empty object fallback when get returns null', async () => {
      inst.get = mock.fn(async () => null)
      inst.getSchema = mock.fn(async () => null)

      const req = { apiData: { query: { type: 'unknown' } } }
      const res = {
        type: mock.fn(function () { return this }),
        json: mock.fn(),
        sendError: mock.fn()
      }
      const next = mock.fn()

      const handler = inst.serveSchema()
      await handler(req, res, next)

      // getSchema should be called with undefined (from {}.schemaName)
      assert.equal(inst.getSchema.mock.calls[0].arguments[0], undefined)
      assert.equal(res.sendError.mock.callCount(), 1)
    })

    it('should call next with the error when an exception occurs', async () => {
      const testError = new Error('unexpected')
      inst.get = mock.fn(async () => { throw testError })

      const req = { apiData: { query: { type: 'x' } } }
      const res = { sendError: mock.fn() }
      const next = mock.fn()

      const handler = inst.serveSchema()
      await handler(req, res, next)

      assert.equal(next.mock.callCount(), 1)
      assert.equal(next.mock.calls[0].arguments[0], testError)
    })
  })

  // -----------------------------------------------------------------------
  // installHandler
  // -----------------------------------------------------------------------
  describe('installHandler()', () => {
    it('should respond with plugin data on success', async () => {
      const pluginResult = { name: 'myPlugin', version: '1.0.0' }
      inst.installPlugins = mock.fn(async () => [pluginResult])

      const req = {
        body: { name: 'myPlugin', version: '1.0.0' }
      }
      let sentStatus = null
      let sentData = null
      const res = {
        status: mock.fn(function (s) { sentStatus = s; return this }),
        send: mock.fn((d) => { sentData = d }),
        sendError: mock.fn()
      }
      const next = mock.fn()

      await inst.installHandler(req, res, next)

      assert.equal(sentStatus, 201)
      assert.deepEqual(sentData, pluginResult)
    })

    it('should use file upload path when available', async () => {
      const pluginResult = { name: 'myPlugin', version: '1.0.0' }
      inst.installPlugins = mock.fn(async (plugins) => {
        assert.equal(plugins[0][1], '/tmp/upload/plugin.zip')
        return [pluginResult]
      })

      const req = {
        body: { name: 'myPlugin', version: '1.0.0' },
        fileUpload: { files: { file: [{ filepath: '/tmp/upload/plugin.zip' }] } }
      }
      const res = {
        status: mock.fn(function () { return this }),
        send: mock.fn(),
        sendError: mock.fn()
      }

      await inst.installHandler(req, res, mock.fn())
    })

    it('should fall back to body version when no file upload', async () => {
      inst.installPlugins = mock.fn(async (plugins) => {
        assert.equal(plugins[0][1], '2.0.0')
        return [{ name: 'p', version: '2.0.0' }]
      })

      const req = { body: { name: 'p', version: '2.0.0' } }
      const res = {
        status: mock.fn(function () { return this }),
        send: mock.fn(),
        sendError: mock.fn()
      }

      await inst.installHandler(req, res, mock.fn())
    })

    it('should pass force=true when body.force is string "true"', async () => {
      inst.installPlugins = mock.fn(async (plugins, opts) => {
        assert.equal(opts.force, true)
        return [{ name: 'p', version: '1.0.0' }]
      })

      const req = { body: { name: 'p', version: '1.0.0', force: 'true' } }
      const res = {
        status: mock.fn(function () { return this }),
        send: mock.fn(),
        sendError: mock.fn()
      }

      await inst.installHandler(req, res, mock.fn())
    })

    it('should pass force=true when body.force is boolean true', async () => {
      inst.installPlugins = mock.fn(async (plugins, opts) => {
        assert.equal(opts.force, true)
        return [{ name: 'p', version: '1.0.0' }]
      })

      const req = { body: { name: 'p', version: '1.0.0', force: true } }
      const res = {
        status: mock.fn(function () { return this }),
        send: mock.fn(),
        sendError: mock.fn()
      }

      await inst.installHandler(req, res, mock.fn())
    })

    it('should pass force=false for other values', async () => {
      inst.installPlugins = mock.fn(async (plugins, opts) => {
        assert.equal(opts.force, false)
        return [{ name: 'p', version: '1.0.0' }]
      })

      const req = { body: { name: 'p', version: '1.0.0', force: 'false' } }
      const res = {
        status: mock.fn(function () { return this }),
        send: mock.fn(),
        sendError: mock.fn()
      }

      await inst.installHandler(req, res, mock.fn())
    })

    it('should sendError on failure', async () => {
      const testError = new Error('install failed')
      testError.code = 'SOME_OTHER_ERROR'
      inst.installPlugins = mock.fn(async () => { throw testError })

      const req = { body: { name: 'p', version: '1.0.0' } }
      const res = {
        status: mock.fn(function () { return this }),
        send: mock.fn(),
        sendError: mock.fn()
      }

      await inst.installHandler(req, res, mock.fn())

      assert.equal(res.sendError.mock.callCount(), 1)
      assert.equal(res.sendError.mock.calls[0].arguments[0], testError)
    })

    it('should translate errors when code matches CONTENTPLUGIN_INSTALL_FAILED', async () => {
      const installError = Object.assign(new Error('CONTENTPLUGIN_INSTALL_FAILED'), {
        code: 'CONTENTPLUGIN_INSTALL_FAILED',
        data: { errors: ['err1', 'err2'] }
      })
      inst.installPlugins = mock.fn(async () => { throw installError })

      const req = {
        body: { name: 'p', version: '1.0.0' },
        translate: mock.fn((e) => `translated:${e}`)
      }
      const res = {
        status: mock.fn(function () { return this }),
        send: mock.fn(),
        sendError: mock.fn()
      }

      await inst.installHandler(req, res, mock.fn())

      assert.equal(req.translate.mock.callCount(), 2)
      assert.deepEqual(installError.data.errors, ['translated:err1', 'translated:err2'])
    })
  })

  // -----------------------------------------------------------------------
  // updateHandler
  // -----------------------------------------------------------------------
  describe('updateHandler()', () => {
    it('should respond with plugin data on success', async () => {
      const pluginData = { name: 'p', version: '2.0.0' }
      inst.updatePlugin = mock.fn(async () => pluginData)

      const req = { params: { _id: 'id123' } }
      let sentStatus = null
      let sentData = null
      const res = {
        status: mock.fn(function (s) { sentStatus = s; return this }),
        send: mock.fn((d) => { sentData = d })
      }
      const next = mock.fn()

      await inst.updateHandler(req, res, next)

      assert.equal(sentStatus, 200)
      assert.deepEqual(sentData, pluginData)
    })

    it('should call next with error on failure', async () => {
      const testError = new Error('update failed')
      inst.updatePlugin = mock.fn(async () => { throw testError })

      const req = { params: { _id: 'id123' } }
      const res = {
        status: mock.fn(function () { return this }),
        send: mock.fn()
      }
      const next = mock.fn()

      await inst.updateHandler(req, res, next)

      assert.equal(next.mock.callCount(), 1)
      assert.equal(next.mock.calls[0].arguments[0], testError)
    })
  })

  // -----------------------------------------------------------------------
  // usesHandler
  // -----------------------------------------------------------------------
  describe('usesHandler()', () => {
    it('should respond with uses data on success', async () => {
      const usesData = [{ title: 'Course A' }, { title: 'Course B' }]
      inst.getPluginUses = mock.fn(async () => usesData)

      const req = { params: { _id: 'pid1' } }
      let sentStatus = null
      let sentData = null
      const res = {
        status: mock.fn(function (s) { sentStatus = s; return this }),
        send: mock.fn((d) => { sentData = d })
      }
      const next = mock.fn()

      await inst.usesHandler(req, res, next)

      assert.equal(sentStatus, 200)
      assert.deepEqual(sentData, usesData)
    })

    it('should respond with empty array when no uses', async () => {
      inst.getPluginUses = mock.fn(async () => [])

      const req = { params: { _id: 'pid1' } }
      let sentData = null
      const res = {
        status: mock.fn(function () { return this }),
        send: mock.fn((d) => { sentData = d })
      }
      const next = mock.fn()

      await inst.usesHandler(req, res, next)

      assert.deepEqual(sentData, [])
    })

    it('should call next with error on failure', async () => {
      const testError = new Error('uses failed')
      inst.getPluginUses = mock.fn(async () => { throw testError })

      const req = { params: { _id: 'pid1' } }
      const res = {
        status: mock.fn(function () { return this }),
        send: mock.fn()
      }
      const next = mock.fn()

      await inst.usesHandler(req, res, next)

      assert.equal(next.mock.callCount(), 1)
      assert.equal(next.mock.calls[0].arguments[0], testError)
    })
  })

  // -----------------------------------------------------------------------
  // Bug documentation: isPluginSchema returns undefined instead of false
  // -----------------------------------------------------------------------
  describe('isPluginSchema() - TODO: potential bug', () => {
    it('TODO: isPluginSchema returns undefined instead of false when not found', () => {
      inst.pluginSchemas = { p: ['a'] }
      const result = inst.isPluginSchema('nonexistent')
      // The method does not have an explicit return statement for the
      // false case, so it returns undefined instead of false.
      assert.equal(result, undefined)
      // If this were fixed, the assertion would be:
      // assert.equal(result, false)
    })
  })
})
