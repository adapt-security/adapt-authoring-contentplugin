import AbstractApiModule from 'adapt-authoring-api'
import apidefs from './apidefs.js'
import fs from 'fs/promises'
import { glob } from 'glob'
import path from 'path'
import semver from 'semver'
/**
 * Abstract module which handles framework plugins
 * @memberof contentplugin
 * @extends {AbstractApiModule}
 */
class ContentPluginModule extends AbstractApiModule {
  /** @override */
  async setValues () {
    /** @ignore */ this.collectionName = 'contentplugins'
    /** @ignore */ this.root = 'contentplugins'
    /** @ignore */ this.schemaName = 'contentplugin'
    /**
     * Reference to all content plugin schemas, grouped by plugin
     * @type {Object}
     */
    this.pluginSchemas = {}
    /**
     * A list of newly installed plugins
     * @type {Array}
     */
    this.newPlugins = []

    const middleware = await this.app.waitForModule('middleware')

    this.useDefaultRouteConfig()
    // remove unnecessary routes
    delete this.routes.find(r => r.route === '/').handlers.post
    delete this.routes.find(r => r.route === '/:_id').handlers.put
    // extra routes
    this.routes.push({
      route: '/install',
      handlers: {
        post: [
          middleware.fileUploadParser(middleware.zipTypes, { unzip: true }),
          this.installHandler.bind(this)
        ]
      },
      permissions: { post: ['install:contentplugin'] },
      validate: false,
      meta: apidefs.install
    },
    {
      route: '/:_id/update',
      handlers: { post: this.updateHandler.bind(this) },
      permissions: { post: ['update:contentplugin'] },
      meta: apidefs.update
    },
    {
      route: '/:_id/uses',
      handlers: { get: this.usesHandler.bind(this) },
      permissions: { get: ['read:contentplugin'] },
      meta: apidefs.uses
    })
  }

  /** @override */
  async init () {
    await super.init()
    // env var used by the CLI
    if (!process.env.ADAPT_ALLOW_PRERELEASE) {
      process.env.ADAPT_ALLOW_PRERELEASE = 'true'
    }
    const [framework, mongodb] = await this.app.waitForModule('adaptframework', 'mongodb')

    await mongodb.setIndex(this.collectionName, 'name', { unique: true })
    await mongodb.setIndex(this.collectionName, 'displayName', { unique: true })
    await mongodb.setIndex(this.collectionName, 'type')
    /**
     * Cached module instance for easy access
     * @type {AdaptFrameworkModule}
     */
    this.framework = framework

    try {
      await this.initPlugins()
    } catch (e) {
      this.log('error', e)
    }
    this.framework.postInstallHook.tap(this.syncPluginData.bind(this))
    this.framework.postUpdateHook.tap(this.syncPluginData.bind(this))
  }

  /** @override */
  async find (query = {}, options = {}, mongoOptions = {}) {
    const includeUpdateInfo = options.includeUpdateInfo === true || options.includeUpdateInfo === 'true'
    // special option that's passed via query
    delete query.includeUpdateInfo
    const results = await super.find(query, options, mongoOptions)
    if (includeUpdateInfo) {
      const updateInfo = await this.framework.runCliCommand('getPluginUpdateInfos', { plugins: results.map(r => r.name) })
      results.forEach(r => {
        const info = updateInfo.find(i => i.name === r.name)
        if (info) {
          r.canBeUpdated = info.canBeUpdated
          r.latestCompatibleVersion = info.latestCompatibleSourceVersion
          r._cliData = info
        }
      })
    }
    return results
  }

  async readJson(filepath) {
    return JSON.parse(await fs.readFile(filepath))
  }

  /**
   * Inserts a new document or performs an update if matching data already exists
   * @param {Object} data Data to be sent to the DB
   * @param {Object} options Options to pass to the DB function
   * @returns {Promise} Resolves with the returned data
   */
  async insertOrUpdate (data, options = { useDefaults: true }) {
    return !(await this.find({ name: data.name })).length
      ? this.insert(data, options)
      : this.update({ name: data.name }, data, options)
  }

  /** @override */
  async delete (query, options, mongoOptions) {
    const _id = query._id
    const courses = await this.getPluginUses(_id)
    if (courses.length) {
      throw this.app.errors.CONTENTPLUGIN_IN_USE.setData({ courses })
    }
    const [pluginData] = await this.find({ _id })
    // unregister any schemas
    const jsonschema = await this.app.waitForModule('jsonschema')
    const schemaPaths = await glob(`src/*/${pluginData.name}/schema/*.schema.json`, { cwd: this.framework.path, absolute: true })
    schemaPaths.forEach(s => jsonschema.deregisterSchema(s))

    await this.framework.runCliCommand('uninstallPlugins', { plugins: [pluginData.name] })
    this.log('info', `successfully removed plugin ${pluginData.name}`)
    return super.delete(query, options, mongoOptions)
  }

  /**
   * Initialises all framework plugins, from adapt.json and local cache
   * @return {Promise}
   */
  async initPlugins () {
    await this.syncPluginData()

    const missing = await this.getMissingPlugins()
    if (missing.length) { // note we're using CLI directly, as plugins already exist in the DB
      this.log('debug', 'MISSING', missing)
      await this.framework.runCliCommand('installPlugins', { plugins: missing })
    }
    await this.processPluginSchemas()
  }

  /**
   * Makes sure the database plugin data is in sync with the currently installed framework plugins
   */
  async syncPluginData() {
    const dbInfo = (await this.find()).reduce((memo, info) => Object.assign(memo, { [info.name]: info }), {})
    for (const i of await this.framework.runCliCommand('getPluginUpdateInfos')) {
      if(dbInfo[i.name]?.version !== i.matchedVersion) {
        this.log('debug', 'SYNC', i.name, 'local:', dbInfo[i.name]?.version, 'fw:', i.matchedVersion)
        await this.insertOrUpdate({ ...(await i.getInfo()), type: await i.getType(), isLocalInstall: i.isLocalSource })
      }
    }
  }

  /**
   * Returns a list of plugins defined in the database but not installed in the framework
   * @return {Array} List of plugin names mapped to version/dir
   */
  async getMissingPlugins() {
    const dbPlugins = await this.find()
    const fwPlugins = await this.framework.getInstalledPlugins()
    return dbPlugins
      .filter(dbP => !fwPlugins.find(fwP => dbP.name === fwP.name))
      .map(p => `${p.name}@${p.isLocalInstall ? path.join(this.getConfig('pluginDir'), p.name) : p.version}`)
  }

  /**
   * Loads and processes all installed content plugin schemas
   * @param {Array} pluginInfo Plugin info data
   * @return {Promise}
   */
  async processPluginSchemas (pluginInfo) {
    if (!pluginInfo) {
      pluginInfo = await this.framework.runCliCommand('getPluginUpdateInfos')
    }
    const jsonschema = await this.app.waitForModule('jsonschema')
    return Promise.all(pluginInfo.map(async plugin => {
      const name = plugin.name
      const oldSchemaPaths = this.pluginSchemas[name]
      if (oldSchemaPaths) {
        Object.values(oldSchemaPaths).forEach(s => jsonschema.deregisterSchema(s))
        delete this.pluginSchemas[name]
      }
      const schemaPaths = await plugin.getSchemaPaths()
      return Promise.all(schemaPaths.map(async schemaPath => {
        const schema = await this.readJson(schemaPath)
        const source = schema?.$patch?.source?.$ref
        if (source) {
          if (!this.pluginSchemas[name]) this.pluginSchemas[name] = []
          if (this.pluginSchemas[name].includes(schema.$anchor)) jsonschema.deregisterSchema(this.pluginSchemas[name][source])
          this.pluginSchemas[name].push(schema.$anchor)
        }
        return jsonschema.registerSchema(schemaPath, { replace: true })
      }))
    }))
  }

  /**
   * Returns whether a schema is registered by a plugin
   * @param {String} schemaName Name of the schema to check
   * @return {Boolean}
   */
  isPluginSchema (schemaName) {
    for (const p in this.pluginSchemas) {
      if (this.pluginSchemas[p].includes(schemaName)) return true
    }
  }

  /**
   * Returns all schemas registered by a plugin
   * @param {String} pluginName Plugin name
   * @return {Array} List of the plugin's registered schemas
   */
  getPluginSchemas (pluginName) {
    return this.pluginSchemas[pluginName] ?? []
  }

  /**
   * Retrieves the courses in which a plugin is used
   * @param {String} pluginId Plugin _id
   * @returns {Promise} Resolves with an array of course data
   */
  async getPluginUses (pluginId) {
    const [{ name }] = await this.find({ _id: pluginId })
    const [content, db] = await this.app.waitForModule('content', 'mongodb')
    return (db.getCollection(content.collectionName).aggregate([
      { $match: { _type: 'config', _enabledPlugins: name } },
      { $lookup: { from: 'content', localField: '_courseId', foreignField: '_id', as: 'course' } },
      { $unwind: '$course' },
      { $replaceRoot: { newRoot: '$course' } },
      { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: 'createdBy' } },
      { $project: { title: 1, createdBy: { $map: { input: '$createdBy', as: 'user', in: '$$user.email' } } } },
      { $unwind: '$createdBy' }
    ])).toArray()
  }

  /**
   * Installs new plugins
   * @param {Array[]} plugins 2D array of strings in the format [pluginName, versionOrPath]
   * @param {Object} options
   * @param {Boolean} options.force Whether the plugin should be 'force' installed if version is lower than the existing
   * @param {Boolean} options.strict Whether the function should fail on error
   */
  async installPlugins (plugins, options = { strict: false, force: false }) {
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

  /**
   * Installs a single plugin. Note: this function is called by installPlugins and should not be called directly.
   * @param {String} pluginName Name of the plugin to install
   * @param {String} versionOrPath The semver-formatted version, or the path to the plugin source
   * @param {Object} options
   * @param {Boolean} options.force Whether the plugin should be 'force' installed if version is lower than the existing
   * @param {Boolean} options.strict Whether the function should fail on error
   * @returns Resolves with plugin DB data
   */
  async installPlugin (pluginName, versionOrPath, options = { strict: false, force: false }) {
    const [pluginData] = await this.find({ name: String(pluginName) }, { includeUpdateInfo: true })
    const { name, version, sourcePath, isLocalInstall } = await this.processPluginFiles({ ...pluginData, sourcePath: versionOrPath })
    const [ existingPlugin ] = await this.find({ name })

    if (existingPlugin) {
      if (!options.force && semver.lte(version, existingPlugin.version)) {
        throw this.app.errors.CONTENTPLUGIN_ALREADY_EXISTS
          .setData({ name: existingPlugin.name, version: existingPlugin.version })
      }
      fs.rm
    }
    const [data] = await this.framework.runCliCommand('installPlugins', { plugins: [`${name}@${sourcePath ?? version}`] })
    const info = await this.insertOrUpdate({
      ...(await data.getInfo()),
      type: await data.getType(),
      isLocalInstall
    })
    if (!data.isInstallSuccessful) {
      throw this.app.errors.CONTENTPLUGIN_CLI_INSTALL_FAILED
        .setData({ name })
    }
    if (!info.targetAttribute) {
      throw this.app.errors.CONTENTPLUGIN_ATTR_MISSING
        .setData({ name })
    }
    await this.processPluginSchemas([data])
    return info
  }

  /**
   * Ensures local plugin source files are stored in the correct location and structured in an expected way
   * @param {Object} pluginData Plugin metadata
   * @param {String} sourcePath The path to the plugin source files
   * @returns Resolves with package data
   */
  async processPluginFiles (pluginData) {
    let sourcePath = pluginData.sourcePath
    if (sourcePath === path.basename(sourcePath)) { // no local files
      return { name: pluginData.name, version: sourcePath, isLocalInstall: false }
    }
    const contents = await fs.readdir(sourcePath)
    if (contents.length === 1) { // deal with a nested root folder
      sourcePath = path.join(pluginData.sourcePath, contents[0])
    }
    let pkg
    try { // load package data, with fall-back to bower
      try {
        pkg = await this.readJson(path.join(sourcePath, 'package.json'))
      } catch (e) {
        pkg = await this.readJson(path.join(sourcePath, 'bower.json'))
      }
      pkg.sourcePath = path.join(this.getConfig('pluginDir'), pkg.name)
      pkg.isLocalInstall = true
    } catch (e) {
      throw this.app.errors.CONTENTPLUGIN_INVALID_ZIP
    }
    // move the files into the persistent location
    await fs.cp(sourcePath, pkg.sourcePath, { recursive: true })
    await fs.rm(sourcePath, { recursive: true })
    return pkg
  }

  /**
   * Updates a single plugin
   * @param {String} _id The _id for the plugin to update
   * @return Resolves with update data
   */
  async updatePlugin (_id) {
    const [{ name }] = await this.find({ _id })
    const [pluginData] = await this.framework.runCliCommand({ plugins: [name] })
    const p = await this.update({ name }, pluginData._sourceInfo)
    this.log('info', `successfully updated plugin ${p.name}@${p.version}`)
    return p
  }

  /** @override */
  serveSchema () {
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

  /**
   * Express request handler for installing a plugin (also used for updating via zip upload).
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {Function} next
   */
  async installHandler (req, res, next) {
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

  /**
   * Express request handler for updating a plugin
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {Function} next
   */
  async updateHandler (req, res, next) {
    try {
      const pluginData = await this.updatePlugin(req.params._id)
      res.status(this.mapStatusCode('put')).send(pluginData)
    } catch (error) {
      return next(error)
    }
  }

  /**
   * Express request handler for retrieving uses of a single plugin
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {Function} next
   */
  async usesHandler (req, res, next) {
    try {
      const data = await this.getPluginUses(req.params._id)
      res.status(this.mapStatusCode('put')).send(data)
    } catch (error) {
      return next(error)
    }
  }
}

export default ContentPluginModule
