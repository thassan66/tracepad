(() => {
  if (window.__TRACEPAD_CONTENT_ACTIVE__) {
    return;
  }
  window.__TRACEPAD_CONTENT_ACTIVE__ = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "tracepad:capture-context") {
      sendResponse(captureContext());
    }
    if (message && message.type === "tracepad:capture-page") {
      sendResponse(capturePage());
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

  function capturePage() {
    const selectedText = getSelectedText();
    const pageText = collectVisiblePageText();
    const logText = collectHighSignalText();
    const headings = collectHeadings();
    const summaryParts = [];
    if (headings.length > 0) {
      summaryParts.push(`Headings: ${headings.join(" | ")}`);
    }
    if (selectedText) {
      summaryParts.push(`Selected: ${selectedText}`);
    }
    if (logText) {
      summaryParts.push(`Logs/details:\n${logText}`);
    }
    if (pageText) {
      summaryParts.push(`Visible page text:\n${pageText}`);
    }

    return {
      title: document.title || "",
      url: location.href,
      selectedText,
      pageText,
      logText,
      headings,
      message: summaryParts.join("\n\n"),
      capturedAt: new Date().toISOString(),
    };
  }

  function getSelectedText() {
    const selection = window.getSelection && window.getSelection();
    return selection ? String(selection.toString()).trim() : "";
  }

  function collectVisiblePageText() {
    const candidates = [
      "main",
      "[role='main']",
      "[role='log']",
      "[role='table']",
      "[role='grid']",
      ".logs",
      ".log",
      ".terminal",
      ".console",
      ".events",
      ".details",
      "pre",
      "code",
      "table",
      "section",
      "article",
    ];
    const chunks = [];
    for (const selector of candidates) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        if (!isVisible(element)) {
          continue;
        }
        const text = normalizeText(element.innerText || element.textContent || "");
        if (text && !chunks.includes(text)) {
          chunks.push(text);
        }
        if (chunks.join("\n\n").length > 12000) {
          return limitText(chunks.join("\n\n"), 12000);
        }
      }
    }
    if (chunks.length === 0 && document.body && isVisible(document.body)) {
      chunks.push(normalizeText(document.body.innerText || document.body.textContent || ""));
    }
    return limitText(chunks.join("\n\n"), 12000);
  }

  function collectHighSignalText() {
    const selectors = [
      "pre",
      "code",
      "[role='log']",
      "[aria-live]",
      ".log",
      ".logs",
      ".console",
      ".terminal",
      ".stacktrace",
      ".stack-trace",
      ".events",
      ".details",
      ".message",
      ".error",
      ".warning",
      ".warn",
      ".failure",
      ".failed",
    ];
    const chunks = [];
    for (const selector of selectors) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        if (!isVisible(element)) {
          continue;
        }
        const text = normalizeText(element.innerText || element.textContent || "");
        if (text && !chunks.includes(text)) {
          chunks.push(text);
        }
        if (chunks.join("\n\n").length > 8000) {
          return limitText(chunks.join("\n\n"), 8000);
        }
      }
    }
    return limitText(chunks.join("\n\n"), 8000);
  }

  function collectHeadings() {
    return Array.from(document.querySelectorAll("h1,h2,h3,[role='heading']"))
      .filter(isVisible)
      .map((element) => normalizeText(element.innerText || element.textContent || ""))
      .filter(Boolean)
      .slice(0, 12);
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  }

  function limitText(value, maxLength) {
    const text = String(value || "").trim();
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}\n[Tracepad truncated page text at ${maxLength} characters]`;
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
