const STATE_KEY = "tracepad.capture.state";
const SOURCE = "tracepad-browser-extension";
const requestStartTimes = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  handleCommand(command).catch((error) => {
    recordShortcutError(command, error).catch(() => {});
  });
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId >= 0) {
      requestStartTimes.set(details.requestId, details.timeStamp);
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0 || details.statusCode < 400) {
      requestStartTimes.delete(details.requestId);
      return;
    }
    recordNetworkEvent(details, "HTTP request completed with an error status").catch(() => {});
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId < 0) {
      requestStartTimes.delete(details.requestId);
      return;
    }
    recordNetworkEvent(details, details.error || "Network request failed").catch(() => {});
  },
  { urls: ["<all_urls>"] }
);

async function handleMessage(message, sender) {
  const type = message && message.type;
  if (type === "tracepad:start") {
    return startCapture();
  }
  if (type === "tracepad:stop") {
    return updateState({ recording: false, stoppedAt: isoNow() });
  }
  if (type === "tracepad:clear") {
    await chrome.storage.local.remove(STATE_KEY);
    return createEmptyState(false);
  }
  if (type === "tracepad:status") {
    return getState();
  }
  if (type === "tracepad:add-note") {
    return addManualNote(message.note || "");
  }
  if (type === "tracepad:capture-selection") {
    return captureSelection();
  }
  if (type === "tracepad:capture-page") {
    return capturePageContent(message.note || "");
  }
  if (type === "tracepad:capture-screenshot") {
    return captureScreenshot(message.note || "");
  }
  if (type === "tracepad:export") {
    return exportCapture();
  }
  if (type === "tracepad:browser-event") {
    return addBrowserEvent(message.event || {}, sender.tab);
  }
  throw new Error(`Unknown message type: ${type}`);
}

async function handleCommand(command) {
  if (command === "toggle-capture") {
    const state = await getState();
    if (state.recording) {
      await updateState({ recording: false, stoppedAt: isoNow() });
    } else {
      await startCapture();
    }
    return;
  }
  if (command === "capture-selection") {
    await captureSelection();
    return;
  }
  if (command === "capture-screenshot") {
    await captureScreenshot("Captured by keyboard shortcut");
    return;
  }
  if (command === "capture-page") {
    await capturePageContent("Captured by keyboard shortcut");
    return;
  }
  if (command === "add-note") {
    await promptForNote();
    return;
  }
  if (command === "export-capture") {
    await exportCapture();
    return;
  }
  if (command === "clear-capture") {
    await chrome.storage.local.remove(STATE_KEY);
    return;
  }
}

async function startCapture() {
  const active = await getActiveTab();
  const context = active ? await getTabContext(active) : null;
  const now = isoNow();
  const state = createEmptyState(true);
  state.capturedAt = now;
  state.startedAt = now;
  if (context) {
    upsertTab(state, context);
    state.events.push({
      type: "note",
      title: context.title,
      url: context.url,
      message: "Started browser capture",
      at: now,
    });
  }
  await saveState(state);
  return state;
}

async function addManualNote(note) {
  const text = String(note || "").trim();
  if (!text) {
    throw new Error("Note text is required.");
  }
  const state = await requireRecording();
  const active = await getActiveTab();
  const context = active ? await getTabContext(active) : {};
  if (context.url || context.title) {
    upsertTab(state, context);
  }
  state.events.push({
    type: "note",
    title: context.title || "",
    url: context.url || "",
    message: text,
    at: isoNow(),
  });
  await saveState(state);
  return state;
}

async function promptForNote() {
  const active = await getActiveTab();
  if (!active || typeof active.id !== "number" || !isInjectableUrl(active.url || "")) {
    throw new Error("Cannot prompt for a note on this page.");
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId: active.id },
    func: () => window.prompt("Tracepad note"),
  });
  const note = results && results[0] ? results[0].result : "";
  if (note) {
    await addManualNote(note);
  }
}

async function captureSelection() {
  const state = await requireRecording();
  const active = await getActiveTab();
  if (!active || typeof active.id !== "number") {
    throw new Error("No active browser tab found.");
  }
  const context = await getTabContext(active);
  upsertTab(state, context);
  if (!context.selectedText) {
    throw new Error("No selected text found on the active tab.");
  }
  state.events.push({
    type: "selection",
    title: context.title,
    url: context.url,
    selectedText: context.selectedText,
    at: isoNow(),
  });
  await saveState(state);
  return state;
}

async function captureScreenshot(note) {
  const state = await requireRecording();
  const active = await getActiveTab();
  if (!active || typeof active.windowId !== "number") {
    throw new Error("No active browser tab found.");
  }
  const context = await getTabContext(active);
  upsertTab(state, context);
  const dataUrl = await chrome.tabs.captureVisibleTab(active.windowId, { format: "png" });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  state.events.push({
    type: "screenshot",
    title: context.title,
    url: context.url,
    note: String(note || "").trim(),
    screenshot: {
      fileName: `tracepad-screenshot-${stamp}.png`,
      dataUrl,
    },
    at: isoNow(),
  });
  await saveState(state);
  return state;
}

async function capturePageContent(note) {
  const state = await requireRecording();
  const active = await getActiveTab();
  if (!active || typeof active.id !== "number") {
    throw new Error("No active browser tab found.");
  }
  const context = await getPageContext(active);
  upsertTab(state, context);
  const message = context.message || context.pageText || context.logText || context.selectedText || "";
  if (!message) {
    throw new Error("No readable page content found on the active tab.");
  }
  state.events.push({
    type: "page",
    title: context.title,
    url: context.url,
    message: `${String(note || "").trim() ? `${String(note || "").trim()}\n\n` : ""}${message}`,
    selectedText: context.selectedText || "",
    pageText: context.pageText || "",
    logText: context.logText || "",
    headings: context.headings || [],
    at: isoNow(),
  });
  await saveState(state);
  return state;
}

async function addBrowserEvent(event, senderTab) {
  const state = await getState();
  if (!state.recording) {
    return state;
  }
  const tab = senderTab || {};
  const normalized = {
    type: event.type || "console",
    level: event.level || "",
    title: event.title || tab.title || "",
    url: event.url || tab.url || "",
    message: event.message || "",
    at: event.at || isoNow(),
  };
  if (normalized.url || normalized.title) {
    upsertTab(state, {
      title: normalized.title,
      url: normalized.url,
      capturedAt: normalized.at,
    });
  }
  state.events.push(normalized);
  await saveState(state);
  return state;
}

async function recordNetworkEvent(details, message) {
  const state = await getState();
  if (!state.recording) {
    requestStartTimes.delete(details.requestId);
    return;
  }
  const tab = await getTabById(details.tabId).catch(() => null);
  const startedAt = requestStartTimes.get(details.requestId);
  requestStartTimes.delete(details.requestId);
  const durationMs = typeof startedAt === "number" ? Math.max(0, details.timeStamp - startedAt) : null;
  const event = {
    type: "network",
    method: details.method || "",
    url: details.url || "",
    status: details.statusCode || 0,
    durationMs,
    message,
    title: tab && tab.title ? tab.title : "",
    at: new Date(details.timeStamp).toISOString(),
  };
  if (tab) {
    upsertTab(state, {
      title: tab.title || "",
      url: tab.url || "",
      capturedAt: event.at,
    });
  }
  state.events.push(event);
  await saveState(state);
}

async function recordShortcutError(command, error) {
  const state = await getState();
  if (!state.recording) {
    return;
  }
  const active = await getActiveTab();
  const context = active
    ? {
        title: active.title || "",
        url: active.url || "",
      }
    : {};
  state.events.push({
    type: "note",
    title: context.title || "",
    url: context.url || "",
    message: `Shortcut ${command} failed: ${error && error.message ? error.message : String(error)}`,
    at: isoNow(),
  });
  await saveState(state);
}

async function exportCapture() {
  const state = await getState();
  const exported = {
    version: 1,
    source: SOURCE,
    capturedAt: state.capturedAt || state.startedAt || isoNow(),
    startedAt: state.startedAt || "",
    stoppedAt: state.stoppedAt || "",
    exportedAt: isoNow(),
    tabs: state.tabs || [],
    events: state.events || [],
  };
  const json = JSON.stringify(exported, null, 2);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  await chrome.downloads.download({
    url,
    filename: `tracepad-browser-capture-${stamp}.json`,
    saveAs: true,
  });
  return exported;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getTabById(tabId) {
  return chrome.tabs.get(tabId);
}

async function getTabContext(tab) {
  const fallback = {
    title: tab.title || "",
    url: tab.url || "",
    capturedAt: isoNow(),
    selectedText: "",
  };
  if (typeof tab.id !== "number" || !isInjectableUrl(tab.url || "")) {
    return fallback;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "tracepad:capture-context" });
  } catch (error) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      return await chrome.tabs.sendMessage(tab.id, { type: "tracepad:capture-context" });
    } catch (innerError) {
      return fallback;
    }
  }
}

async function getPageContext(tab) {
  const fallback = await getTabContext(tab);
  if (typeof tab.id !== "number" || !isInjectableUrl(tab.url || "")) {
    return fallback;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "tracepad:capture-page" });
  } catch (error) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      return await chrome.tabs.sendMessage(tab.id, { type: "tracepad:capture-page" });
    } catch (innerError) {
      return fallback;
    }
  }
}

function isInjectableUrl(url) {
  return /^https?:\/\//i.test(url) || /^file:\/\//i.test(url);
}

async function requireRecording() {
  const state = await getState();
  if (!state.recording) {
    throw new Error("Start capture first.");
  }
  return state;
}

async function updateState(patch) {
  const state = await getState();
  const next = { ...state, ...patch };
  await saveState(next);
  return next;
}

async function getState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return stored[STATE_KEY] || createEmptyState(false);
}

async function saveState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

function createEmptyState(recording) {
  return {
    version: 1,
    source: SOURCE,
    recording,
    capturedAt: "",
    startedAt: "",
    stoppedAt: "",
    tabs: [],
    events: [],
  };
}

function upsertTab(state, context) {
  const url = context.url || "";
  const title = context.title || "";
  const existing = state.tabs.find((tab) => tab.url === url && tab.title === title);
  if (existing) {
    existing.capturedAt = context.capturedAt || isoNow();
    if (context.selectedText) {
      existing.selectedText = context.selectedText;
    }
    return;
  }
  state.tabs.push({
    title,
    url,
    capturedAt: context.capturedAt || isoNow(),
    selectedText: context.selectedText || "",
  });
}

function isoNow() {
  return new Date().toISOString();
}
