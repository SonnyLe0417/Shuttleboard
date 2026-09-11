// Node 24 strips TypeScript; resolve the app's aliases for focused tests and repair scripts.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/"))
      specifier = pathToFileURL(path.join(root, "src", specifier.slice(2))).href;
    if (
      specifier.startsWith("file:") ||
      (specifier.startsWith(".") && context.parentURL?.startsWith("file:"))
    ) {
      const url = new URL(specifier, context.parentURL);
      const local = fileURLToPath(url);
      if (local.includes(path.sep + "node_modules" + path.sep))
        return nextResolve(specifier, context);
      if (!path.extname(local) || local.endsWith(".server")) {
        for (const extension of [".ts", ".tsx", ".js"]) {
          if (existsSync(local + extension))
            return nextResolve(pathToFileURL(local + extension).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
