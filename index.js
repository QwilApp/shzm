#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const glob = require("glob");
const { Command } = require('commander');
const { readFileAndParseAST, findTests, findExportedFunc } = require('./parser');
const { mapCharOffsetToLineno } = require('./utils');
const pjs =  require("./package.json");

const binName = pjs.name;

async function main() {
  const program = new Command();
  program
    .name(binName)
    .description("Parse and identify Qwil-style Detox/Jest test files and functions")
    .version(pjs.version)

  program.command('tests')
    .description('Parses spec files and dumps results to stdout as JSON')
    .addHelpText("after", `
Examples:

  ${binName} tests ./e2e/tests  # look for tests in all *.spec.js files under ./e2e/tests dir
  ${binName} tests ./e2e/tests ./e2e/uat  # specify multiple dirs
  ${binName} tests ./e22/tests/a.spec.js  # parse a single file
    `)
    .argument('<file_or_dir...>', 'files or dirs to parse')
    .action(async (paths) => {
      await parseAndDumpTests(paths);
    })

  program.command('functions')
    .description('Parses js files to local exported functions and dumps results to stdout as JSON')
    .addHelpText("after", `
Examples:

  ${binName} functions ./e2e/support  # look for exported functions in all *.js files under ./e2e/support dir
  ${binName} functions ./e2e/support ./e2e/api  # specify multiple dirs
  ${binName} functions ./e22/support/a.spec.js  # parse a single file
    `)
    .argument('<file_or_dir...>', 'files or dirs to parse')
    .action(async (paths) => {
      await parseAndDumpFuncExports(paths);
    })

  program.parse();
}

async function parseAndDumpTests(paths) {
  const filenames = resolvePaths(paths, ".spec.js");
  let out = {};
  for (const filename of filenames) {
    // console.log(filename)
    try {
      out[filename] = findTests(
        await readFileAndParseAST(path.resolve(filename))
      );
    } catch (e) {
      if (e.name === 'ParseLimitationsError') {
        handleParseLimitationsError(e);
      } else {
        throw e;
      }
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

async function parseAndDumpFuncExports(paths) {
  const filenames = resolvePaths(paths, ".js");
  let out = {};
  for (const filename of filenames) {
    // console.log(filename)
    try {
      out[filename] = findExportedFunc(
        await readFileAndParseAST(path.resolve(filename))
      );
    } catch (e) {
      if (e.name === 'ParseLimitationsError') {
        handleParseLimitationsError(e);
      } else {
        throw e;
      }
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

function handleParseLimitationsError(e, filename) {
  const loc = mapCharOffsetToLineno(filename, e.atChar);
  quit(`ERROR: ${e.message}\n    at (${filename}:${loc.line}:${loc.col})`)
}

function resolvePaths(paths, suffix= ".js") {
  let resolved = new Set();
  for (const p of new Set(paths)) {
    if (!fs.existsSync(p)) {
      quit(`ERROR: "${p}" does not exist`);
    }
    let stat = fs.lstatSync(p);
    if (stat.isFile()) {
      if (p.endsWith(suffix)) {
        resolved.add(p);
      } else {
        quit(`ERROR: unsupported file "${p}". Expecting *${suffix}`)
      }
    } else if (stat.isDirectory()) {
      glob.sync(`**/*${suffix}`, { cwd: p }).forEach((f) => {
        resolved.add(path.join(p, f));
      })
    } else {
      quit(`ERROR: "${p}" is neither a file nor a directory`);
    }
  }
  return Array.from(resolved).sort();
}

function quit(message) {
  console.error(message);
  process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
