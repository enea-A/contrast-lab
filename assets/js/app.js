const $ = (sel, el=document) => el.querySelector(sel);

const state = {
  manifest: null,
  filterText: "",
  filterTag: "",
  filterTier: "",
  toolName: "",
  visualUser: "",
  simMode: "none",
  freeze: false,
  clean: false,
};

state.toolName = "";
state.visualUser = "";

function keyFor(toolName, caseId) {
  return `contrastlab::${toolName}::${caseId}`;
}
function manualKeyFor(caseId) {
  return `contrastlab::manual::${caseId}`;
}
function getVerdict(toolName, caseId) {
  return localStorage.getItem(keyFor(toolName, caseId)) || "";
}
function setVerdict(toolName, caseId, verdict) {
  localStorage.setItem(keyFor(toolName, caseId), verdict);
}
function getManual(caseId) {
  return localStorage.getItem(manualKeyFor(caseId)) || "";
}
function setManual(caseId, verdict) {
  if (!verdict) localStorage.removeItem(manualKeyFor(caseId));
  else localStorage.setItem(manualKeyFor(caseId), verdict);
}

function download(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return await res.json();
}
async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return await res.text();
}

function setFreeze(on) {
  state.freeze = on;
  document.documentElement.classList.toggle("freeze", on);
  const btn = $("#btnFreeze");
  if (btn) btn.textContent = on ? "On" : "Off";
}
function setClean(on) {
  state.clean = on;
  document.documentElement.classList.toggle("clean", on);
  const btn = $("#btnClean");
  if (btn) btn.textContent = on ? "Compact" : "Full";
  localStorage.setItem("contrastlab::cleanView", on ? "1" : "0");
}
function setSim(mode) {
  state.simMode = mode;
  const root = $("#simRoot");
  if (root) root.setAttribute("data-sim", mode);
}

function badgeClass(expected) {
  if (expected === "pass") return "pass";
  if (expected === "fail") return "fail";
  return "review";
}

function tagLabel(tag) {
  return tag;
}

function displayTitle(title) {
  return String(title || "").replace(/\s*—\s*(PASS|FAIL|REVIEW)\b/i, "").trim();
}

function buildTagFilter(manifest) {
  const counts = new Map();
  for (const c of manifest.cases) {
    for (const t of (c.tags || [])) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const sel = $("#tagFilter");
  if (!sel) return;
  sel.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "all";
  sel.appendChild(optAll);
  [...counts.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([tag,count]) => {
    const opt = document.createElement("option");
    opt.value = tag;
    opt.textContent = `${tagLabel(tag)}`;
    sel.appendChild(opt);
  });
  sel.value = state.filterTag || "";
}

function matchesFilters(c) {
  const txt = state.filterText.trim().toLowerCase();
  if (txt) {
    const hay = `${c.id} ${c.title} ${(c.tags||[]).join(" ")} ${(c.sc||[]).join(" ")} ${c.tier||""}`.toLowerCase();
    if (!hay.includes(txt)) return false;
  }
  if (state.filterTag) {
    if (!(c.tags||[]).includes(state.filterTag)) return false;
  }
  if (state.filterTier) {
    if ((c.tier || "core") !== state.filterTier) return false;
  }
  return true;
}

function markButtons(caseId) {
  const verdict = getVerdict(state.toolName || "tool", caseId);
  const opts = [["pass","PASS"],["fail","FAIL"],["review","REVIEW"]];
  const wrap = document.createElement("div");
  wrap.className = "markgroup";
  const label = document.createElement("span");
  label.className = "marklabel";
  label.textContent = "Tool outcome";
  wrap.appendChild(label);
  const row = document.createElement("div");
  row.className = "mark";
  for (const [v,label] of opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "markbtn";
    b.textContent = label;
    b.dataset.sel = verdict === v ? "1" : "0";
    b.addEventListener("click", () => {
      setVerdict(state.toolName || "tool", caseId, v);
      renderCards();
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
  return wrap;
}

function manualButtons(caseId) {
  const verdict = getManual(caseId);
  const opts = [["pass","PASS"],["fail","FAIL"],["review","REVIEW"]];
  const wrap = document.createElement("div");
  wrap.className = "markgroup";
  const label = document.createElement("span");
  label.className = "marklabel";
  label.textContent = "Human interpretation";
  wrap.appendChild(label);
  const row = document.createElement("div");
  row.className = "mark";
  for (const [v,label] of opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "markbtn";
    b.textContent = label;
    b.dataset.sel = verdict === v ? "1" : "0";
    b.addEventListener("click", () => {
      setManual(caseId, v);
      renderCards();
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
  return wrap;
}

async function injectSnippet(container, snippetUrl) {
  const html = await fetchText(snippetUrl);
  container.innerHTML = html;
  runInlineScripts(container);
  renderCanvases(container);
}

function runInlineScripts(container) {
  const scripts = Array.from(container.querySelectorAll("script"));
  for (const old of scripts) {
    const s = document.createElement("script");
    if (old.type) s.type = old.type;
    if (old.noModule) s.noModule = true;
    s.textContent = old.textContent || "";
    old.replaceWith(s);
  }
}

function renderCanvases(container) {
  const canvases = Array.from(container.querySelectorAll("canvas"));
  for (const c of canvases) {
    requestAnimationFrame(() => {
      const ctx = c.getContext && c.getContext("2d");
      if (!ctx) return;
      const w = c.clientWidth || 900;
      const h = c.clientHeight || 340;
      c.width = w; c.height = h;
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.font = "800 84px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("CANVAS", w / 2, h / 2);
    });
  }
}

async function renderCards() {
  const grid = $("#grid");
  grid.innerHTML = "";
  const list = state.manifest.cases.filter(matchesFilters);

  $("#count").textContent = `${list.length} / ${state.manifest.cases.length}`;

  for (const c of list) {
    const card = document.createElement("article");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "cardhead";

    const left = document.createElement("div");
    const ratioNote = (c.ratio && c.threshold) ? `ratio: ${c.ratio} (thr AA ${c.threshold})` : "";
    left.innerHTML = `
      <p class="title">${displayTitle(c.title)}</p>
      <div class="meta">
        <span class="badge">${c.id}</span>
        <span class="badge">${(c.sc||[]).join(",")}</span>
        <span class="badge ${badgeClass(c.expected)}">Expected: ${String(c.expected).toUpperCase()}</span>
        ${ratioNote ? `<span class="badge">${ratioNote}</span>` : ``}
      </div>
    `;

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.flexWrap = "wrap";
    right.style.justifyContent = "flex-end";
    right.innerHTML = `
      <a class="btn" href="case.html?id=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">Open</a>
    `;

    head.appendChild(left);
    head.appendChild(right);

    const body = document.createElement("div");
    body.className = "cardbody";

    const viewportWrap = document.createElement("div");
    viewportWrap.className = "sim-cvd";
    viewportWrap.innerHTML = `<div class="viewport"><span class="label">loading…</span></div>`;

    const actions = document.createElement("div");
    actions.className = "actions";

    const links = document.createElement("div");
    links.className = "actionlinks";
    links.innerHTML = `
      <span class="badge">tags: ${(c.tags||[]).slice(0,4).join(", ")}${(c.tags||[]).length>4?"…":""}</span>
      <span class="badge">tool: ${state.toolName || "—"}</span>
      <span class="badge">human: ${state.visualUser || "—"}</span>
    `;

    actions.appendChild(links);
    actions.appendChild(markButtons(c.id));
    actions.appendChild(manualButtons(c.id));

    body.appendChild(viewportWrap);
    if (c.notes && c.notes.trim()) {
      const det = document.createElement("details");
      det.className = "details";
      det.innerHTML = `<summary>Notes</summary><p class="note">${c.notes}</p>`;
      body.appendChild(det);
    }
    body.appendChild(actions);

    card.appendChild(head);
    card.appendChild(body);
    grid.appendChild(card);

    injectSnippet(viewportWrap, c.snippet).catch(err => {
      viewportWrap.innerHTML = `<div class="viewport"><span class="label">snippet error</span></div><p class="note">${String(err)}</p>`;
    });
  }

  setTimeout(() => renderCanvases(document), 0);
}

function exportCSV() {
  const toolValue = state.toolName.trim();
  const toolFile = toolValue || "tool";
  const now = new Date().toISOString();
  const rows = [];
  rows.push(["tool","user","vision","case_id","expected","tool_outcome","human_interpretation","sc","set","threshold_aa","tags","exported_at"].join(","));
  for (const c of state.manifest.cases.filter(matchesFilters)) {
    const v = getVerdict(toolValue || "tool", c.id) || "";
    const m = getManual(c.id) || "";
    const sc = (c.sc||[]).join("|");
    const tags = (c.tags||[]).join("|");
    const tier = c.tier || "core";
    const simVal = ($("#sim") && $("#sim").value) ? $("#sim").value : (state.simMode || "none");
    const vision = simVal !== "none" ? simVal : "normal";
    rows.push([toolValue, state.visualUser || "", vision, c.id, c.expected, v, m, sc, tier, c.threshold ?? "", tags, now].map(x => `"${String(x).replaceAll('"','""')}"`).join(","));
  }
  download(`contrastlab_${toolFile}_${now.replaceAll(":","-")}.csv`, rows.join("\n"));
}

function resetMarks() {
  const tool = state.toolName.trim() || "tool";
  if (!confirm(`Clear all saved marks and reset the tool name?`)) return;
  for (const c of state.manifest.cases) {
    localStorage.removeItem(keyFor(tool, c.id));
    localStorage.removeItem(manualKeyFor(c.id));
  }
  state.toolName = "";
  state.visualUser = "";
  $("#tool").value = state.toolName;
  $("#toolBadge").textContent = state.toolName || "—";
  $("#user").value = "";
  renderCards();
}

function wireUI() {
  const qEl = $("#q");
  if (qEl) qEl.addEventListener("input", (e) => {
    state.filterText = e.target.value || "";
    renderCards();
  });
  const toolEl = $("#tool");
  if (toolEl) toolEl.addEventListener("input", (e) => {
    state.toolName = (e.target.value || "").trim();
    $("#toolBadge").textContent = state.toolName || "—";
    renderCards();
  });
  const userEl = $("#user");
  if (userEl) userEl.addEventListener("input", (e) => {
    state.visualUser = (e.target.value || "").trim();
    renderCards();
  });
  const simEl = $("#sim");
  if (simEl) simEl.addEventListener("change", (e) => setSim(e.target.value));
  const tagFilter = $("#tagFilter");
  if (tagFilter) {
    tagFilter.addEventListener("change", (e) => {
      state.filterTag = e.target.value || "";
      renderCards();
    });
  }
  const tierFilter = $("#tierFilter");
  if (tierFilter) {
    tierFilter.addEventListener("change", (e) => {
      state.filterTier = e.target.value || "";
      renderCards();
    });
  }
  const btnFreeze = $("#btnFreeze");
  if (btnFreeze) btnFreeze.addEventListener("click", () => setFreeze(!state.freeze));
  const btnClean = $("#btnClean");
  if (btnClean) btnClean.addEventListener("click", () => setClean(!state.clean));
  const btnExport = $("#btnExport");
  if (btnExport) btnExport.addEventListener("click", exportCSV);
  const btnReset = $("#btnReset");
  if (btnReset) btnReset.addEventListener("click", resetMarks);
}

async function main() {
  state.manifest = await fetchJSON("./manifest.json");
  const countEl = $("#caseCount");
  if (countEl) countEl.textContent = String(state.manifest.cases.length);
  buildTagFilter(state.manifest);

  $("#tool").value = state.toolName;
  $("#toolBadge").textContent = state.toolName || "—";
  $("#user").value = state.visualUser;

  setSim("none");
  setFreeze(true);
  setClean((localStorage.getItem("contrastlab::cleanView") || "0") === "1");

  wireUI();
  await renderCards();
}

main().catch(err => {
  $("#grid").innerHTML = `<div class="card"><div class="cardhead"><p class="title">Error</p></div><div class="cardbody"><p class="note">${String(err)}</p><p class="note">Run <span class="code">python -m http.server</span> and reload.</p></div></div>`;
});
