const acorn = require('acorn');
const walk = require('acorn-walk');
const fs = require('fs');
const { interleaveArray } = require('./utils');
const assert = require('assert').strict;

function parse(source) {
  /**
   * Returns AST in ESTree format -- https://github.com/estree/estree/blob/master/es2020.md
   **/
  return acorn.parse(source, {
    ecmaVersion: 2020,
    sourceType: 'module'
  });
}

async function readFileAndParseAST(filePath) {
  const content = (await fs.promises.readFile(filePath, 'utf8')).toString();
  if (content.startsWith('#!')) {
    // Ignore nodeJS scripts that start with shabang
    return null;
  }
  try {
    return parse(content);
  } catch (e) {
    if (e instanceof SyntaxError) {
      const lineAtError = content.split('\n')[e.loc.line - 1];
      const arrow = (e.loc.column > 0 ? ' '.repeat(e.loc.column) : '') + '^';
      console.error(`Syntax Error : ${e.message}

${lineAtError}
${arrow}

at (${filePath}:${e.loc.line}:${e.loc.column})
      `);
      process.exit(1);
    } else {
      throw e;
    }
  }
}

const SUPPORTED_HOOKS = new Set(['beforeAll', 'beforeEach', 'afterAll', 'afterEach']);

function findTests(ast) {
  let tests = [];
  let hooks = Object.fromEntries(Array.from(SUPPORTED_HOOKS).map((hook) => [hook, []]));

  if (ast) {
    walk.ancestor(ast, {
      CallExpression: function(node, ancestors) {
        const dottedName = parseCallee(node);
        if (isTestIdentifier(dottedName)) {
          let funcNode = node.arguments[1];

          let scopeNodes = ancestors
            .filter((n) => n.type === 'CallExpression')
            .map((n) => ({ node: n, dotted: parseCallee(n) }))
            .filter((o) => o.dotted && isTestOrDescribeIdentifier(o.dotted));

          let scope = scopeNodes.map((o) => {
            return {
              name: inferTestName(o.node),
              func: o.dotted,
              start: o.node.start,
              end: o.node.end,
              ...(isSkip(o.dotted) && { skip: true }),
              ...(isOnly(o.dotted) && { only: true }),
              ...(isIosOnly(o.dotted) && { iosOnly: true }),
              ...(isAndroidOnly(o.dotted) && { androidOnly: true })
            };
          });

          tests.push({
            scope: scope,
            start: node.start,
            end: node.end,
            async: funcNode.async,
            funcStart: funcNode.start,
            funcEnd: funcNode.end,
            calls: findFuncCalls(funcNode),
            ...(scope.some((n) => n.skip) && { skip: true }),
            ...(scope.some((n) => n.only) && { only: true }),
            ...(scope.some((n) => n.iosOnly) && { iosOnly: true }),
            ...(scope.some((n) => n.androidOnly) && { androidOnly: true })
          });
        } else if (SUPPORTED_HOOKS.has(dottedName)) {
          // Watch out for false positives. If wrong number or params, or is not function, assume this is not a hook.
          if (node.arguments.length !== 1) {
            return;
          }
          let funcNode = node.arguments[0];
          if (funcNode.type !== "FunctionExpression" && funcNode.type !== "ArrowFunctionExpression") {
            return;
          }

          let scopeNodes = ancestors
            .filter((n) => n.type === "CallExpression")
            .map((n) => ({node: n, dotted: parseCallee(n)}))
            .filter((o) => o.dotted && isTestOrDescribeIdentifier(o.dotted));

          // also exclude calls to hooks if within it() scope
          if (scopeNodes.some((o) => isTestIdentifier(o.dotted))) {
            return;
          }

          let scope = scopeNodes.map((o) => {
            return {
              name: inferTestName(o.node),
              func: o.dotted,
              start: o.node.start,
              end: o.node.end,
              ...(isSkip(o.dotted) && {skip: true}),
              ...(isOnly(o.dotted) && {only: true}),
              ...(isIosOnly(o.dotted) && { iosOnly: true }),
              ...(isAndroidOnly(o.dotted) && { androidOnly: true })
            }
          });

          hooks[dottedName].push({
            scope: scope,
            start: node.start,
            end: node.end,
            async: funcNode.async,
            funcStart: funcNode.start,
            funcEnd: funcNode.end,
            calls: findFuncCalls(funcNode),
          })
        }
      }
    });
  }

  return { tests, hooks };
}

function findFuncCalls(ast, nameFilter) {
  let calls = [];
  walk.ancestor(ast, {
    CallExpression: function (node, ancestors) {
      const parent = ancestors.length > 1 ? ancestors.at(-2) : null;
      const dottedName = parseCallee(node);
      if (nameFilter && !nameFilter(dottedName)) {
        // this call should be ignored. so do nothing.
      } else {
        const arguments = node.arguments.map(a => {
          return {  // simply return type and position of each argument so caller can target and parse if required
            type: a.type,
            start: a.start,
            end: a.end,
          }
        });
        const literalArguments = {};
        let hasLiteralArguments = false;
        node.arguments.forEach((a, i) => {
          if (a.type === 'Literal') {
            hasLiteralArguments = true;
            literalArguments[i] = a.value;
          }
        });

        /* special handling of api({ sync: ?? }).regionCall(...) calls */
        let errors = [];
        let apiSyncDisabled = false;
        let apiWaitAfter = false;
        if (dottedName === 'api') {  // will be handled in chained call
          return;
        } else if (dottedName.startsWith('api.')) {
          // In the case of api.central.*, type would be 'memberExpression' and apiArguments will be false
          const apiArguments = node.callee.object.type === 'CallExpression' && node.callee.object.arguments;
          if (apiArguments && apiArguments.length > 0 && apiArguments[0].type === 'ObjectExpression') {
            apiArguments[0].properties.forEach(argProp => {
              if (getPropertyKey(argProp) === 'sync' ) {
                if (assertPropertyNodeIsLiteralBooleanAndExtract(argProp, errors) === false) {
                  apiSyncDisabled = true;
                }
              }
              if (getPropertyKey(argProp) === 'waitAfter') {
                if (assertPropertyNodeIsLiteralBooleanAndExtract(argProp, errors) === true) {
                  apiWaitAfter = true;
                }
              }
            });
          }
        }
        console.log(JSON.stringify(arguments, null, 2));
        calls.push({
          name: dottedName,
          start: node.callee.property ? node.callee.property.start : node.start,
          rootStart: node.start, // if chained calls, this != start
          end: node.end,  // end at the end of the full call, including params and inner func.
          arguments: arguments,
          await: parent && parent.type === 'AwaitExpression',
          ...(hasLiteralArguments ? { literalArguments } : null),
          ...(apiSyncDisabled ? { apiSyncDisabled } : null),
          ...(apiWaitAfter ? { apiWaitAfter } : null),
          ...(errors.length > 0 ? { errors } : null)

        })
      }
    },
  });
  return calls;
}

function assertPropertyNodeIsLiteralBooleanAndExtract(node, errors) {
  if (node.value.type !== 'Literal' || !(typeof node.value.value === 'boolean')) {
    errors.push({
      message: `"${node.key.name}" property is expected to have literal Boolean value (true/false)`,
      loc: node.value.start
    });
    return null;
  }
  return node.value.value;
}

function getPropertyKey(propNode) {
  if (propNode.key.type === 'Literal') {
    return propNode.key.value;
  } else if (propNode.key.type === 'Identifier') {
    return propNode.key.name;
  }
}

function inferTestName(testCallNode) {
  const node = testCallNode.arguments[0];

  if (node.type === 'Literal') {
    return node.value;
  } else if (node.type === 'TemplateLiteral') {
    let expressions = node.expressions.map((i) => `\${${i.name}}`);
    let quasis = node.quasis.map((q) => q.value.raw);
    return interleaveArray(quasis, expressions).join('');
  } else if (node.type === 'Identifier') {
    return `\${${node.name}}`;
  } else {
    return `[Unparseable: ${node.type}]`;
  }
}


function isTestOrDescribeIdentifier(ident) {
  return isTestIdentifier(ident) || isDescribeIdentifier(ident);
}

function isTestIdentifier(ident) {
  return ident === 'it' || ident.startsWith('it.');
}

function isDescribeIdentifier(ident) {
  return ident === 'describe' || ident.startsWith('describe.');
}

function isSkip(ident) {
  return ident.endsWith('.skip');
}

function isIosOnly(ident) {
  return ident.endsWith('.iosOnly') || ident.endsWith('.ios');
}

function isAndroidOnly(ident) {
  return ident.endsWith('.androidOnly') || ident.endsWith('.android');
}

function isOnly(ident) {
  return ident.endsWith('.only') || isIosOnly(ident) || isAndroidOnly(ident);
}

function IgnoreMe(node) {
  this.node = node;
}

function parseCallee(node) {
  /**
   * Returns string representation of a CallExpression's callees, e.g.
   *  - "Cypress.Commands.add"
   *  - "cy.funcA().funcB"
   */
  assert(node.type === 'CallExpression', 'This method should only be called on CallExpression nodes');
  try {
    return _traverse(node.callee);
  } catch (e) {
    if (e instanceof IgnoreMe) {
      return null;
    } else {
      throw e;
    }
  }

  function _traverse(_node, suffix = '') {
    switch (_node.type) {
      case 'Identifier':
        return _node.name;
      case 'MemberExpression':
        return _traverse(_node.object) + '.' + _node.property.name + suffix;
      case 'CallExpression':
        return _traverse(_node.callee, '()');
      default:
        /**
         * calls could be chained to many other types, e.g.:
         *  - ArrayExpression:  [...].sort(..)
         *  - Literal: "...".repeat(10)
         *  - TemplateLiteral: `...`.repeat(10)
         *  - NewExpression: new Blah()
         *  - ...
         *
         * We do not want to handle any of that for now, so we throw end recursion and caller will catch to handle this
         */
        throw new IgnoreMe(node);
    }
  }
}


module.exports = {
  findTests,
  readFileAndParseAST,
}
