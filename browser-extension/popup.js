const els = {
  statusText: document.getElementById("statusText"),
  statusDot: document.getElementById("statusDot"),
  tabCount: document.getElementById("tabCount"),
  eventCount: document.getElementById("eventCount"),
  startButton: document.getElementById("startButton"),
  selectionButton: document.getElementById("selectionButton"),
  screenshotButton: document.getElementById("screenshotButton"),
  exportButton: document.getElementById("exportButton"),
  noteInput: document.getElementById("noteInput"),
  noteButton: document.getElementById("noteButton"),
  clearButton: document.getElementById("clearButton"),
  messageText: document.getElementById("messageText"),
};

els.startButton.addEventListener("click", () => runAction("tracepad:start", {}, "Capture started"));
els.selectionButton.addEventListener("click", () => runAction("tracepad:capture-selection", {}, "Selection captured"));
els.screenshotButton.addEventListener("click", () => runAction("tracepad:capture-screenshot", {}, "Screenshot captured"));
els.exportButton.addEventListener("click", () => runAction("tracepad:export", {}, "Capture exported"));
els.clearButton.addEventListener("click", () => runAction("tracepad:clear", {}, "Capture cleared"));
els.noteButton.addEventListener("click", async () => {
  const note = els.noteInput.value.trim();
  await runAction("tracepad:add-note", { note }, "Note added");
  els.noteInput.value = "";
});

refresh();

async function refresh() {
  const response = await send("tracepad:status");
  render(response);
}

async function runAction(type, payload, successMessage) {
  setMessage("");
  setBusy(true);
  try {
    const response = await send(type, payload);
    render(response);
    setMessage(successMessage);
  } catch (error) {
    setMessage(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!response || !response.ok) {
        reject(new Error(response && response.error ? response.error : "Tracepad action failed"));
        return;
      }
      resolve(response.result);
    });
  });
}

function render(state) {
  const recording = Boolean(state && state.recording);
  const tabCount = state && state.tabs ? state.tabs.length : 0;
  const eventCount = state && state.events ? state.events.length : 0;
  els.statusText.textContent = recording ? "Recording browser evidence" : "Capture is stopped";
  els.statusDot.classList.toggle("active", recording);
  els.tabCount.textContent = String(tabCount);
  els.eventCount.textContent = String(eventCount);
  els.startButton.textContent = recording ? "Restart" : "Start";
  els.startButton.disabled = false;
  els.selectionButton.disabled = !recording;
  els.screenshotButton.disabled = !recording;
  els.noteButton.disabled = !recording;
  els.exportButton.disabled = eventCount === 0 && tabCount === 0;
  els.clearButton.disabled = false;
}

function setBusy(isBusy) {
  if (isBusy) {
    for (const button of document.querySelectorAll("button")) {
      button.disabled = true;
    }
    return;
  }
  refresh();
}

function setMessage(message) {
  els.messageText.textContent = message;
}
