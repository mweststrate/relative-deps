const path = require("path")
const child_process = require("child_process")
const fs = require("fs")
const readPkgUp = require("read-pkg-up")
const rimraf = require("rimraf")
const globby = require("globby")
const checksum = require("checksum")
const merge = require("lodash/merge")
const { spawn } = require("yarn-or-npm")

async function installRelativeDeps() {
  const projectPkgJson = readPkgUp.sync()
  const config = getConfig()

  // support old `relativeDependencies` config in package.json file as a fallback
  const relativeDependencies = config || projectPkgJson.package.relativeDependencies

  if (!relativeDependencies) {
    console.warn("[relative-deps][WARN] No 'relativeDependencies' specified in package.json")
    process.exit(0)
  }

  const targetDir = path.dirname(projectPkgJson.path)

  const depNames = Object.keys(relativeDependencies)
  for (const name of depNames) {
    const libDir = path.resolve(targetDir, relativeDependencies[name])
    console.log(`[relative-deps] Checking '${name}' in '${libDir}'`)

    const regularDep =
      (projectPkgJson.package.dependencies && projectPkgJson.package.dependencies[name]) ||
      (projectPkgJson.package.devDependencies && projectPkgJson.package.devDependencies[name])

    if (!regularDep) {
      console.warn(`[relative-deps][WARN] The relative dependency '${name}' should also be added as normal- or dev-dependency`)
    }

    // Check if target dir exists
    if (!fs.existsSync(libDir)) {
      // Nope, but is the dependency mentioned as normal dependency in the package.json? Use that one
      if (regularDep) {
        console.warn(`[relative-deps][WARN] Could not find target directory '${libDir}', using normally installed version ('${regularDep}') instead`)
        return
      } else {
        console.error(
          `[relative-deps][ERROR] Failed to resolve dependency ${name}: failed to find target directory '${libDir}', and the library is not present as normal depenency either`
        )
        process.exit(1)
      }
    }

    const hashStore = {
      hash: "",
      file: ""
    }
    const hasChanges = await libraryHasChanged(name, libDir, targetDir, hashStore)
    if (hasChanges) {
      buildLibrary(name, libDir)
      packAndInstallLibrary(name, libDir, targetDir)
      fs.writeFileSync(hashStore.file, hashStore.hash)
      console.log(`[relative-deps] Re-installing ${name}... DONE`)
    }
  }
}

async function libraryHasChanged(name, libDir, targetDir, hashStore) {
  const hashFile = path.join(targetDir, "node_modules", name, ".relative-deps-hash")
  const referenceContents = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, "utf8") : ""
  // compute the hahses
  const libFiles = await findFiles(libDir, targetDir)
  const hashes = []
  for (file of libFiles) hashes.push(await getFileHash(path.join(libDir, file)))
  const contents = libFiles.map((file, index) => hashes[index] + " " + file).join("\n")
  hashStore.file = hashFile
  hashStore.hash = contents
  if (contents === referenceContents) {
    // computed hashes still the same?
    console.log("[relative-deps] No changes")
    return false
  }
  // Print which files did change
  if (referenceContents) {
    const contentsLines = contents.split("\n")
    const refLines = referenceContents.split("\n")
    for (let i = 0; i < contentsLines.length; i++)
      if (contentsLines[i] !== refLines[i]) {
        console.log("[relative-deps] Changed file: " + libFiles[i]) //, contentsLines[i], refLines[i])
        break
      }
  }
  return true
}

async function findFiles(libDir, targetDir) {
  const ignore = ["**/*", "!node_modules", "!.git"]
  // TODO: use resolved paths here
  if (targetDir.indexOf(libDir) === 0) {
    // The target dir is in the lib directory, make sure that path is excluded
    ignore.push("!" + targetDir.substr(libDir.length + 1).split(path.sep)[0])
  }
  const files = await globby(ignore, {
    gitignore: true,
    cwd: libDir,
    nodir: true
  })
  return files.sort()
}

function buildLibrary(name, dir) {
  // Run install if never done before
  if (!fs.existsSync(path.join(dir, "node_modules"))) {
    console.log(`[relative-deps] Running 'install' in ${dir}`)
    spawn.sync(["install"], {  cwd: dir, stdio: [0, 1, 2] })
  }

  // Run build script if present
  const libraryPkgJson = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
  if (!libraryPkgJson.name === name) {
    console.error(`[relative-deps][ERROR] Mismatch in package name: found '${libraryPkgJson.name}', expected '${name}'`)
    process.exit(1)
  }
  if (libraryPkgJson.scripts && libraryPkgJson.scripts.build) {
    console.log(`[relative-deps] Building ${name} in ${dir}`)
    spawn.sync(["build"], {  cwd: dir, stdio: [0, 1, 2] })
  }
}

function packAndInstallLibrary(name, dir, targetDir) {
  const libDestDir = path.join(targetDir, "node_modules", name)
  let fullPackageName
  try {
    console.log("[relative-deps] Copying to local node_modules")
    spawn.sync(["pack"], { cwd: dir, stdio: [0, 1, 2] })

    if (fs.existsSync(libDestDir)) {
      // TODO: should we really remove it? Just overwritting could be fine
      rimraf.sync(libDestDir)
    }
    fs.mkdirSync(libDestDir, { recursive: true })

    const tmpName = name.replace(/[\s\/]/g, "-").replace(/@/g, "at-")
    const regex = new RegExp(`^${tmpName}(.*).tgz$`)

    const packagedName = fs.readdirSync(dir).find(file => regex.test(file))
    fullPackageName = path.join(dir, packagedName)

    console.log(`[relative-deps] Extracting "${fullPackageName}" to ${libDestDir}`)

    child_process.execFileSync(
      "tar",
      ["zxf", path.relative(process.cwd(), fullPackageName), "--strip-components=1", "-C", path.relative(process.cwd(), libDestDir), "package"],
      { stdio: [0, 1, 2] }
    )
  } finally {
    if (fullPackageName) {
      fs.unlinkSync(fullPackageName)
    }
  }
}

async function getFileHash(file) {
  return await new Promise((resolve, reject) => {
    checksum.file(file, (error, hash) => {
      if (error) reject(error)
      else resolve(hash)
    })
  })
}

function addScriptToPackage(script) {
  let pkg = getPackageJson()
  if (!pkg.scripts) {
    pkg.scripts = {}
  }

  const msg = `[relative-deps] Adding relative-deps to ${script} script in package.json`

  if (!pkg.scripts[script]) {
    console.log(msg)
    pkg.scripts[script] = "relative-deps"

  } else if(!pkg.scripts[script].includes("relative-deps")) {
    console.log(msg)
    pkg.scripts[script] = `${pkg.scripts[script]} && relative-deps`
  }
  setPackageData(pkg)
}

function installRelativeDepsPackage() {
  let config = getConfig();

  if (config) {
    console.log('[relative-deps] Installing relative-deps package')
    spawn.sync(["add -D relative-deps"])
  }
}

function setupEmptyRelativeDeps () {
  let config = getConfig()

  if (!config) {
    console.log(`[relative-deps] Setting up relativeDependencies config file`)
    setConfig({})
  }
}

function initRelativeDeps({ script }) {
  installRelativeDepsPackage()
  setupEmptyRelativeDeps()
  addScriptToPackage(script)
}

async function addRelativeDeps({ paths, dev, script }) {
  initRelativeDeps({ script })

  if (!paths || paths.length === 0) {
    console.log(`[relative-deps][WARN] no paths provided running ${script}`)
    spawn.sync([script])
    return
  }
  const libraries = paths.map(relPath => {
    const libPackagePath = path.resolve(process.cwd(), relPath, "package.json")
    if (!fs.existsSync(libPackagePath)) {
      console.error(
        `[relative-deps][ERROR] Failed to resolve dependency ${relPath}`
      )
      process.exit(1)
    }

    const libraryPackageJson = JSON.parse(fs.readFileSync(libPackagePath, "utf-8"))

    return {
      relPath,
      name: libraryPackageJson.name,
      version: libraryPackageJson.version
    }
  })

  let pkg = getPackageJson()
  let config = getConfig()

  const depsKey = dev ? "devDependencies" : "dependencies"
  if (!pkg[depsKey]) pkg[depsKey] = {}

  libraries.forEach(library => {
    if (!pkg[depsKey][library.name]) {
      try {
        spawn.sync([`add ${dev ? "-D" : ""} ${library.name}`], { stdio: "ignore" })
      } catch (_e) {
        console.log(`[relative-deps][WARN] Unable to fetch ${library.name} from registry. Installing as a relative dependency only.`)
      }
    }
  })

  libraries.forEach(dependency => {
    config[dependency.name] = dependency.relPath
  })

  setPackageData(pkg)
  setConfig(config)
  await installRelativeDeps()
}

function setPackageData(pkgData) {
  const source = getPackageJson()
  fs.writeFileSync(
    path.join(process.cwd(), "package.json"),
    JSON.stringify(merge(source, pkgData), null, 2)
  )
}

function setConfig(config) {
  fs.writeFileSync(
    path.join(process.cwd(), "relative-deps.json"),
    JSON.stringify(config, null, 2)
  )
}

function getPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), "utf-8"))
}

function getConfig() {
  const configFilePath = path.join(process.cwd(), 'relative-deps.json');
  const config = fs.existsSync(configFilePath) ? fs.readFileSync(configFilePath, "utf-8") : null
  return JSON.parse(config) || null
}

module.exports.installRelativeDeps = installRelativeDeps
module.exports.initRelativeDeps = initRelativeDeps
module.exports.addRelativeDeps = addRelativeDeps
