(() => {
  if (window.__TRACEPAD_PAGE_HOOK_ACTIVE__) {
    return;
  }
  window.__TRACEPAD_PAGE_HOOK_ACTIVE__ = true;

  patchConsole("error");
  patchConsole("warn");

  function patchConsole(level) {
    const original = console[level];
    if (typeof original !== "function") {
      return;
    }
    console[level] = function tracepadConsolePatch(...args) {
      postConsole(level, args);
      return original.apply(this, args);
    };
  }

  function postConsole(level, args) {
    window.postMessage(
      {
        source: "tracepad-page-hook",
        payload: {
          type: "console",
          level,
          message: args.map(formatArg).join(" "),
          at: new Date().toISOString(),
        },
      },
      "*"
    );
  }

  function formatArg(value) {
    if (value instanceof Error) {
      return value.stack || value.message;
    }
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }
})();
