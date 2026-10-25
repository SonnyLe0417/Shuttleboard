import { Worker } from "node:worker_threads";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";

export async function buildFingerprint(root) {
  const hash = createHash("sha256");
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const bytes = await readFile(file);
        hash.update(relative(root, file).replaceAll("\\", "/") + "\0" + bytes.length + "\0");
        hash.update(bytes);
      }
    }
  }
  await walk(resolve(root, "server"));
  await walk(resolve(root, "public"));
  return hash.digest("hex").slice(0, 16);
}

export class BuildRuntime {
  #pending = new Map();
  #id = 0;
  closed = false;
  constructor(root, env) {
    this.worker = new Worker(new URL("./build-worker.mjs", import.meta.url), {
      workerData: { root, env },
      stdout: true,
      stderr: true,
    });
    // App logs may contain account data. The coordinator reports fixed errors only.
    this.worker.stdout.resume();
    this.worker.stderr.resume();
    let accept, reject;
    this.ready = new Promise((done, fail) => {
      accept = done;
      reject = fail;
    });
    this.worker.on("message", (message) => {
      if (message.ready) {
        accept();
        return;
      }
      if (message.startupFailed) {
        this.#fail(reject);
        return;
      }
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.failed) pending.reject(new Error("Saved build request failed"));
      else pending.resolve(message);
    });
    this.worker.on("error", () => this.#fail(reject));
    this.worker.on("exit", () => this.#fail(reject));
  }
  #fail(rejectReady) {
    this.closed = true;
    rejectReady(new Error("Saved build runtime unavailable"));
    for (const pending of this.#pending.values())
      pending.reject(new Error("Saved build runtime unavailable"));
    this.#pending.clear();
  }
  async fetch(request) {
    await this.ready;
    if (this.closed) throw new Error("Saved build runtime unavailable");
    const body = ["GET", "HEAD"].includes(request.method)
      ? undefined
      : new Uint8Array(await request.arrayBuffer());
    if (this.closed) throw new Error("Saved build runtime unavailable");
    return new Promise((resolve, reject) => {
      const id = ++this.#id;
      this.#pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({
          id,
          url: request.url,
          method: request.method,
          headers: [...request.headers],
          body,
        });
      } catch {
        this.#pending.delete(id);
        reject(new Error("Saved build request failed"));
      }
    });
  }
  async close() {
    // The exit handler rejects startup and all outstanding requests.
    await this.worker.terminate();
  }
}

export function buildRegistry(env) {
  const runtimes = new Map();
  let closed = false;
  return {
    async get(root) {
      if (closed) throw new Error("Preview is closing");
      root = resolve(root);
      let entry = runtimes.get(root);
      if (entry && !entry.runtime?.closed) return entry.ready;
      entry = {};
      entry.ready = (async () => {
        const fingerprint = await buildFingerprint(root);
        if (closed) throw new Error("Preview is closing");
        const runtime = new BuildRuntime(root, env);
        entry.runtime = runtime;
        try {
          await runtime.ready;
        } catch (error) {
          await runtime.close();
          throw error;
        }
        return { root, runtime, fingerprint };
      })();
      runtimes.set(root, entry);
      try {
        return await entry.ready;
      } catch (error) {
        if (runtimes.get(root) === entry) runtimes.delete(root);
        throw error;
      }
    },
    async close() {
      closed = true;
      await Promise.allSettled(
        [...runtimes.values()].map(async (entry) => {
          await entry.runtime?.close();
          await entry.ready;
        }),
      );
      runtimes.clear();
    },
  };
}
