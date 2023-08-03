# shzm
_(Because shazam was taken)_

Javascript parser that was designed to work with Qwil's Detox/Jest test suite. 
It extracts test definitions and functions definitions, then dumps the structure output as JSON so that
it can be easily consumed by scripts used for validation and rule enforcement.

## Usage

```bash
npx shzm dump <files_or_dirs> 
```

This will parse .js and .spec.js file(s) in the given files/directories and emit the parsed content as JSON to stdout.
This output will allow one to write reasonably complex validation rules without having to worry about source parsing.

Examples of validations than can be implemented with minimal effort:
* Detecting duplicate command definitions
* Identifying (and auto-deleting) unused commands
* Enforcing test naming and organisation conventions
* e.t.c.

The output will be in the following format, with an entry for every parsed file:
```text
{
  "path/to/file.js": {
    "functions": [], // Array of FunctionObj (see definition below)
    "tests": []  // Array of TestObj (see definition below)
    "hooks": {
      "before": [],      // Array of HookObj (see definition below)
      "beforeEach": [],  // Array of HookObj (see definition below)
      "after": [],       // Array of HookObj (see definition below)
      "afterEach": []    // Array of HookObj (see definition below)
    }
  }
}
```

* _"functions"_ will list out all functions exported from the file.
   * For now, we only recognise a subset of possible ways to export a function
     ```javascript
     // exporting a function declaration
     export function funcName() { /* ... */ }
     export const funcName = await () => { /* ... */ }
     
     // default exports kinda work, but stored as original func name not "default"
     function funcX() { /* ... */ }
     export default funcX; 
     ```
* _"tests"_ will list out all the `it(...)` tests defined in that file, with the hierarchy of `describe()` captured 
  under the `scope` attribute.
* _"hooks"_ will list out all support hooks (`beforeEach`, `beforeAll`, `afterEach`, `afterAll`) defined in that file, 
  with the hierarchy of `describe()` captured under the `scope` attribute.
  
**`FunctionObj`:**
```text
{
  "name": String,  // name of the function
  "start": Number, // char offset in file where function definition starts
  "end": Number,   // char offset in file where function definition ends
  "exportStart": Number, // char offset in file where function export starts. Same as "start" if exported on declaration.
  "exportEnd": Number,   // char offset in file where function definition ends. Same as "end" if exported on declaration.
  "funcStart": Number, // char offset in file where function implementation block starts
  "funcEnd": Number, // char offset in file where function implementation block ends
  "calls": Array[CallObj], // Function calls made by this function
  "async"?: Boolean, // If function is async
}
```

**`TestObj`:**
```text
{
  "scope": Array[ScopeObj], // Describes nesting scope
  "start": Number, // char offset in file where definition starts
  "end": Number,   // char offset in file where definition ends
  "funcStart": Number, // char offset in file where definition of test implementation function starts
  "funcEnd": Number, // char offset in file where definition of test implementation function ends
  "async"?: Boolean, // If function is async
  "skip"?: Boolean, // If this test was effectively skipped, either by it.skip or describe.skip on parent scope
  "only"?: Boolean, // If this test was effectively set to "only", either by it.only or describe.only on parent scope
  "iosOnly"?: Boolean, // If this test was effectively limited to iOS, either by it.ios/it.iosOnly or describe.ios/descrive.iosOnly on parent scope
  "androidOnly"?: Boolean, // If this test was effectively limited to Android, either by it.android/it.androidOnly or describe.android/descrive.androidOnly on parent scope
  "calls": Array[CallObj], // Function calls made by this test
  "tryStatements": Array[TryObj], // Try-catch/finally blocks within the test implementation
}
```

**`HookObj`:**
```text
{
  "scope": Array[ScopeObj], // Describes nesting scope
  "start": Number, // char offset in file where definition starts
  "end": Number,   // char offset in file where definition ends
  "funcStart": Number, // char offset in file where definition of hook implementation function starts
  "funcEnd": Number, // char offset in file where definition of hook implementation function ends
  "async"?: Boolean, // If function is async
  "calls": Array[CallObj], // Function calls made by this test
  "tryStatements": Array[TryObj], // Try-catch/finally blocks within the test implementation
}
```

**`CallObj`:**
```text
{
  "name": String,  // name of the function.
  "start": Number, // char offset in file where function call starts
  "rootStart": Number, // if call is part of a chain of calls, this will be where it all started
  "end": Number,   // char offset in file where function definition ends
  "await"?: Boolean, // If call is awaited on
  "arguments": Array[ArgumentObj], // type and char offsets for function call arguments 
  "literalArguments"?: Object, // Actual values of arguments if they can be evaluated statically, indexed by argument index
  "apiSyncDisabled"?: Boolean, // If api call with sync=false
  "apiWaitAfter"?: Boolean, // If is api call with waitAfter=true
  "errors"?: Array[DeferredErrorObj], // If parser found issues that should not stop parsing but worth noting
}
```

Note that if the function call was part of a chain of calls, _"name"_ would capture that chain. For example:
```javascript
await assertSomething(); // name = "assertSomething"
await this.setup(); // name = "this.setup"
await api({ sync: false }).myFuncCall(/* params */); // name = "api().myFuncCall"
await someLib.init().helpers.doSomething().decode(); // name = "someLib.init().helpers.doSomething().decode"
```

**`ScopeObj`:**
```text
{
  "func":  "it" | "it.only" | "it.skip" |  "describe" | "describe.only" | "describe.skip",
  "name": String,   // Text description 
  "start": Number,  // char offset in file where definition starts
  "end": Number,    // char offset in file where definition ends
  "skip"?: Boolean, // If .skip
  "only"?: Boolean, // If .only
  "iosOnly"?: Boolean, // If limited to iOS
  "androidOnly"?: Boolean, // If limited to Android
}
```

**`TryObj`:**
```text
{
  "start": Number,  // char offset in file where try-catch/finally block starts
  "end": Number,    // char offset in file where try-catch/finally block ends
}
```

**`ArgumentObj`:**
```text
{
  "type": String,  // node type for the argument, e.g. "ObjectExpression", "ArrowFunctionExpression", etc
  "start": Number,  // char offset in file where argument starts
  "end": Number,    // char offset in file where argument ends
}
```

**`DeferredErrorObj`:**
```text
{
  "message": String,  // Error message
  "loc": Number,    // char offset in file where error was detected
}
```

