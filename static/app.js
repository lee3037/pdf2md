"use strict";

const $ = (id) => document.getElementById(id);
const CONVERT_KEYS = ["ocr_mode", "ocr_dpi", "remove_header_footer"];
const CHUNK_KEYS = ["separator", "max_chars", "min_chars", "context", "include_pages", "table_mode", "table_max_rows"];
const STORE_KEY = "pdf2md.settings.v1";

const state = {
  file: null,
  jobId: null,
  filename: "",
  appliedChunkOpts: null, // 当前编辑器内容对应的分块参数
  dirty: false, // 编辑器是否有手工修改
  pdfLoadedFor: null,
  polling: null,
};

// ------------------------------------------------------------ Markdown 渲染（转义原始 HTML，限制链接协议）

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
marked.use({
  gfm: true,
  renderer: {
    html(token) { return escapeHtml(typeof token === "string" ? token : token.text); },
    link(token) {
      const text = this.parser.parseInline(token.tokens);
      const href = token.href || "";
      return /^(https?:|mailto:|#)/i.test(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${text}</a>` : text;
    },
    image(token) { return escapeHtml(token.text || ""); },
  },
});
const renderMd = (md) => marked.parse(md || "");

// ------------------------------------------------------------ 设置

function readSettings() {
  const o = {};
  for (const k of [...CONVERT_KEYS, ...CHUNK_KEYS]) {
    const el = $(k);
    if (el.type === "checkbox") o[k] = el.checked;
    else if (el.type === "number") o[k] = Number(el.value || 0);
    else o[k] = el.value;
  }
  if (!o.separator.trim()) o.separator = "===CHUNK===";
  return o;
}

function writeSettings(o) {
  for (const [k, v] of Object.entries(o)) {
    const el = $(k);
    if (!el || v === undefined || v === null) continue;
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v;
  }
}

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const sameOpts = (a, b, keys) => keys.every((k) => String(a?.[k]) === String(b?.[k]));

async function initSettings() {
  try {
    const d = await (await fetch("api/defaults")).json();
    writeSettings(d);
  } catch (_) { /* 使用页面默认值 */ }
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved) writeSettings(saved);
  } catch (_) { /* 忽略 */ }
  if (!$("separator").value) $("separator").value = "===CHUNK===";
}

function saveSettings() {
  localStorage.setItem(STORE_KEY, JSON.stringify(readSettings()));
}

// ------------------------------------------------------------ 上传与转换

function setFile(f) {
  if (!f) return;
  if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
    alert("请选择 PDF 文件");
    return;
  }
  state.file = f;
  $("dz-text").textContent = `${f.name}（${(f.size / 1048576).toFixed(1)} MB）`;
  $("btn-convert").disabled = false;
}

function setProgress(visible, pct, text) {
  $("progress").classList.toggle("hidden", !visible);
  $("progress-bar").style.width = `${Math.round(pct * 100)}%`;
  $("progress-text").textContent = text || "";
}

async function startConvert() {
  if (!state.file) return;
  if (state.dirty && !confirm("编辑器中有未下载的手工修改，重新转换会覆盖，确定继续？")) return;
  saveSettings();
  const opts = readSettings();
  const fd = new FormData();
  fd.append("file", state.file);
  fd.append("options", JSON.stringify(opts));
  $("btn-convert").disabled = true;
  setProgress(true, 0, "上传中…");
  try {
    const resp = await fetch("api/jobs", { method: "POST", body: fd });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || resp.statusText);
    state.jobId = data.id;
    state.filename = state.file.name;
    state.pdfLoadedFor = null;
    state.pendingChunkOpts = pick(opts, CHUNK_KEYS);
    $("doc-title").textContent = `${state.filename} · ${data.page_count} 页`;
    pollJob();
  } catch (e) {
    setProgress(true, 0, `失败：${e.message}`);
    $("btn-convert").disabled = false;
  }
}

function pollJob() {
  clearTimeout(state.polling);
  const t0 = Date.now();
  const tick = async () => {
    try {
      const resp = await fetch(`api/jobs/${state.jobId}`);
      const job = await resp.json();
      if (!resp.ok) throw new Error(job.detail || resp.statusText);
      const p = job.progress || { done: 0, total: 1 };
      const secs = Math.round((Date.now() - t0) / 1000);
      if (job.status === "done") {
        setProgress(true, 1, `完成，用时 ${job.elapsed} 秒`);
        $("btn-convert").disabled = false;
        showResult(job.result, state.pendingChunkOpts, job.elapsed);
        return;
      }
      if (job.status === "error") {
        setProgress(true, 0, `转换失败：${job.error}`);
        $("btn-convert").disabled = false;
        return;
      }
      const label = job.status === "queued" ? "排队中" : `解析中 ${p.done}/${p.total} 页`;
      setProgress(true, p.total ? p.done / p.total : 0, `${label} · 已用 ${secs} 秒`);
    } catch (e) {
      setProgress(true, 0, `查询进度失败：${e.message}`);
      $("btn-convert").disabled = false;
      return;
    }
    state.polling = setTimeout(tick, 800);
  };
  tick();
}

function showResult(result, chunkOpts, elapsed) {
  $("editor").value = result.markdown;
  state.appliedChunkOpts = chunkOpts;
  state.dirty = false;
  state.lastResult = result;
  if (elapsed !== undefined) state.elapsed = elapsed;
  $("edit-state").textContent = "";
  for (const id of ["btn-copy", "btn-download", "btn-rechunk"]) $(id).disabled = false;
  renderStats(result);
  refreshViews();
}

// ------------------------------------------------------------ 统计

function renderStats(r) {
  const d = r.doc_stats || {};
  const items = [
    ["页数", d.pages], ["OCR 页数", d.ocr_pages], ["标题", d.headings], ["表格", d.tables],
    ["跨页表格合并", d.tables_merged], ["跨页/跨栏段落合并", d.paragraphs_merged],
    ["去除页眉页脚/页码", d.removed_header_footer], ["转换用时", state.elapsed !== undefined ? `${state.elapsed} 秒` : "-"],
  ];
  $("stats").classList.remove("muted");
  $("stats").innerHTML = items.map(([k, v]) => `<span>${k}</span><b>${v ?? "-"}</b>`).join("");
  $("warnings").innerHTML = (r.warnings || []).map((w) => `<li>${escapeHtml(w)}</li>`).join("");
}

// ------------------------------------------------------------ 分块视图 / 预览

function currentSeparator() {
  return state.appliedChunkOpts?.separator || readSettings().separator;
}

function splitChunks(text, sep) {
  return text.split(sep).map((s) => s.trim()).filter(Boolean);
}

function chunkMeta(text) {
  const pm = text.match(/页码：(\d+)(?:-(\d+))?/);
  const cm = text.match(/章节：(.+?)(?:\s*｜|\n|$)/);
  const hm = text.match(/^#{1,6}\s+(.+)$/m);
  return {
    page: pm ? Number(pm[1]) : null,
    pages: pm ? (pm[2] ? `${pm[1]}-${pm[2]}` : pm[1]) : "",
    path: cm ? cm[1] : hm ? hm[1] : "",
  };
}

function renderChunks() {
  const sep = currentSeparator();
  const text = $("editor").value;
  const box = $("chunks");
  if (!text.trim()) {
    box.innerHTML = "暂无内容";
    box.classList.add("muted");
    $("chunk-count").textContent = "";
    return;
  }
  box.classList.remove("muted");
  const max = Number(state.appliedChunkOpts?.max_chars || readSettings().max_chars);
  const min = Number(state.appliedChunkOpts?.min_chars || 0);
  const chunks = splitChunks(text, sep);
  $("chunk-count").textContent = chunks.length;
  const open = new Set([...box.querySelectorAll(".chunk.raw-mode")].map((el) => el.dataset.idx));
  box.innerHTML = chunks.map((c, i) => {
    const m = chunkMeta(c);
    const len = c.length;
    const cls = len > max ? "over" : len < min ? "small" : "";
    const raw = open.has(String(i));
    return `<div class="chunk ${cls} ${raw ? "raw-mode" : ""}" data-idx="${i}">
      <div class="chunk-head">
        <span class="idx">#${i + 1}</span>
        <span class="len ${len > max ? "over" : ""}">${len} 字${len > max ? "（超长）" : len < min ? "（偏短）" : ""}</span>
        ${m.pages ? `<span class="pages" data-page="${m.page}" title="在原 PDF 中查看">第 ${m.pages} 页</span>` : ""}
        <span class="path" title="${escapeHtml(m.path)}">${escapeHtml(m.path)}</span>
        <button class="toggle" type="button">${raw ? "渲染" : "原文"}</button>
      </div>
      <div class="chunk-body ${raw ? "" : "markdown-body"}">${raw ? `<pre class="raw">${escapeHtml(c)}</pre>` : renderMd(c)}</div>
    </div>`;
  }).join(`<div class="sep-line">${escapeHtml(sep)}</div>`);
}

function renderPreview() {
  const sep = currentSeparator();
  const el = $("preview");
  el.innerHTML = renderMd($("editor").value);
  for (const p of el.querySelectorAll("p")) {
    if (p.textContent.trim() === sep.trim()) p.classList.add("chunk-sep");
  }
}

function activeTab() {
  return document.querySelector(".tab.active").dataset.tab;
}

function refreshViews() {
  const tab = activeTab();
  if (tab === "chunks") renderChunks();
  else if (tab === "preview") renderPreview();
  else if (tab === "pdf") showPdf();
  if (tab !== "chunks") $("chunk-count").textContent = splitChunks($("editor").value, currentSeparator()).length || "";
}

function showPdf(page) {
  if (!state.jobId) return;
  const frame = $("pdf-frame");
  const url = `api/jobs/${state.jobId}/pdf`;
  if (page) {
    frame.src = `${url}#page=${page}`;
    state.pdfLoadedFor = state.jobId;
  } else if (state.pdfLoadedFor !== state.jobId) {
    frame.src = url;
    state.pdfLoadedFor = state.jobId;
  }
}

function switchTab(name) {
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === name);
  for (const b of ["chunks", "preview", "pdf"]) $(`tab-${b}`).classList.toggle("hidden", b !== name);
  refreshViews();
}

// ------------------------------------------------------------ 重新分块 / 替换分隔符

async function applyChunkSettings() {
  saveSettings();
  const opts = pick(readSettings(), CHUNK_KEYS);
  const prev = state.appliedChunkOpts;
  const others = CHUNK_KEYS.filter((k) => k !== "separator");
  if (prev && sameOpts(opts, prev, others)) {
    // 只改了分隔符：在编辑器中直接替换，保留手工修改
    if (opts.separator !== prev.separator) {
      const text = $("editor").value;
      $("editor").value = text.split(prev.separator).join(opts.separator);
      state.appliedChunkOpts = { ...prev, separator: opts.separator };
      if (text.includes(opts.separator)) alert("注意：原文中已包含新的分隔符文本，导入时可能被误切分。");
      refreshViews();
    }
    return;
  }
  if (state.dirty && !confirm("重新分块会覆盖编辑器中的手工修改，确定继续？")) return;
  $("btn-rechunk").disabled = true;
  try {
    const resp = await fetch(`api/jobs/${state.jobId}/rechunk`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ options: opts }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || resp.statusText);
    showResult(data, opts);
  } catch (e) {
    alert(`重新分块失败：${e.message}`);
  } finally {
    $("btn-rechunk").disabled = false;
  }
}

// ------------------------------------------------------------ 导出

function download() {
  const text = $("editor").value;
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (state.filename || "document.pdf").replace(/\.pdf$/i, "") + ".md";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  state.dirty = false;
  $("edit-state").textContent = "";
}

async function copyAll() {
  const text = $("editor").value;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    $("editor").select();
    document.execCommand("copy");
  }
  $("btn-copy").textContent = "已复制";
  setTimeout(() => ($("btn-copy").textContent = "复制"), 1200);
}

// ------------------------------------------------------------ 事件绑定

function bind() {
  const dz = $("dropzone");
  $("file").addEventListener("change", (e) => setFile(e.target.files[0]));
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    setFile(e.dataTransfer.files[0]);
  });
  $("btn-convert").addEventListener("click", startConvert);
  $("btn-rechunk").addEventListener("click", applyChunkSettings);
  $("btn-download").addEventListener("click", download);
  $("btn-copy").addEventListener("click", copyAll);
  for (const b of document.querySelectorAll("#sep-presets button")) {
    b.addEventListener("click", () => { $("separator").value = b.dataset.sep; });
  }
  for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => switchTab(t.dataset.tab));
  let timer = null;
  $("editor").addEventListener("input", () => {
    state.dirty = true;
    $("edit-state").textContent = "· 已修改";
    clearTimeout(timer);
    timer = setTimeout(refreshViews, 300);
  });
  $("chunks").addEventListener("click", (e) => {
    const pages = e.target.closest(".pages");
    if (pages) {
      switchTab("pdf");
      showPdf(pages.dataset.page);
      return;
    }
    const toggle = e.target.closest(".toggle");
    if (toggle) {
      toggle.closest(".chunk").classList.toggle("raw-mode");
      renderChunks();
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });
}

initSettings().then(bind);
