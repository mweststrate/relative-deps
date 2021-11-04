#!/usr/bin/env node
import yargs from "yargs";
import {
  installRelativeDeps,
  watchRelativeDeps,
  initRelativeDeps,
  addRelativeDeps
} from "./index.js";

yargs
  .usage("Usage: $0 <command> [options]")
  .command({
    command: "*",
    describe: "Install relative deps",
    handler: installRelativeDeps
  })
  .command({
    command: "watch",
    describe: "Watch relative deps and install on change",
    handler: watchRelativeDeps
  })
  .command({
    command: "init",
    describe: "Initialize relative-deps",
    handler: initRelativeDeps
  })
  .command({
    command: "add [paths...]",
    describe: "Add path as relative dependencies",
    handler: addRelativeDeps
  })
  .option("D", {
    alias: ["dev", "save-dev"],
    description: "Save as dev dependency",
    default: false,
    type: "boolean"
  })
  .option("S", {
    alias: ["script"],
    description: "Script for relative-deps",
    default: "prepare",
    type: "string"
  }).argv;
