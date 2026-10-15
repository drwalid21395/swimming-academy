/**
 * Loads the TypeScript export modules directly so the workbook output can be
 * checked against the real implementation rather than a copy of it.
 *
 * The two modules use `@/lib/*` imports, so a tiny loader rewrites them to real
 * paths and transpiles with the project's own TypeScript before evaluating.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = process.cwd();
const cache = new Map();

function resolveAlias(request, fromDir) {
  if (request.startsWith("@/lib/")) {
    return path.join(root, "src", "lib", request.slice("@/lib/".length) + ".ts");
  }
  if (request.startsWith("@/")) {
    return path.join(root, "src", request.slice("@/".length) + ".ts");
  }
  // Sibling imports inside `src/lib` are written relative and carry no extension,
  // so point them at the `.ts` file the bundler would have picked.
  if (request.startsWith(".")) {
    const base = path.resolve(fromDir, request);
    if (fs.existsSync(`${base}.ts`)) return `${base}.ts`;
    if (fs.existsSync(path.join(base, "index.ts"))) return path.join(base, "index.ts");
  }
  return request;
}

function loadTs(file) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved).exports;

  const source = fs.readFileSync(resolved, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: resolved,
  }).outputText;

  const mod = new Module(resolved, null);
  mod.filename = resolved;
  mod.paths = Module._nodeModulePaths(path.dirname(resolved));
  const fromDir = path.dirname(resolved);
  mod.require = (request) => {
    const mapped = resolveAlias(request, fromDir);
    if (mapped.endsWith(".ts")) return loadTs(mapped);
    return Module.prototype.require.call(mod, request);
  };

  cache.set(resolved, mod);
  mod._compile(compiled, resolved);
  return mod.exports;
}

module.exports = { loadTs };