// FixIt front end: plain JavaScript, no build step.
// The page holds the state (versions, current version); the server only makes
// model calls and computes the change report.

const $ = (id) => document.getElementById(id);

const state = {
  samples: [],
  controls: [],
  versions: [], // every answer for the current task, never deleted
  current: -1,  // index into versions of the answer being shown
  task: null,   // the source, mode and request the versions belong to
  proposal: null, // an Auto-fix proposal waiting for the person's decision
  busy: false,
};

// ---------- start-up ----------

async function init() {
  await Promise.all([loadHealth(), loadSamples(), loadControls()]);
  $("source-text").addEventListener("input", updateCharCount);
  $("sample-select").addEventListener("change", applySample);
  $("generate-btn").addEventListener("click", generate);
  $("correct-btn").addEventListener("click", applyCorrection);
  $("undo-btn").addEventListener("click", undo);
  $("change-view").addEventListener("change", renderCurrent);
  $("autofix-btn").addEventListener("click", requestAutofix);
  $("proposal-run").addEventListener("click", runProposal);
  $("proposal-cancel").addEventListener("click", cancelProposal);
  $("proposal-text").addEventListener("input", markProposalEdited);
  $("proposal-edit").addEventListener("click", editProposal);
  updateCharCount();
}

async function loadHealth() {
  const badge = $("mode-badge");
  try {
    const data = await (await fetch("/api/health")).json();
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
  state.samples = await (await fetch("/api/samples")).json();
  const select = $("sample-select");
  for (const s of state.samples) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.title;
    select.appendChild(opt);
  }
}

// Correction buttons are built from the same specification the prompts use,
// so the hint always describes what the button really asks the model to do.
async function loadControls() {
  state.controls = await (await fetch("/api/controls")).json();
  const box = $("fix-buttons");
  const defaultHint = $("fix-hint").textContent;
  for (const c of state.controls) {
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.textContent = c.label;
    btn.dataset.control = c.id;
    btn.setAttribute("aria-describedby", "fix-hint");
    const showHint = () => { $("fix-hint").innerHTML = `<strong>${c.label}:</strong> ${c.hint}`; };
    btn.addEventListener("mouseenter", showHint);
    btn.addEventListener("focus", showHint);
    btn.addEventListener("mouseleave", () => { $("fix-hint").textContent = defaultHint; });
    btn.addEventListener("click", () => applyButton(c));
    box.appendChild(btn);
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

// ---------- model calls ----------

async function generate() {
  const sourceText = $("source-text").value;
  if (!sourceText.trim()) {
    showError("Paste some text first.");
    return;
  }
  const task = {
    source_text: sourceText,
    mode: document.querySelector('input[name="mode"]:checked').value,
    request: $("request").value,
  };
  const data = await callApi("/api/generate", task, $("generate-btn"));
  if (!data) return;

  // A new Generate starts a new task, so its history starts again.
  hideProposal();
  state.task = task;
  state.versions = [];
  addVersion({
    text: data.output,
    action: "First answer",
    who: "Written by the AI from your text and request",
    parent: null,
    changes: null,
    data,
  });
}

async function applyButton(control) {
  const base = currentVersion();
  if (!base) return;
  hideProposal();
  const data = await callApi(
    "/api/revise",
    { ...state.task, current_answer: base.text, button: control.id },
    document.querySelector(`[data-control="${control.id}"]`),
  );
  if (!data) return;
  addVersion({
    text: data.output,
    action: control.label,
    who: "You chose this fix; the AI rewrote the answer",
    parent: state.current,
    changes: data.changes,
    data,
  });
}

async function applyCorrection() {
  const base = currentVersion();
  const correction = $("correction").value.trim();
  if (!base) return;
  hideProposal();
  if (!correction) {
    showError("Type what is wrong first, or use a quick fix.");
    return;
  }
  const data = await callApi(
    "/api/revise",
    { ...state.task, current_answer: base.text, correction },
    $("correct-btn"),
  );
  if (!data) return;
  $("correction").value = "";
  addVersion({
    text: data.output,
    action: "Your correction",
    who: `You wrote: “${correction}”; the AI rewrote the answer`,
    parent: state.current,
    changes: data.changes,
    data,
  });
}

// ---------- Auto-fix: the model proposes, the person decides ----------

async function requestAutofix() {
  const base = currentVersion();
  if (!base) return;
  const data = await callApi(
    "/api/autofix",
    { ...state.task, current_answer: base.text },
    $("autofix-btn"),
  );
  if (!data) return;
  state.proposal = { ...data.proposal, basedOn: state.current };
  showProposal(data);
}

function showProposal(data) {
  const p = data.proposal;
  $("proposal-diagnosis").textContent = p.diagnosis;
  $("proposal-old").textContent = state.task.request.trim() || "(You did not write a request.)";

  // Which words of the request changed, computed by code, not by the model.
  const diffBox = $("proposal-diff");
  diffBox.replaceChildren();
  for (const seg of data.request_changes.segments) {
    const tag = seg.type === "add" ? "ins" : seg.type === "del" ? "del" : "span";
    const el = document.createElement(tag);
    el.textContent = seg.text;
    diffBox.appendChild(el);
  }

  // Show the highlighted suggestion once; the edit box opens only on request,
  // so the person does not have to read the same request twice (L05).
  $("proposal-text").value = p.rewritten_request;
  $("proposal-text").hidden = true;
  diffBox.hidden = false;
  $("proposal-edit").hidden = false;
  $("proposal-edited").hidden = true;
  fillList("proposal-changes", p.changes, "No changes listed.");
  fillList("proposal-assumptions", p.assumptions, "No assumptions listed.");
  $("proposal").hidden = false;
  $("proposal").scrollIntoView({ behavior: "smooth", block: "nearest" });
  $("proposal-run").focus();
}

function editProposal() {
  $("proposal-diff").hidden = true;
  $("proposal-edit").hidden = true;
  $("proposal-text").hidden = false;
  $("proposal-text").focus();
}

function fillList(id, items, emptyText) {
  const ul = $(id);
  ul.replaceChildren();
  for (const text of items.length ? items : [emptyText]) {
    const li = document.createElement("li");
    li.textContent = text;
    ul.appendChild(li);
  }
}

// Noticing that the person edited the proposal: it changes the authorship
// label of the result, and shows the person their edit was registered.
function markProposalEdited() {
  if (!state.proposal) return;
  const edited = $("proposal-text").value.trim() !== state.proposal.rewritten_request.trim();
  $("proposal-edited").hidden = !edited;
}

async function runProposal() {
  if (!state.proposal) return;
  const newRequest = $("proposal-text").value.trim();
  if (!newRequest) {
    showError("The request is empty. Write one, or cancel.");
    return;
  }
  const edited = newRequest !== state.proposal.rewritten_request.trim();
  const base = state.versions[state.proposal.basedOn];
  const data = await callApi(
    "/api/generate",
    { ...state.task, request: newRequest, compare_to: base.text },
    $("proposal-run"),
  );
  if (!data) return;

  // The approved request becomes the request on screen: the screen holds the
  // current state, so the person can see what the next answer is based on.
  state.task = { ...state.task, request: newRequest };
  $("request").value = newRequest;
  const parent = state.proposal.basedOn;
  hideProposal();
  addVersion({
    text: data.output,
    action: "Auto-fix",
    who: edited
      ? "The AI proposed a new request; you edited and approved it"
      : "The AI proposed a new request; you approved it",
    parent,
    changes: data.changes,
    data,
  });
}

function cancelProposal() {
  hideProposal();
  showNote("Auto-fix cancelled. Nothing was changed.");
}

function hideProposal() {
  state.proposal = null;
  $("proposal").hidden = true;
}

// One place for every call: immediate feedback, errors kept recoverable.
async function callApi(url, body, triggerBtn) {
  if (state.busy) return null;
  const stopWorking = showWorking(triggerBtn);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(readError(data));
    return data;
  } catch (err) {
    showError(`${err.message} Nothing was changed; you can try again.`);
    return null;
  } finally {
    stopWorking();
  }
}

function readError(data) {
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) return data.detail.map((d) => d.msg).join("; ");
  return "Something went wrong.";
}

// ---------- versions ----------

function currentVersion() {
  return state.versions[state.current] || null;
}

function addVersion(v) {
  v.number = state.versions.length + 1;
  v.time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  state.versions.push(v);
  state.current = state.versions.length - 1;
  renderCurrent();
}

// Undo moves back to the version this one was made from. Nothing is deleted,
// so an undo can itself be reversed from the history list (reversibility, L01).
function undo() {
  const v = currentVersion();
  if (!v || v.parent === null) return;
  state.current = v.parent;
  renderCurrent();
  showNote(`Undone: back to version ${state.versions[state.current].number}. ` +
    `Version ${v.number} is still in the history.`);
}

function selectVersion(index) {
  state.current = index;
  renderCurrent();
}

// ---------- rendering ----------

function renderCurrent() {
  const v = currentVersion();
  if (!v) return;
  $("empty-state").hidden = true;
  $("recovery").hidden = false;
  $("history").hidden = false;
  $("version-bar").hidden = false;

  $("version-title").textContent =
    `Version ${v.number} of ${state.versions.length}: ${v.action}`;
  $("version-who").textContent = `${v.who} · ${v.time}`;
  $("undo-btn").disabled = v.parent === null || state.busy;

  // Highlight what changed from the version this one was made from, so the
  // change cannot be missed when the text is replaced (change blindness, L04).
  // Default: new words only. Showing removed words inline as well is optional,
  // because after a full rewrite it makes the text hard to read (extraneous
  // load, L05).
  const out = $("output");
  out.replaceChildren();
  const view = $("change-view").value;
  if (v.changes && view !== "none") {
    for (const seg of v.changes.segments) {
      if (seg.type === "del" && view !== "all") continue;
      const tag = seg.type === "add" ? "ins" : seg.type === "del" ? "del" : "span";
      const el = document.createElement(tag);
      el.textContent = seg.text;
      out.appendChild(el);
    }
  } else {
    out.textContent = v.text;
  }
  out.hidden = false;

  const report = $("change-report");
  if (v.changes) {
    report.textContent = describeChanges(v.changes.report, state.versions[v.parent].number);
    report.hidden = false;
  } else {
    report.hidden = true;
  }

  const words = v.text.trim().split(/\s+/).filter(Boolean).length;
  const d = v.data;
  $("output-meta").textContent =
    `${words} words · ${d.mock ? "mock" : d.model} · ${d.elapsed_ms} ms`;
  $("output-meta").hidden = false;

  $("sent-system").textContent = d.sent.system;
  $("sent-user").textContent = d.sent.user;
  $("sent-panel").hidden = false;

  renderHistory();
}

// The report is computed by code from the two texts, not taken from the model.
function describeChanges(r, fromNumber) {
  if (r.unchanged) return `No wording changed compared with version ${fromNumber}.`;
  const mostly = r.words_removed >= 0.6 * r.words_before ? "Mostly rewritten. " : "";
  return `${mostly}Compared with version ${fromNumber}: ${r.words_before} → ${r.words_after} words ` +
    `(${r.words_removed} removed, ${r.words_added} added), ` +
    `${r.sentences_before} → ${r.sentences_after} sentences.`;
}

function renderHistory() {
  const list = $("history-list");
  list.replaceChildren();
  state.versions.forEach((v, i) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = i === state.current ? "current" : "";
    btn.disabled = state.busy;
    btn.innerHTML = "";
    const title = document.createElement("strong");
    title.textContent = `v${v.number} · ${v.action}${i === state.current ? " (showing)" : ""}`;
    const meta = document.createElement("span");
    meta.className = "meta";
    const from = v.parent === null ? "" : ` · made from v${state.versions[v.parent].number}`;
    meta.textContent = `${v.who}${from} · ${v.time}`;
    btn.append(title, meta);
    btn.addEventListener("click", () => selectVersion(i));
    li.appendChild(btn);
    list.appendChild(li);
  });
}

// ---------- feedback ----------

function setBusy(busy) {
  state.busy = busy;
  for (const b of document.querySelectorAll(
    "#fix-buttons button, #correct-btn, #generate-btn, #undo-btn, #autofix-btn, #proposal-run, #proposal-cancel")) {
    b.disabled = busy;
  }
  if (!busy) {
    const v = currentVersion();
    $("undo-btn").disabled = !v || v.parent === null;
  }
  for (const b of document.querySelectorAll("#history-list button")) b.disabled = busy;
}

// Acknowledge the click at once on the button that was pressed, where the
// person is already looking, then show elapsed time after one second
// (feedback timing and inattentional blindness, Lecture 04).
function showWorking(btn) {
  const status = $("status");
  const originalLabel = btn.textContent;
  setBusy(true);
  status.className = "status working";
  status.hidden = false;
  const started = Date.now();
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
    btn.textContent = originalLabel;
    setBusy(false);
    if (status.classList.contains("working")) status.hidden = true;
  };
}

function showError(message) {
  const status = $("status");
  status.className = "status error";
  status.textContent = message;
  status.hidden = false;
}

function showNote(message) {
  const status = $("status");
  status.className = "status working";
  status.textContent = message;
  status.hidden = false;
  setTimeout(() => {
    if (status.textContent === message) status.hidden = true;
  }, 6000);
}

init();
