#!/usr/bin/env node
const path = require("path")
const child_process = require("child_process")
const fs = require("fs")
const readPkgUp = require("read-pkg-up")
const rimraf = require("rimraf")
const globby = require("globby")
const checksum = require("checksum")

async function main() {
  const projectPkgJson = readPkgUp.sync()

  const relativeDependencies = projectPkgJson.package.relativeDependencies

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
      console.warn(
        `[relative-deps][WARN] The relative dependency '${name}' should also be added as normal- or dev-dependency`
      )
    }

    // Check if target dir exists
    if (!fs.existsSync(libDir)) {
      // Nope, but is the dependency mentioned as normal dependency in the package.json? Use that one
      if (regularDep) {
        console.warn(
          `[relative-deps][WARN] Could not find target directory '${libDir}', using normally installed version ('${regularDep}') instead`
        )
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
  const hashFile = targetDir + "/node_modules/" + name + "/.relative-deps-hash"
  const referenceContents = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, "utf8") : ""
  // compute the hahses
  const libFiles = await findFiles(libDir, targetDir)
  const hashes = []
  for (file of libFiles) hashes.push(await getFileHash(libDir + "/" + file))
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
  if (!libraryPkgJson.name === name) {
    console.error(`[relative-deps][ERROR] Mismatch in package name: found '${libraryPkgJson.name}', expected '${name}'`)
    process.exit(1)
  }
  if (libraryPkgJson.scripts && libraryPkgJson.scripts.build) {
    child_process.execSync("yarn build", {
      cwd: dir,
      stdio: [0, 1, 2]
    })
  }
}

function packAndInstallLibrary(name, dir, targetDir) {
  const libDestDir = targetDir + "/node_modules/" + name
  const tmpName = `${name}${Date.now()}.tgz`.replace(/[\s\/]/g, '-',);
  try {
    console.log("[relative-deps] Copying to local node_modules")
    child_process.execSync(`yarn pack --filename ${tmpName}`, {
      cwd: dir,
      stdio: [0, 1, 2]
    })

    if (fs.existsSync(libDestDir)) {
      // TODO: should we really remove it? Just overwritting could be fine
      rimraf.sync(libDestDir)
    }
    fs.mkdirSync(libDestDir)

    child_process.execSync(`tar zxf ${dir}/${tmpName} --strip-components=1 -C ${libDestDir} package`, {
      stdio: [0, 1, 2]
    })
  } finally {
    fs.unlinkSync(dir + "/" + tmpName)
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

main().catch(e => console.error(e))
