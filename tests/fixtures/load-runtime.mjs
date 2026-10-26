import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
export async function loadRuntime(file, modules = {}, globals = {}) {
  const code = ts.transpileModule(await readFile(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(code, {
    exports,
    require: (name) => (name in modules ? modules[name] : require(name)),
    Request,
    Response,
    Headers,
    URL,
    Date,
    AbortSignal,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    console,
    process: { env: {} },
    ...globals,
  });
  return exports;
}
