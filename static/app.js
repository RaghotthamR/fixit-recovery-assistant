// FixIt front end: plain JavaScript, no build step.
// The page holds the state; the server only makes model calls.

const $ = (id) => document.getElementById(id);

const state = {
  samples: [],
  current: null, // the latest answer returned by the server
};

// ---------- start-up ----------

async function init() {
  await Promise.all([loadHealth(), loadSamples()]);
  $("source-text").addEventListener("input", updateCharCount);
  $("sample-select").addEventListener("change", applySample);
  $("generate-btn").addEventListener("click", generate);
  updateCharCount();
}

async function loadHealth() {
  const badge = $("mode-badge");
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    // Say plainly which system is answering (capability and reliability visible).
    if (data.mock) {
      badge.textContent = "Mock mode: canned responses";
      badge.className = "badge mock";
    } else {
      badge.textContent = `Live: ${data.model}`;
      badge.className = "badge live";
    }
  } catch {
    badge.textContent = "Server not reachable";
  }
}

async function loadSamples() {
  const res = await fetch("/api/samples");
  state.samples = await res.json();
  const select = $("sample-select");
  for (const s of state.samples) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.title;
    select.appendChild(opt);
  }
}

function applySample() {
  const sample = state.samples.find((s) => s.id === $("sample-select").value);
  const note = $("sample-note");
  if (!sample) {
    note.hidden = true;
    return;
  }
  $("source-text").value = sample.source;
  $("request").value = sample.request;
  document.querySelector(`input[name="mode"][value="${sample.mode}"]`).checked = true;
  note.textContent = `Demo failure: ${sample.failure}`;
  note.hidden = false;
  updateCharCount();
}

function updateCharCount() {
  $("char-count").textContent = $("source-text").value.length.toLocaleString();
  // If the person edits a demo text, it is no longer that demo case.
  const sample = state.samples.find((s) => s.id === $("sample-select").value);
  if (sample && $("source-text").value.trim() !== sample.source.trim()) {
    $("sample-select").value = "";
    $("sample-note").hidden = true;
  }
}

// ---------- model call ----------

async function generate() {
  const sourceText = $("source-text").value;
  if (!sourceText.trim()) {
    showError("Paste some text first.");
    return;
  }
  const body = {
    source_text: sourceText,
    mode: document.querySelector('input[name="mode"]:checked').value,
    request: $("request").value,
  };

  const stopWorking = showWorking();
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(readError(data));
    }
    state.current = data;
    renderOutput(data);
  } catch (err) {
    showError(`${err.message} Your text is still here; you can try again.`);
  } finally {
    stopWorking();
  }
}

function readError(data) {
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) return data.detail.map((d) => d.msg).join("; ");
  return "Something went wrong.";
}

// ---------- feedback ----------

// Acknowledge the click at once, then show elapsed time after one second
// (feedback timing: 0.1 s / 1 s / 10 s, Lecture 04).
function showWorking() {
  const status = $("status");
  const btn = $("generate-btn");
  btn.disabled = true;
  status.className = "status working";
  status.hidden = false;
  const started = Date.now();
  // The same message also appears on the button, where the person is already
  // looking, so it is not missed if the answer panel is off-screen (Lecture 04).
  const paint = () => {
    const secs = Math.floor((Date.now() - started) / 1000);
    const text = `Working on it${secs >= 1 ? ` (${secs}s)` : "…"}`;
    status.innerHTML = `<span class="spinner"></span>${text}`;
    btn.innerHTML = `<span class="spinner"></span>${text}`;
  };
  paint();
  const timer = setInterval(paint, 500);
  return () => {
    clearInterval(timer);
    btn.disabled = false;
    btn.textContent = "Generate";
    if (status.classList.contains("working")) status.hidden = true;
  };
}

function showError(message) {
  const status = $("status");
  status.className = "status error";
  status.textContent = message;
  status.hidden = false;
}

function renderOutput(data) {
  $("empty-state").hidden = true;
  const out = $("output");
  out.textContent = data.output;
  out.hidden = false;

  const words = data.output.trim().split(/\s+/).filter(Boolean).length;
  const meta = $("output-meta");
  meta.textContent = `${words} words · ${data.mock ? "mock" : data.model} · ${data.elapsed_ms} ms`;
  meta.hidden = false;

  $("sent-system").textContent = data.sent.system;
  $("sent-user").textContent = data.sent.user;
  $("sent-panel").hidden = false;
}

init();
