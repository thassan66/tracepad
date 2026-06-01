(() => {
  if (window.__TRACEPAD_CONTENT_ACTIVE__) {
    return;
  }
  window.__TRACEPAD_CONTENT_ACTIVE__ = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "tracepad:capture-context") {
      sendResponse(captureContext());
    }
    return false;
  });

  window.addEventListener(
    "error",
    (event) => {
      sendBrowserEvent({
        type: "console",
        level: "error",
        message: event.message || "Unhandled browser error",
        at: new Date().toISOString(),
      });
    },
    true
  );

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      sendBrowserEvent({
        type: "console",
        level: "error",
        message: formatReason(event.reason) || "Unhandled promise rejection",
        at: new Date().toISOString(),
      });
    },
    true
  );

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "tracepad-page-hook") {
      return;
    }
    sendBrowserEvent(event.data.payload || {});
  });

  injectPageHook();

  function captureContext() {
    return {
      title: document.title || "",
      url: location.href,
      selectedText: getSelectedText(),
      capturedAt: new Date().toISOString(),
    };
  }

  function getSelectedText() {
    const selection = window.getSelection && window.getSelection();
    return selection ? String(selection.toString()).trim() : "";
  }

  function sendBrowserEvent(event) {
    chrome.runtime.sendMessage({
      type: "tracepad:browser-event",
      event: {
        ...event,
        title: document.title || "",
        url: location.href,
        at: event.at || new Date().toISOString(),
      },
    });
  }

  function injectPageHook() {
    const root = document.documentElement || document.head || document.body;
    if (!root) {
      document.addEventListener("DOMContentLoaded", injectPageHook, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-hook.js");
    script.async = false;
    script.onload = () => script.remove();
    root.appendChild(script);
  }

  function formatReason(reason) {
    if (!reason) {
      return "";
    }
    if (typeof reason === "string") {
      return reason;
    }
    if (reason.message) {
      return reason.message;
    }
    try {
      return JSON.stringify(reason);
    } catch (error) {
      return String(reason);
    }
  }
})();
