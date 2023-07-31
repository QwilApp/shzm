const fs = require("fs");
const assert = require('assert').strict;

/**
 * Given filename and char offset, synchronously reads file content then returns {line: X, col: Y} where X and Y are
 * integers starting from 1 (not 0).
 *
 * It is the caller's responsibility to ensure that the file exists and is readable.
 */
function mapCharOffsetToLineno(filename, offset, cacheMode="recent") {
  const info = getCachedFileLineInfo(filename);
  assert(offset <= info.size, "offset exceeds file size");

  let runningSum = 0;
  for (let i = 0; i < info.lineLengths.length; i++) {
    let currentLineLength = info.lineLengths[i];
    if (runningSum + currentLineLength > offset) {
      return {
        line: i + 1,
        col: offset - runningSum + 1,
      }
    } else {
      runningSum += currentLineLength;
    }
  }
}


/**
 * Synchronously reads file content, then returns object with:
 *  - size: total chars in file
 *  - lineLengths: Array of ints representing number of chars per file line (including trailing linefeed)
 *
 * It is the caller's responsibility to ensure that the file exists and is readable.
 */
function getFileLineInfo(filename) {
  let content = fs.readFileSync(filename, { encoding: "utf8", flag: 'r' });
  return {
    size: content.length,
    lineLengths: content.split("\n").map((line) => line.length + 1),  // +1 to account for stripped "\n"
  }
}

let _fileLineInfoCache = {};

/**
 * Since the usual access pattern is such that calls for the same filename are grouped together, we strike a balance
 * between performance and memory usage by only caching the most recently used filename.
 *
 * If the
 */
function getCachedFileLineInfo(filename) {
  if (filename !== _fileLineInfoCache.filename) {
    _fileLineInfoCache = {
      filename,
      info: getFileLineInfo(filename),
    }
  }
  return _fileLineInfoCache.info;
}

/**
 * [a1, a2, a3], [b1, b2] => [a1, b1, a2, b2, a3]
 */
function interleaveArray(a, b) {
  let out = []
  let length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    i < a.length && out.push(a[i]);
    i < b.length && out.push(b[i]);
  }
  return out;
}

function formatMatchLocation(match) {
  const loc = mapCharOffsetToLineno(match.filename, match.start);
  return `${path.resolve(match.filename)}:${loc.line}:${loc.col}`;
}

module.exports = {
  interleaveArray,
  mapCharOffsetToLineno,
  formatMatchLocation
}