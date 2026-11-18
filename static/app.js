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
  accepted: -1,   // index of the version the person marked as their final answer
  log: [],        // interaction events for this task: counts and timings, no text
  started: 0,     // when this task's first Generate was pressed (ms)
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
  $("copy-btn").addEventListener("click", copyAnswer);
  $("accept-btn").addEventListener("click", acceptAnswer);
  $("log-btn").addEventListener("click", downloadLog);
  document.addEventListener("keydown", onShortcut);
  updateCharCount();
}

// ---------- keyboard shortcuts (efficient invocation, Amershi et al.) ----------

function onShortcut(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || state.busy) return;
  const inText = ["TEXTAREA", "INPUT", "SELECT"].includes(e.target.tagName);
  if (e.key === "Enter") {
    e.preventDefault();
    if (e.target.id === "correction") applyCorrection();
    else if (e.target.id === "proposal-text") runProposal();
    else generate();
  } else if ((e.key === "z" || e.key === "Z") && !e.shiftKey && !inText) {
    // Outside text boxes only, so the browser's own text undo keeps working.
    e.preventDefault();
    undo();
  }
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

// The step path shows where the person is: paste, get an answer, fix it.
// (Visibility of system status; the system image supports the mental model, L05.)
function updateSteps() {
  const hasText = $("source-text").value.trim().length > 0;
  const hasAnswer = state.versions.length > 0;
  const finished = state.accepted >= 0;
  const stage = !hasText && !hasAnswer ? 1 : !hasAnswer ? 2 : 3;
  for (const li of document.querySelectorAll("#steps li")) {
    const n = Number(li.dataset.step);
    li.classList.toggle("done", n < stage);
    li.classList.toggle("current", n === stage && !(n === 3 && finished));
    li.classList.toggle("finished", n === 3 && finished);
    if (n === stage) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  }
}

function updateCharCount() {
  $("char-count").textContent = $("source-text").value.length.toLocaleString();
  // If the person edits a demo text, it is no longer that demo case.
  const sample = state.samples.find((s) => s.id === $("sample-select").value);
  if (sample && $("source-text").value.trim() !== sample.source.trim()) {
    $("sample-select").value = "";
    $("sample-note").hidden = true;
  }
  updateSteps();
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
  const clicked = Date.now();
  const data = await callApi("/api/generate", task, $("generate-btn"));
  if (!data) return;

  // A new Generate starts a new task, so its history and log start again.
  hideProposal();
  state.task = task;
  state.versions = [];
  state.accepted = -1;
  state.log = [];
  state.started = clicked;
  $("summary").hidden = true;
  logEvent("generate", { mode: task.mode, seeded: Boolean(data.seeded),
    request_words: countWords(task.request) });
  addVersion({
    text: data.output,
    action: data.seeded ? "First answer (demo)" : "First answer",
    who: data.seeded
      ? "Seeded demo failure, not written by the model"
      : "Written by the AI from your text and request",
    parent: null,
    changes: null,
    data,
  });
}

async function applyButton(control) {
  const base = currentVersion();
  if (!base) return;
  hideProposal();
  const suggested = currentFindings(base).some((f) => f.button === control.id);
  const data = await callApi(
    "/api/revise",
    { ...state.task, current_answer: base.text, button: control.id },
    document.querySelector(`[data-control="${control.id}"]`),
  );
  if (!data) return;
  logEvent("quick_fix", { button: control.id, suggested, from: base.number });
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
  logEvent("own_words", { from: base.number, correction_chars: correction.length });
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
  logEvent("autofix_proposed", { from: base.number,
    assumptions: data.proposal.assumptions.length, changes: data.proposal.changes.length });
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
  logEvent("autofix_run", { from: state.versions[parent].number, edited });
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
  if (state.proposal) logEvent("autofix_cancelled", {});
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
    if (state.started) logEvent("error", { where: url.replace("/api/", "") });
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
  if (state.accepted >= 0) {
    state.accepted = -1;
    $("summary").hidden = true;
  }
  renderCurrent();
}

// Undo moves back to the version this one was made from. Nothing is deleted,
// so an undo can itself be reversed from the history list (reversibility, L01).
function undo() {
  const v = currentVersion();
  if (!v || v.parent === null) return;
  state.current = v.parent;
  logEvent("undo", { from: v.number, to: state.versions[state.current].number });
  renderCurrent();
  showNote(`Undone: back to version ${state.versions[state.current].number}. ` +
    `Version ${v.number} is still in the history.`);
}

function selectVersion(index) {
  if (index !== state.current) logEvent("open_version", { to: state.versions[index].number });
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
  const source = d.seeded ? "seeded demo answer" : d.mock ? "mock" : d.model;
  $("output-meta").textContent = `${words} words · ${source} · ${d.elapsed_ms} ms`;
  $("output-meta").hidden = false;

  $("sent-system").textContent = d.sent.system;
  $("sent-user").textContent = d.sent.user;
  $("sent-panel").hidden = false;

  const isFinal = state.current === state.accepted;
  out.classList.toggle("accepted", isFinal);
  $("accept-row").hidden = false;
  $("accept-btn").textContent = isFinal ? "Marked as your final answer" : "This answer works for me";
  $("accept-btn").disabled = isFinal || state.busy;

  renderNoticed(v);
  renderHistory();
  updateSteps();
}

function currentFindings(v) {
  return (v.data.checks || []).filter((f) => !(v.dismissed || []).includes(f.id));
}

// Suggested fixes: the system points out a likely problem and highlights a
// button, but never applies a fix itself. The person decides, and can dismiss
// a finding (mixed initiative, L03; efficient dismissal, Amershi et al.).
function renderNoticed(v) {
  const findings = currentFindings(v);
  const list = $("noticed-list");
  list.replaceChildren();
  for (const b of document.querySelectorAll("#fix-buttons button")) b.classList.remove("suggested");

  for (const f of findings) {
    const control = state.controls.find((c) => c.id === f.button);
    const li = document.createElement("li");
    li.append(document.createTextNode(`${f.message} `));
    if (control) {
      const s = document.createElement("span");
      s.className = "suggest";
      s.textContent = `Suggested fix: ${control.label}.`;
      li.appendChild(s);
      document.querySelector(`[data-control="${f.button}"]`)?.classList.add("suggested");
    }
    const dismiss = document.createElement("button");
    dismiss.className = "link-btn";
    dismiss.textContent = "Not a problem";
    dismiss.addEventListener("click", () => {
      v.dismissed = [...(v.dismissed || []), f.id];
      logEvent("dismissed_suggestion", { finding: f.id, version: v.number });
      renderNoticed(v);
    });
    li.appendChild(dismiss);
    list.appendChild(li);
  }
  $("noticed").hidden = findings.length === 0;
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
    btn.className = [i === state.current ? "current" : "", i === state.accepted ? "accepted" : ""].join(" ").trim();
    if (i === state.current) btn.setAttribute("aria-current", "true");
    btn.disabled = state.busy;
    btn.innerHTML = "";
    const title = document.createElement("strong");
    title.textContent = `v${v.number} · ${v.action}${i === state.current ? " (showing)" : ""}`;
    const meta = document.createElement("span");
    meta.className = "meta";
    const from = v.parent === null ? "" : ` · made from v${state.versions[v.parent].number}`;
    meta.textContent = `${v.who}${from} · ${v.time}`;
    btn.append(title);
    if (i === state.accepted) {
      const tag = document.createElement("span");
      tag.className = "tag-final";
      tag.textContent = "final answer";
      btn.append(tag);
    }
    btn.append(meta);
    btn.addEventListener("click", () => selectVersion(i));
    li.appendChild(btn);
    list.appendChild(li);
  });
}

// ---------- feedback ----------

function setBusy(busy) {
  state.busy = busy;
  for (const b of document.querySelectorAll(
    "#fix-buttons button, #correct-btn, #generate-btn, #undo-btn, #autofix-btn, " +
    "#proposal-run, #proposal-cancel, #accept-btn")) {
    b.disabled = busy;
  }
  if (!busy) {
    const v = currentVersion();
    $("undo-btn").disabled = !v || v.parent === null;
    $("accept-btn").disabled = !v || state.current === state.accepted;
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

// ---------- copy ----------

async function copyAnswer() {
  const v = currentVersion();
  if (!v) return;
  try {
    await navigator.clipboard.writeText(v.text);
  } catch {
    // Fallback for browsers that block the clipboard API on local pages.
    const t = document.createElement("textarea");
    t.value = v.text;
    document.body.appendChild(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  logEvent("copy", { version: v.number });
  showNote(`Copied version ${v.number} (without highlights).`);
}

// ---------- finishing: accept, summary and session log ----------
// The log records counts and timings only, never the person's text, and
// stays on this page unless they download it (store less, L10). Its measures
// match the planned Assignment 1 study: time to an acceptable answer, number
// and kind of recovery attempts, undos, and use of suggestions.

function logEvent(type, details) {
  state.log.push({ t_ms: Date.now() - state.started, type, ...details });
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function acceptAnswer() {
  const v = currentVersion();
  if (!v) return;
  state.accepted = state.current;
  logEvent("accepted", { version: v.number });
  renderCurrent();
  renderSummary();
}

function summarise() {
  const events = state.log;
  const count = (type, pred = () => true) => events.filter((e) => e.type === type && pred(e)).length;
  const final = state.versions[state.accepted];
  const acceptEvent = [...events].reverse().find((e) => e.type === "accepted");
  const methods = [];
  for (const e of events) {
    let name = null;
    if (e.type === "quick_fix") name = state.controls.find((c) => c.id === e.button)?.label;
    if (e.type === "own_words") name = "your own words";
    if (e.type === "autofix_run") name = "Auto-fix";
    if (name && !methods.includes(name)) methods.push(name);
  }
  return {
    final_version: final.number,
    final_words: countWords(final.text),
    seconds_to_accept: Math.round((acceptEvent?.t_ms ?? 0) / 1000),
    versions_made: state.versions.length,
    quick_fixes: count("quick_fix"),
    quick_fixes_that_were_suggested: count("quick_fix", (e) => e.suggested),
    own_words_corrections: count("own_words"),
    autofix_proposed: count("autofix_proposed"),
    autofix_run: count("autofix_run"),
    autofix_edited_before_run: count("autofix_run", (e) => e.edited),
    autofix_cancelled: count("autofix_cancelled"),
    undos: count("undo"),
    suggestions_shown: state.versions.reduce((n, v) => n + (v.data.checks || []).length, 0),
    suggestions_dismissed: count("dismissed_suggestion"),
    errors: count("error"),
    methods_used: methods,
  };
}

function secs(n) {
  return `${n} ${n === 1 ? "second" : "seconds"}`;
}

function renderSummary() {
  const s = summarise();
  const fixes = s.quick_fixes + s.own_words_corrections + s.autofix_run;
  $("summary-version").textContent = `version ${s.final_version} is your final answer`;
  $("summary-line").textContent = fixes === 0
    ? `You kept the first answer after ${secs(s.seconds_to_accept)}; no fixes were needed.`
    : `You reached a working answer in ${secs(s.seconds_to_accept)} with ` +
      `${fixes} ${fixes === 1 ? "fix" : "fixes"}` +
      `${s.undos ? ` and ${s.undos} ${s.undos === 1 ? "undo" : "undos"}` : ""}, ` +
      `using ${s.methods_used.join(", ")}.`;

  const stats = [
    ["Time to final answer", `${s.seconds_to_accept} s`],
    ["Quick fixes", s.quick_fixes],
    ["Own-words corrections", s.own_words_corrections],
    ["Auto-fix runs", `${s.autofix_run} of ${s.autofix_proposed} proposed`],
    ["Undos", s.undos],
    ["Suggested fixes used", `${s.quick_fixes_that_were_suggested} of ${s.suggestions_shown}`],
  ];
  const dl = $("summary-stats");
  dl.replaceChildren();
  for (const [label, value] of stats) {
    const box = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    box.append(dt, dd);
    dl.appendChild(box);
  }
  $("summary").hidden = false;
  $("summary").focus({ preventScroll: true });
  $("summary").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function downloadLog() {
  const first = state.versions[0]?.data || {};
  const record = {
    app: "FixIt",
    prompt_version: first.sent?.prompt_version,
    model: first.mock ? "mock" : first.model,
    demo_case: Boolean(first.seeded),
    started_at: new Date(state.started).toISOString(),
    summary: summarise(),
    events: state.log,
  };
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fixit-session-${record.started_at.slice(0, 19).replace(/[:T]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

init();
