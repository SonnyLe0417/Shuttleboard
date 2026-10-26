import projectConfig from "../../vite.config.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export default async (env) => {
  const config = await projectConfig(env);
  config.plugins.unshift({
    name: "startup-benchmark-adapters",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0].replaceAll("\\", "/");
      if (file.endsWith("/src/integrations/supabase/client.ts"))
        return readFileSync(resolve("benchmarks/startup/session.ts"), "utf8");
      if (/\/src\/lib\/[^/]+\.functions\.ts$/.test(file)) {
        const names = [...code.matchAll(/export (?:const|(?:async )?function)\s+(\w+)/g)].map(
          (m) => m[1],
        );
        return names
          .map(
            (name) =>
              `export const ${name} = async (input) => { const response=await fetch('/__startup-fixture/${name}?count='+new URLSearchParams(location.search).get('count'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input??{})});if(!response.ok)throw Error('Synthetic request failed');return response.json();};`,
          )
          .join("\n");
      }
    },
  });
  return config;
};
