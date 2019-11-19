# relative-deps

[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://www.paypal.me/michelweststrate)
<a href="https://www.buymeacoffee.com/mweststrate" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Coffee" style="height: 22px !important;width: auto !important;" ></a>

_Installs dependencies from a local checkout, and keeps them in sync, without the limitations of `link`_

---

# Summary

Relative deps introduces an additional dependency section in `package.json`, called `relativeDependencies`.
This section contains paths to the local sources of any dependency, that will be built and installed over the publicly available versions, when needed.

Example `package.json`:

```json
{
  "name": "my-example-project",
  "dependencies": {
    "my-cool-library": "0.0.1"
  },
  "relativeDependencies": {
    "my-cool-library": "../../packages/my-cool-library"
  },
  "scripts": {
    "postinstall": "relative-deps"
  },
  "devDependencies": {
    "relative-deps": "^0.1.0"
  }
}
```

When the relative path can be found, the library at this path will be re-built and re-installed into this project, if the source files have been changed during `postinstall`.

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

Relative deps doesn't fight the problem but tries to emulate a "normal" install. It builds the "linked" library on `postinstall`, packs it, and unpacks it in the `node_modules` of the hosting project. Since there is no linking, or shared `node_modules` involved, the folder structure ends up to be exactly the same as if the thing was installed directly from `yarn` / `npm`. Which avoids a plethora of problems.

Since building a linked package every time `yarn install` is run is expensive, this tool will take a hash of the directory contents of the library first, and only build and install if something changed.

# Installation

Install `relative-deps` as developer dependency. Either in the hosting project, or somewhere higher in the directory structure:

`yarn add -D relative-deps`.

In the hosting project, add the following `package.json` script:

`"postinstall": "yarn relative-deps"`

This will re-install any relative dependency if needed when running `yarn install`.

Optionally, you can add this step also for more scripts, for example:

```json
{
  "name": "mobx-react-demo",
  "scripts": {
    "postinstall": "relative-deps",
    "prestart": "relative-deps",
    "prebuild": "relative-deps",
    "pretest": "relative-deps"
  }
}
```

# Adding a relative dependency

### Step 1: Install the dependency as normal dependency

First, can install a relative dependency as normal dependency. The benefit of this is that anybody that checks out the project, but doesn't have a checkout of the targeted library, gets the normally published version. (It also ensures that transitive dependencies are resolved, if the package to be installed has no relative dependencies, this step is optional. ).
For example:

```json
{
  "name": "mobx-react-demo",
  "dependencies": {
    "mobx-react": "^4.0.0"
  }
}
```

```bash
yarn
```

### Step 2: Link to the relative dependency

To add the same package as a relative dependency, add its name and relative path under the `relativeDependencies` top-level section in the `package.json` of the hosting package. If a dependency is available at it's relative location, this take precedence over the normal dependency, thanks to the `postinstall` script. For example:

```json
{
  "name": "mobx-react-demo",
  "relativeDependencies": {
    "mobx-react": "../../"
  }
}
```

After that, run `yarn` to complete the proces and install the relative dependency for the first time

Example of a [repository migration to relative-deps](https://github.com/mobxjs/mst-gql/pull/40/commits/4d2c0858f8c44a562c0244466b56f79b0ed7591b)

### Step 3: Run `yarn relative-deps` when devving!

The relative deps will automatically be checked for changes, based on the hooks you've set up during [installation](#installation).

However, you can always trigger a manual check-and-build-if-needed by running `yarn relative-deps` (or just `yarn`). If you are working on a project that supports
hot reloading, this will makes sure the changes in the relative dependency will automatically show up in your project! (A watch mode, to even automate this, might be introduced in the future).

# How

Roughly, it works like this (obviously this can get out of date quickly):

```
- pre: yarn.lock exists or die
- read relativeDeps from nearest package.json
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
