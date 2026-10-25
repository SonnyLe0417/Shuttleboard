import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { createStartupServer } from "../benchmarks/startup/server.mjs";
import {
  BuildRuntime,
  buildFingerprint,
  buildRegistry,
} from "../benchmarks/startup/build-runtime.mjs";

async function fixture(parent, name, source) {
  const root = resolve(parent, name);
  await mkdir(resolve(root, "server"), { recursive: true });
  await mkdir(resolve(root, "public/assets"), { recursive: true });
  await writeFile(resolve(root, `public/assets/${name}.js`), `// ${name}`);
  if (source !== null)
    await writeFile(
      resolve(root, "server/index.mjs"),
      source ??
        `
    globalThis.previewBuild=${JSON.stringify(name)};
    export default {async fetch(request, env) {
      const path=new URL(request.url).pathname;
      if(path==='/hang') { globalThis.pendingRequest=true; return new Promise(()=>{}); }
      if(path==='/started') return new Response(String(globalThis.pendingRequest===true));
      if(path==='/exit') process.exit(1);
      if(path.startsWith('/assets/')) return env.ASSETS.fetch(request);
      if(path==='/slow') await new Promise(resolve=>setTimeout(resolve,100));
      if(path==='/echo') { const headers=new Headers(); headers.append('set-cookie','one=synthetic; Path=/'); headers.append('set-cookie','two=synthetic; Path=/'); return new Response(await request.text(),{headers}); }
      return new Response('<html><head><script src="/assets/'+globalThis.previewBuild+'.js"></script></head><body>ready</body></html>',{headers:{'content-type':'text/html'}});
    }};
  `,
    );
  return root;
}
async function temp(t) {
  const root = await mkdtemp(resolve(tmpdir(), "shuttleboard-worker-test-"));
  t.after(async () => {
    if (
      dirname(root) !== resolve(tmpdir()) ||
      !basename(root).startsWith("shuttleboard-worker-test-")
    )
      throw Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function preview(t, root, buildRoots, env = {}) {
  const app = await createStartupServer({ root, buildRoots, env, measurementAvailable: true });
  t.after(() => app.close());
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return {
    url,
    app,
    switch: (build) =>
      fetch(url + "/__startup-measure", {
        method: "POST",
        headers: { origin: url, "content-type": "application/x-www-form-urlencoded" },
        body: `build=${build}`,
        redirect: "manual",
      }),
  };
}
const assets = (html) => [...new Set(html.match(/\/assets\/[a-zA-Z0-9_.-]+\.js/g) ?? [])].sort();
const identity = (html) => html.match(/data-fingerprint="([a-f0-9]+)"/)?.[1];

test("isolated runtimes restore both build identities and serve every asset across round trips", async (t) => {
  const root = await temp(t);
  const baseline = await fixture(root, "baseline"),
    optimized = await fixture(root, "optimized");
  const p = await preview(t, baseline, { baseline, optimized });
  const identities = new Map();
  for (const name of ["baseline", "optimized", "baseline", "optimized"]) {
    assert.equal((await p.switch(name)).status, 303);
    const html = await (await fetch(p.url + "/dashboard")).text();
    assert.ok(html.includes(`data-build="${name}"`));
    assert.deepEqual(assets(html), [`/assets/${name}.js`]);
    assert.ok(identity(html));
    if (identities.has(name)) assert.equal(identity(html), identities.get(name));
    identities.set(name, identity(html));
    for (const asset of assets(html)) assert.equal((await fetch(p.url + asset)).status, 200);
  }
  assert.notEqual(identities.get("baseline"), identities.get("optimized"));
  const response = await fetch(p.url + "/echo", { method: "POST", body: "synthetic payload" });
  assert.equal(await response.text(), "synthetic payload");
  assert.equal(response.headers.getSetCookie().length, 2);
});

test("switch failure retains the working build, in-flight responses retain their label, and off disables injection", async (t) => {
  const root = await temp(t);
  const baseline = await fixture(root, "baseline"),
    optimized = await fixture(root, "optimized");
  const broken = await fixture(root, "broken", null);
  const p = await preview(t, baseline, { baseline, optimized: broken });
  assert.equal((await p.switch("optimized")).status, 500);
  assert.deepEqual(assets(await (await fetch(p.url + "/dashboard")).text()), [
    "/assets/baseline.js",
  ]);
  const p2 = await preview(t, baseline, { baseline, optimized });
  // Start a response and switch while that response is still pending.
  const pending = fetch(p2.url + "/slow");
  await new Promise((resolve) => setTimeout(resolve, 30));
  await p2.switch("optimized");
  const html = await (await pending).text();
  assert.ok(html.includes('data-build="baseline"'));
  assert.deepEqual(assets(html), ["/assets/baseline.js"]);
  await p2.switch("off");
  const finished = await (await fetch(p2.url + "/dashboard")).text();
  assert.deepEqual(assets(finished), ["/assets/optimized.js"]);
  assert.equal(finished.includes("shuttleboard.startup-measure.v1"), false);
});

test("fingerprints include server content, not only client URLs", async (t) => {
  const root = await fixture(await temp(t), "baseline");
  const first = await buildFingerprint(root);
  await writeFile(resolve(root, "server/extra.mjs"), "// server-only change");
  assert.notEqual(await buildFingerprint(root), first);
});

test(
  "coordinator shutdown settles an outstanding HTTP request and is idempotent",
  { timeout: 10000 },
  async (t) => {
    const root = await temp(t);
    const baseline = await fixture(root, "baseline"),
      optimized = await fixture(root, "optimized");
    const p = await preview(t, baseline, { baseline, optimized });
    const pending = fetch(p.url + "/hang").then(
      (response) => response.status,
      () => "closed",
    );
    let started = false;
    for (let i = 0; i < 100 && !started; i++) {
      started = (await (await fetch(p.url + "/started")).text()) === "true";
      if (!started) await new Promise((done) => setTimeout(done, 10));
    }
    assert.equal(started, true, "Hanging request reached its worker");
    await p.app.close();
    assert.ok([500, "closed"].includes(await pending));
    assert.equal(p.app.server.listening, false);
    await p.app.close();
  },
);

test("worker exit rejects outstanding requests and closing a registry terminates pending startup", async (t) => {
  const root = await temp(t);
  const build = await fixture(root, "baseline");
  const runtime = new BuildRuntime(build, {});
  t.after(() => runtime.close());
  await runtime.ready;
  const rejected = assert.rejects(
    runtime.fetch(new Request("http://localhost/hang")),
    /unavailable/,
  );
  await runtime.close();
  await rejected;
  await assert.rejects(runtime.fetch(new Request("http://localhost/")), /unavailable/);
  const crashed = new BuildRuntime(build, {});
  t.after(() => crashed.close());
  await crashed.ready;
  await assert.rejects(crashed.fetch(new Request("http://localhost/exit")), /unavailable/);
  assert.equal(crashed.closed, true);
  const slow = await fixture(root, "slow", "setInterval(()=>{},1000); await new Promise(()=>{});");
  const registry = buildRegistry({});
  const startup = assert.rejects(registry.get(slow));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await registry.close();
  await startup;
});

test(
  "real saved builds switch baseline/optimized/baseline without missing JavaScript",
  {
    skip:
      !existsSync("dist/startup/baseline/production/server/index.mjs") ||
      !existsSync("dist/startup/optimized/production/server/index.mjs"),
  },
  async (t) => {
    const { loadEnv } = await import("vite");
    const baseline = resolve("dist/startup/baseline/production"),
      optimized = resolve("dist/startup/optimized/production");
    const p = await preview(
      t,
      baseline,
      { baseline, optimized },
      loadEnv("production", process.cwd(), ""),
    );
    const seen = new Map();
    for (const name of ["baseline", "optimized", "baseline", "optimized"]) {
      assert.equal((await p.switch(name)).status, 303);
      const html = await (await fetch(p.url + "/dashboard")).text();
      const urls = assets(html);
      assert.ok(urls.length > 0);
      if (seen.has(name)) assert.deepEqual(urls, seen.get(name));
      seen.set(name, urls);
      for (const url of urls)
        assert.equal((await fetch(p.url + url)).status, 200, `${name} ${url}`);
    }
    assert.notDeepEqual(seen.get("baseline"), seen.get("optimized"));
  },
);
