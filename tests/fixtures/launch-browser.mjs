import { chromium } from "playwright";

// The browser suites were written against Edge on Windows. Use it when it is
// installed, otherwise Chrome or Playwright's own Chromium, so the same tests
// run on macOS and Linux. PLAYWRIGHT_CHANNEL picks one explicitly.
export async function launchChromium() {
  const preferred = process.env.PLAYWRIGHT_CHANNEL ? [process.env.PLAYWRIGHT_CHANNEL] : [];
  const failures = [];
  for (const channel of new Set([...preferred, "msedge", "chrome", undefined])) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (error) {
      failures.push(`${channel ?? "bundled chromium"}: ${error.message.split("\n")[0]}`);
    }
  }
  throw new Error(`No Chromium browser could start.\n${failures.join("\n")}`);
}
