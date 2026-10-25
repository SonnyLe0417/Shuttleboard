import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
export function allowedControl(req, port) {
  return (
    req.method === "POST" &&
    [`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin) &&
    req.headers.host === new URL(req.headers.origin).host &&
    req.headers["sec-fetch-site"] !== "cross-site"
  );
}
export async function instrumentHtml(bytes, build, fingerprint) {
  const script = await readFile(new URL("./measure-client.js", import.meta.url), "utf8");
  const tag = `<script data-build="${build}" data-fingerprint="${fingerprint}">${script}</script>`;
  return Buffer.from(bytes.toString().replace(/<head([^>]*)>/i, `$&${tag}`));
}
export const fingerprint = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);
