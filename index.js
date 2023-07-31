#!/usr/bin/env node
const { findTests, readFileAndParseAST } = require('./parser');

async function main() {
  const node = await readFileAndParseAST('test.js');
  const out = findTests(node);
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
