#!/usr/bin/env node
const path = require("path")
const child_process = require("child_process")
const fs = require("fs")
const readPkgUp = require("read-pkg-up")
const rimraf = require("rimraf")

const projectPkgJson = readPkgUp.sync()

const relativeDependencies = projectPkgJson.package.relativeDependencies

if (!relativeDependencies) {
  console.warn("[relative-deps] No 'relativeDependencies' specified in package.json")
  process.exit(0)
}

const targetDir = path.dirname(projectPkgJson.path)

Object.keys(relativeDependencies).forEach(name => {
  const dir = path.resolve(targetDir, relativeDependencies[name])
  console.log(`[relative-deps] checking '${name}' in '${dir}'`)

  // Check if target dir exists
  if (!fs.existsSync(dir)) {
    // Nope, but is the dependency mentioned as normal dependency in the package.json? Use that one
    if (
      (projectPkgJson.package.dependencies && projectPkgJson.package.dependencies[name]) ||
      (projectPkgJson.package.devDependencies && projectPkgJson.package.devDependencies[name])
    ) {
      console.warn(`[relative-deps] Could not find target director '${dir}', using already installed version instead`)
      return
    } else {
      console.error(`[relative-deps] Failed to find target directory '${dir}'`)
      process.exit(1)
    }
  }

  if (libraryHasChanged(name, dir)) {
    // TODO: buildLibrary(name, dir)
    packAndInstallLibrary(name, dir, targetDir)
    console.log(`[relative-deps] ${name}... DONE`)
  }
})

function libraryHasChanged(name, dir) {
  // TODO:
  return true
}

function buildLibrary(name, dir) {
  console.log("[relative-deps] Building " + name)
  // Run install if never done before
  if (!fs.existsSync(dir + "/node_modules")) {
    child_process.execSync("yarn install", {
      cwd: dir,
      stdio: [0, 1, 2]
    })
  }

  // Run build script if present
  const libraryPkgJson = JSON.parse(fs.readFileSync(dir + "/package.json", "utf8"))
  if (!libraryPkgJson.name === name)
    throw new Error(`Mismatch in package name: found '${libraryPkgJson.name}', expected '${name}'`)
  if (libraryPkgJson.scripts && libraryPkgJson.scripts.build) {
    child_process.execSync("yarn build", {
      cwd: dir,
      stdio: [0, 1, 2]
    })
  }
}

function packAndInstallLibrary(name, dir, targetDir) {
  const libDestDir = targetDir + "/node_modules/" + name
  const tmpName = `${name}${Date.now()}.tgz`
  try {
    console.log("[relative-deps] Copying to local node_modules")
    child_process.execSync(`yarn pack --filename ${tmpName}`, {
      cwd: dir,
      stdio: [0, 1, 2]
    })

    if (fs.existsSync(libDestDir)) rimraf.sync(libDestDir)
    fs.mkdirSync(libDestDir)

    child_process.execSync(`tar zxf ${dir}/${tmpName} --strip-components=1 -C ${libDestDir} package`, {
      stdio: [0, 1, 2]
    })

    // TODO: should this be done?
    // console.log("[relative-deps] Installing")
    // child_process.execSync(`yarn install --production`, {
    //   cwd: libDestDir,
    //   stdio: [0, 1, 2]
    // })
  } finally {
    fs.unlinkSync(dir + "/" + tmpName)
  }
}
