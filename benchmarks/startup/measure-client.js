/* Local preview only. Never imported by the application. */
(() => {
  const config = document.currentScript.dataset;
  const key = "shuttleboard.startup-measure.v1";
  let state;
  try {
    state = JSON.parse(sessionStorage.getItem(key)) || {};
  } catch {
    state = {};
  }
  state.samples ||= [];
  if (state.protocol !== 3) {
    delete state.run;
    state.protocol = 3;
  }
  state.batches ||= [];
  const limited = () =>
    !!state.session &&
    (Date.now() - state.session.startedAt >= 1200000 || state.session.navigations >= 80);
  const fresh = () =>
    !state.run ||
    state.run.kind !== "cached-return" ||
    state.run.preparing ||
    Date.now() - state.run.freshAt < 40000;
  function stop(reason) {
    clearTimeout(timer);
    timer = null;
    if (state.run)
      state.batches.push({
        id: state.run.id,
        sessionId: state.session?.id,
        build: config.build,
        scenario: state.run.kind,
        status: reason,
      });
    delete state.run;
    state.stopReason = reason;
    save();
    show();
  }
  function startBatch(kind) {
    if (limited()) {
      stop("limit-reached");
      return;
    }
    state.session ||= { id: crypto.randomUUID(), startedAt: Date.now(), navigations: 0 };
    state.run = { id: crypto.randomUUID(), kind, index: 0, preparing: kind === "cached-return" };
    save();
    if (state.run.preparing) reloadDocument();
    else next();
  }
  const visible = () => document.visibilityState === "visible";
  function reloadDocument() {
    // A collector-requested reload can hide/resize the outgoing document
    // before pagehide. The incoming document checks visibility and size anew.
    departing = true;
    location.reload();
  }
  const stable = () =>
    !state.viewport ||
    (innerWidth === state.viewport.width && innerHeight === state.viewport.height);
  let sample,
    frame,
    timer,
    hidden = document.visibilityState !== "visible";
  let failures = 0,
    resourceErrors = 0,
    panel,
    disposed = false,
    departing = false;
  const save = () => {
    state.samples = state.samples.slice(-120);
    sessionStorage.setItem(key, JSON.stringify(state));
  };
  const onDashboard = () => location.pathname.replace(/\/$/, "") === "/dashboard";
  const persist = () => {
    if (!sample) return;
    const index = state.samples.findIndex((x) => x.id === sample.id);
    if (index < 0) state.samples.push(sample);
    else state.samples[index] = sample;
    save();
  };
  function begin(scenario, start) {
    if (disposed) return;
    clearTimeout(timer);
    timer = null;
    failures = 0;
    resourceErrors = 0;
    sample = {
      id: crypto.randomUUID(),
      build: config.build,
      fingerprint: config.fingerprint,
      scenario,
      warmup: state.run?.index === 0,
      readyMs: null,
      summaryMs: null,
      classification: "pending",
      backgrounded: hidden,
      failures: 0,
      resourceErrors: 0,
      start,
      hookSetupMs: null,
      scheduled:
        !!state.run && !state.run.paused && state.run.kind === scenario && !state.run.preparing,
      viewport: { width: innerWidth, height: innerHeight },
      elapsedSinceDocumentMs: start,
      protocol: 3,
      batchId: state.run?.id ?? null,
      sessionId: state.session?.id ?? null,
      sampleIndex: state.run?.index ?? null,
      cacheWindowValid: fresh(),
      sessionElapsedMs: state.session ? Date.now() - state.session.startedAt : null,
      navigationNumber: state.session ? state.session.navigations + 1 : null,
    };
    if (state.session) state.session.navigations++;
    persist();
  }
  const setupStart = performance.now();
  performance.setResourceTimingBufferSize(3000);
  if (onDashboard()) begin("reload", 0);
  document.addEventListener("visibilitychange", () => {
    // pagehide precedes the outgoing document's hidden event on reload. Its
    // lifecycle must not pause the batch inherited by the incoming document.
    if (departing) return;
    hidden = !visible();
    if (sample?.classification === "pending") {
      sample.backgrounded ||= hidden;
      persist();
      if (hidden) finish("backgrounded");
    }
    if (hidden && state.run) {
      clearTimeout(timer);
      timer = null;
      state.run.paused = true;
      save();
      show();
    }
  });
  addEventListener("resize", () => {
    if (departing) return;
    if (!stable() && sample?.classification === "pending") {
      sample.interruptionViewport = { width: innerWidth, height: innerHeight };
      finish("viewport-changed");
    }
    if (!stable() && state.run) {
      clearTimeout(timer);
      timer = null;
      state.run.paused = true;
      save();
      show();
    }
  });
  addEventListener(
    "error",
    (event) => {
      if (event.target !== window) resourceErrors++;
      else failures++;
    },
    true,
  );
  addEventListener("unhandledrejection", () => failures++);
  document.addEventListener(
    "click",
    (event) => {
      if (event.target.closest?.('a[href="/history"]') && sample?.classification === "pending")
        finish("interrupted");
      const link = event.target.closest?.('a[href="/dashboard"]');
      if (link && !onDashboard()) {
        hidden = document.visibilityState !== "visible";
        begin("cached-return", performance.now());
      }
    },
    true,
  );
  function finish(reason) {
    if (!sample || sample.classification !== "pending") return;
    if (reason === "complete" && sample.scenario === "cached-return" && !fresh())
      reason = "cache-window-expired";
    sample.classification = reason;
    sample.failures = failures;
    sample.resourceErrors = resourceErrors;
    const entries = performance
      .getEntriesByType("resource")
      .filter((x) => x.startTime >= sample.start);
    const navigation = performance.getEntriesByType("navigation")[0];
    sample.requests = entries.length + (sample.scenario === "reload" ? 1 : 0);
    sample.exposedTransferBytes =
      entries.reduce((n, x) => n + x.transferSize, 0) +
      (sample.scenario === "reload" ? navigation?.transferSize || 0 : 0);
    sample.javascriptTransferBytes = entries
      .filter((x) => /\.js(?:\?|$)/.test(x.name))
      .reduce((n, x) => n + x.transferSize, 0);
    sample.zeroOrUnavailableTransferEntries = entries.filter((x) => x.transferSize === 0).length;
    sample.resourceDurationsMs = entries.map((x) => x.duration);
    sample.document =
      sample.scenario === "reload" && navigation
        ? {
            responseStartMs: navigation.responseStart,
            domContentLoadedMs: navigation.domContentLoadedEventEnd,
            loadMs: navigation.loadEventEnd,
          }
        : null;
    delete sample.start;
    persist();
    show();
    if (state.run?.preparing && reason === "complete" && sample.scenario === "reload") {
      state.run.preparing = false;
      state.run.freshAt = Date.now();
      save();
      timer = setTimeout(next, 250);
      return;
    }
    if (state.run && sample.scheduled && reason === "complete") {
      state.run.index++;
      if (state.run.index >= 11) {
        stop("complete");
        return;
      }
      save();
      timer = setTimeout(next, 250);
    } else if (state.run && ["backgrounded", "viewport-changed"].includes(reason)) {
      clearTimeout(timer);
      timer = null;
      state.run.paused = true;
      save();
      show();
    } else if (state.run && (sample.scheduled || state.run.preparing)) {
      stop(reason);
    }
  }
  function next() {
    if (!state.run || disposed) return;
    if (limited()) {
      stop("limit-reached");
      return;
    }
    if (!fresh()) {
      stop("cache-window-expired");
      return;
    }
    if (!visible() || !stable() || state.run.paused) {
      state.run.paused = true;
      save();
      show();
      return;
    }
    if (state.run.preparing) {
      reloadDocument();
      return;
    }
    if (state.run?.kind === "reload") reloadDocument();
    else if (state.run?.kind === "cached-return") {
      document.querySelector('a[href="/history"]')?.click();
      const deadline = performance.now() + 10000;
      const returnHome = () => {
        if (limited()) {
          stop("limit-reached");
          return;
        }
        if (!fresh()) {
          stop("cache-window-expired");
          return;
        }
        if (!state.run || state.run.paused || !visible() || !stable()) {
          if (state.run) {
            state.run.paused = true;
            save();
            show();
          }
          return;
        }
        if (location.pathname === "/history") {
          document.querySelector('a[href="/dashboard"]')?.click();
        } else if (performance.now() < deadline) timer = setTimeout(returnHome, 50);
        else {
          delete state.run;
          save();
          show();
        }
      };
      timer = setTimeout(returnHome, 100);
    }
  }
  function show() {
    if (
      !document.body ||
      (!panel &&
        !state.stopReason &&
        !state.run?.paused &&
        !document.querySelector('[data-dashboard-ready="true"]'))
    )
      return;
    if (!panel) {
      panel = document.createElement("section");
      panel.setAttribute("aria-label", "Local startup measurements");
      panel.style.cssText =
        "position:fixed;bottom:8px;right:8px;z-index:99999;background:white;color:black;border:1px solid #888;padding:12px;max-width:340px;font:12px monospace";
      const status = document.createElement("div");
      status.dataset.startupMeasureStatus = "";
      panel.append(status);
      for (const kind of ["reload", "cached-return"]) {
        const button = document.createElement("button");
        button.textContent = `Measure ${kind}`;
        button.style.cssText = "padding:12px;border:1px solid;margin:4px";
        button.onclick = () => {
          if (state.run) return;
          if (!visible() || !stable()) return;
          state.viewport ||= { width: innerWidth, height: innerHeight };
          startBatch(kind);
          show();
        };
        panel.append(button);
      }
      const resume = document.createElement("button");
      resume.textContent = "Resume visible run";
      resume.onclick = () => {
        if (!state.run?.paused || !visible() || !stable()) return;
        if (limited()) {
          stop("limit-reached");
          return;
        }
        if (!fresh()) {
          const kind = state.run.kind;
          stop("cache-window-expired");
          startBatch(kind);
          return;
        }
        state.run.paused = false;
        save();
        next();
        show();
      };
      panel.append(resume);
      const clear = document.createElement("button");
      clear.textContent = "Clear local measurements";
      clear.onclick = () => {
        clearTimeout(timer);
        cancelAnimationFrame(frame);
        disposed = true;
        sample = undefined;
        sessionStorage.removeItem(key);
        state = { samples: [] };
        panel.remove();
      };
      panel.append(clear);
      const download = document.createElement("button");
      download.textContent = "Export measurements";
      download.onclick = () => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(
          new Blob(
            [
              JSON.stringify(
                {
                  schema: 2,
                  samples: state.samples,
                  batches: state.batches,
                  stopReason: state.stopReason ?? null,
                },
                null,
                2,
              ),
            ],
            {
              type: "application/json",
            },
          ),
        );
        link.download = "startup-account-foreground-measurements.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      };
      panel.append(download);
      const output = document.createElement("textarea");
      output.setAttribute("aria-label", "Measurement export");
      output.readOnly = true;
      output.style.cssText = "display:block;width:100%;height:60px";
      panel.append(output);
    }
    if (!panel.isConnected) document.body.append(panel);
    panel.querySelector("[data-startup-measure-status]").textContent =
      `${config.build}: ${state.run ? `${state.run.paused ? "paused " : ""}${state.run.kind} ${state.run.index}/11` : state.stopReason || "idle"}; ${state.samples.length} samples; viewport ${state.viewport ? `${state.viewport.width}x${state.viewport.height}` : "unlocked"}`;
    panel.querySelector("textarea").value = JSON.stringify({
      schema: 2,
      samples: state.samples,
      batches: state.batches,
      stopReason: state.stopReason ?? null,
    });
  }
  const observe = () => {
    if (sample && sample.classification !== "pending" && (!panel || !panel.isConnected)) show();
    if (sample?.classification === "pending" && onDashboard()) {
      if (!visible()) {
        sample.backgrounded = true;
        finish("backgrounded");
        frame = requestAnimationFrame(observe);
        return;
      }
      if (!stable()) {
        sample.interruptionViewport = { width: innerWidth, height: innerHeight };
        finish("viewport-changed");
        frame = requestAnimationFrame(observe);
        return;
      }
      const now = performance.now();
      if (sample.readyMs === null && document.querySelector('[data-dashboard-ready="true"]'))
        sample.readyMs = now - sample.start;
      if (sample.summaryMs === null && document.querySelector('[data-dashboard-summary="ready"]'))
        sample.summaryMs = now - sample.start;
      if (sample.readyMs !== null && sample.summaryMs !== null && !timer)
        timer = setTimeout(() => {
          timer = null;
          finish("complete");
        }, 800);
      if (now - sample.start > 30000) finish("timeout");
    }
    frame = requestAnimationFrame(observe);
  };
  frame = requestAnimationFrame(observe);
  if (sample) sample.hookSetupMs = performance.now() - setupStart;
  addEventListener("pagehide", () => {
    departing = true;
    finish("interrupted");
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  });
})();
