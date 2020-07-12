# relative-deps

[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://www.paypal.me/michelweststrate)
<a href="https://www.buymeacoffee.com/mweststrate" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Coffee" style="height: 22px !important;width: auto !important;" ></a>

_Installs dependencies from a local checkout, and keeps them in sync, without the limitations of `link`_

---

# Summary

Relative deps introduces an additional dependency config file called `.relativeDependenciesrc`
This config contains paths to the local sources of any dependency, that will be built and installed over the publicly available versions, when needed.

Example `relativeDependenciesrc`:

```json
{
  "my-cool-library": "../../packages/my-cool-library"
}
```

When the relative path can be found, the library at this path will be re-built and re-installed into this project, if the source files have been changed during `prepare`.

The normal `my-cool-library` dependency will be defaulted to, for those that don't have a local checkout of `my-cool-library`, and to resolve transitive dependencies.

An example setup, where examples project are linked to their hosting library, can be found [here](https://github.com/mobxjs/mst-gql/pull/40/commits/4d2c0858f8c44a562c0244466b56f79b0ed7591b).

# Why

### The problem

Working on libraries that have examples embedded in the same git repository is usually tricky, as the examples are usually built against the public, published version of the library; the version that is mentioned in their `package.json`.

When working maintaining a project though, it is much more useful to work against the locally checked out version of the library. Published or not.

### The problems with existing solutions

There are a few existing solutions, but they have their own limitations:

- `yarn link` / `npm link`. These work only if there are no peer / shared dependencies involved. If there are shared dependencies, the linked library will resolve those in their _own_ `node_modules`, instead of the `node_modules` of the hosting project, where it would normally be looked up. This results in peer dependencies ending up "twice" in the dependency tree, which often causes confusing behavior.
- `yarn workspaces`. Those solve the above issue by putting all dependencies in one large root level `node_modules`. However, this setup is in practice quite obtrusive to the whole development setup.

### How is relative deps different?

Relative deps doesn't fight the problem but tries to emulate a "normal" install. It builds the "linked" library on `prepare` (that is, after installing all deps), packs it, and unpacks it in the `node_modules` of the hosting project. Since there is no linking, or shared `node_modules` involved, the folder structure ends up to be exactly the same as if the thing was installed directly from `yarn` / `npm`. Which avoids a plethora of problems.

Since building a linked package every time `yarn install` is run is expensive, this tool will take a hash of the directory contents of the library first, and only build and install if something changed.

# Usage

## Installation

```bash
npx relative-deps init
```
Options:

* `--script`

Alias `-S`. Default: `prepare`. Script name which is using for running `relative-deps`.

Running this script will install `relative-deps`, add `prepare` script and create an empty `.relativeDependenciesrc` file.

```json
{
  "name": "my-project",
  "devDependencies": {
    "relative-deps": "^1.0.0"
  },
  "scripts": {
    "prepare": "relative-deps"
  }
}
```

Optionally, you can add this step also for more scripts, for example before starting or building your project, for example:

```json
{
  "name": "my-project",
  "scripts": {
    "prepare": "relative-deps",
    "prestart": "relative-deps",
    "prebuild": "relative-deps",
    "pretest": "relative-deps"
  }
}
```

In general, this doesn't add to much overhead, since usually relative-deps is able to determine rather quickly (~0.5 sec) that there are no changes.

### Configuration alternatives

You can configure `relative-deps` in few ways, depends on your prefference:

- a `relativeDependencies` property in package.json
- a `.relativeDependenciesrc` file in JSON or YAML format
- a `.relativeDependenciesrc.json` file
- a `.relativeDependenciesrc.yaml`, `.relativeDependenciesrc.yml`, or `.relativeDependenciesrc.js` file
- a ``relativeDependencies.config.js`` file exporting a JS object

## Adding a relative dependency

Running following script will initialize `relative-deps` if not initialized yet, find the package at the provided path, install it as normal dependency and pack relative-dependency.

```bash
npx relative-deps add ../../packages/my-cool-library
```

Options:

* `--dev`

Alias `-D`. Installs relative dependency in `devDependencies` section.

```json
{
  "name": "my-project",
  "dependencies": {
    "my-cool-library": "0.1.0"
  },
  "relativeDependencies": {
    "my-cool-library": "../../packages/my-cool-library"
  },
  "scripts": {
    "prepare": "relative-deps"
  },
  "devDependencies": {
    "relative-deps": "^1.0.0"
  }
}
```

Example of a [repository migration to relative-deps](https://github.com/mobxjs/mst-gql/pull/40/commits/4d2c0858f8c44a562c0244466b56f79b0ed7591b)

## Run `yarn relative-deps` when devving!

The relative deps will automatically be checked for changes, based on the hooks you've set up during [installation](#installation).

However, you can always trigger a manual check-and-build-if-needed by running `yarn relative-deps` (or just `yarn`). If you are working on a project that supports
hot reloading, this will makes sure the changes in the relative dependency will automatically show up in your project! (A watch mode, to even automate this, might be introduced in the future).

# How

Roughly, it works like this (obviously this can get out of date quickly):

```
- pre: yarn.lock exists or die
- read relativeDeps from nearest relative-deps.json
- doesn't exist? warn & exit
- for each relativeDep:
- check if target path exists
  - if not, do we have the module from normal install?
  - yes: warn
  - no: error
- if target path exists, does it have node modules?
  - no: run yarn / npm install (guess which one)
- find last modified timestamp of all files in target dir
  (excluding node_modules, .git, excluding the directory that contains the calling project if applicable, only use git versioned files)
- take hash and store / compare with stored
- if changed:
  - run yarn / npm build
  - run pack
  - extract package (mind scoped package names!)
  - run yarn install --no-dev-deps in target dir
- done
```

# Tips

Tip: use the `postinstall` hook wherever applicable, if your dependency manager does not support `prepare` hooks yet.
