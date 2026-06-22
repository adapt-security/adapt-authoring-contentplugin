# Content plugins

`adapt-authoring-contentplugin` manages the **Adapt framework plugins** that ship
inside built courses: components, extensions, menus and themes. These are the
packages the Adapt framework installs and bundles at build time — *not* the
authoring tool's front-end "UI plugins" (those live in a module's `ui/plugin.js`;
content plugins are Adapt framework packages installed into the framework copy on
disk).

The module extends `AbstractApiModule`, so it inherits standard REST CRUD plus the
access/hook machinery, and layers on framework install/update/uninstall, schema
registration and on-disk backups.

Source: `lib/ContentPluginModule.js`, `lib/utils/*`.

## The model

Each installed plugin is one document in the `contentplugins` collection
(`schemaName = 'contentplugin'`, root `contentplugins`). Schema:
`schema/contentplugin.schema.json`.

| Field | Notes |
| --- | --- |
| `name` | Unique plugin name, e.g. `adapt-contrib-text` (unique index) |
| `displayName` | User-friendly name (unique index) |
| `version` | Installed semver |
| `framework` | Compatible framework version range |
| `type` | Plugin type, e.g. `component` / `extension` / `menu` / `theme` (indexed) |
| `targetAttribute` | The content attribute the plugin binds to (required at install — see `CONTENTPLUGIN_ATTR_MISSING`) |
| `isLocalInstall` | `true` when installed from an uploaded zip rather than the registry |
| `isEnabled` | Default `true` |
| `isAddedByDefault` | If `true`, auto-added to every new course's `_enabledPlugins` |
| `pluginDependencies` | Plugin-to-version map |
| `canBeUpdated`, `latestCompatibleVersion` | Read-only; populated on demand (see below) |

`required`: `framework`, `name`, `type`, `version`, `isLocalInstall`.

## Where plugins come from

Two sources, distinguished by `isLocalInstall`:

- **Registry / source string** — `versionOrPath` is a bare version or name
  (no directory component), resolved by `adapt-cli` from the Adapt plugin
  registry. `processPluginFiles` returns `isLocalInstall: false`.
- **Local zip upload** — `versionOrPath` is a filesystem path to an unzipped
  upload. `processPluginFiles` reads `package.json` (falling back to
  `bower.json`), copies the files into the persistent `pluginDir`, and marks
  `isLocalInstall: true`. A zip with neither manifest throws
  `CONTENTPLUGIN_INVALID_ZIP`.

The actual framework install/uninstall/update is always delegated to `adapt-cli`
via `this.framework.runCliCommand(...)` (`installPlugins`, `uninstallPlugins`,
`updatePlugins`, `getPluginUpdateInfos`). `init()` forces
`ADAPT_ALLOW_PRERELEASE=true` for the CLI if unset.

## Storage & versioning

- Registry installs live inside the framework copy (managed by the CLI).
- Local installs are copied into `pluginDir` (config `pluginDir`, default
  `$DATA/contentplugins`).
- Before a local install overwrites an existing plugin dir, the old one is
  renamed to `<pluginPath>-v<version>` (`backupPluginVersion`). Only the single
  most-recent backup is kept (`cleanupOldPluginBackups`); `getMostRecentBackup`
  sorts `<name>-v*` dirs by semver.
- DB version is kept in step with the framework copy by `syncPluginData`, which
  is run on init and tapped into the framework's `postInstallHook` /
  `postUpdateHook`. If a plugin recorded in the DB is missing from disk on boot,
  `getMissingPlugins` re-installs it (from registry, or from the most recent
  on-disk backup for local installs).

## Schemas

Content-plugin schemas (`$patch` extensions to content schemas) are registered
with the `jsonschema` module by `processPluginSchemas`. Because `jsonschema`
resets its registry on app-ready and only re-registers schemas owned by
`app.dependencies`, this module tracks plugin schema paths in `this.pluginSchemas`
and re-registers them via `jsonschema.registerSchemasHook`. `serveSchema` returns
the built schema for a plugin via `GET /api/contentplugins/schema?type=<name>`.

## The `_enabledPlugins` relationship

A plugin is "used" by a course through the course's **config** document:
`config._enabledPlugins` is an array of plugin `name`s. There is no per-course
copy of the plugin — courses reference plugins by name.

- New courses: `addDefaultPlugins` taps the content module's `preInsertHook`;
  on a `config` insert it appends every plugin with `isAddedByDefault: true`
  to `_enabledPlugins`.
- `getPluginUses(_id)` aggregates the `content` collection for `config` docs
  whose `_enabledPlugins` contains the plugin name, returning the owning courses
  (title + creator email). It gates deletion and drives the `/uses` endpoint.

## Endpoints

Routes are declared explicitly (`routes.json`) to omit the default `POST /` and
`PUT /:_id` — plugins are not created/edited as plain documents. Root:
`/api/contentplugins`.

| Method & route | Handler | Permission |
| --- | --- | --- |
| `GET /` | `requestHandler` | `read:contentplugins` |
| `GET /:_id` | `requestHandler` | `read:contentplugins` |
| `PATCH /:_id` | `requestHandler` | `write:contentplugins` |
| `DELETE /:_id` | `requestHandler` (uninstall) | `write:contentplugins` |
| `POST /query` | `queryHandler` | `read:contentplugins` |
| `GET /schema` | `serveSchema` | `read:schema` |
| `POST /install` | `installHandler` | `install:contentplugins` |
| `POST /:_id/update` | `updateHandler` | `update:contentplugins` |
| `GET /:_id/uses` | `usesHandler` | `read:contentplugins` |

### Install

`POST /api/contentplugins/install` accepts either JSON (`name`, `version`,
`force`) or a multipart zip upload (parsed by the `middleware` module's
`fileUploadParser`; the uploaded file path becomes `versionOrPath`). Install is
`strict: true` from the HTTP path, so failures throw.

```http
POST /api/contentplugins/install
Content-Type: application/json

{ "name": "adapt-contrib-text", "version": "7.5.1", "force": false }
```

`installPlugin` flow: resolve/process the source files → if the plugin already
exists and the new version is `<=` existing and `force` is false, throw
`CONTENTPLUGIN_ALREADY_EXISTS` → CLI `installPlugins` → `insertOrUpdate` the DB
record → register its schemas. Missing `targetAttribute` throws
`CONTENTPLUGIN_ATTR_MISSING`.

### Update

`GET /?includeUpdateInfo=true` enriches results with `canBeUpdated` and
`latestCompatibleVersion` (from the CLI `getPluginUpdateInfos`).
`POST /api/contentplugins/:_id/update` runs the CLI `updatePlugins`, updates the
DB record and schemas, then — if any courses use the plugin — calls
`framework.migrateCourses({ fromPlugins, toPlugins, courseIds })` to migrate
affected course content between the old and new plugin versions.

### Uninstall

`DELETE /api/contentplugins/:_id`. Blocked with `CONTENTPLUGIN_IN_USE` (listing
the offending courses) if any course's `_enabledPlugins` references it.
Otherwise deregisters the plugin's schemas, runs CLI `uninstallPlugins`, then
deletes the DB record.

## Backup & restore

Backups are created automatically around local installs (above). Restore is
available programmatically via `restorePluginFromBackup(pluginName)` — it renames
the most-recent `<name>-v*` backup back into place and returns its manifest, or
throws `NOT_FOUND` if no backup exists. There is no HTTP endpoint for restore; it
is also used implicitly by `getMissingPlugins` on boot to recover a local plugin
whose directory has gone missing.

## Config

| Option | Default | Notes |
| --- | --- | --- |
| `pluginDir` | `$DATA/contentplugins` | Location of locally installed plugins and their version backups |

## Errors

Defined in `errors/errors.json`. Notable: `CONTENTPLUGIN_ALREADY_EXISTS`,
`CONTENTPLUGIN_IN_USE`, `CONTENTPLUGIN_INVALID_ZIP`, `CONTENTPLUGIN_ATTR_MISSING`,
`CONTENTPLUGIN_CLI_INSTALL_FAILED`, `CONTENTPLUGIN_INSTALL_FAILED`,
`CONTENTPLUGIN_INCOMPAT_FW`. (`CONTENTPLUGIN_ATTR_CLASH`,
`CONTENTPLUGIN_NEWER_INSTALLED` and `CONTENTPLUGIN_VERSION_MISMATCH` are declared
but not thrown from this module's code.)
