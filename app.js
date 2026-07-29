// ---------- config ----------

const CATEGORIES = {
  smallpublishing:    { label: "small publishing",    color: "var(--cat-smallpublishing)" },
  arttheory: { label: "art theory", color: "var(--cat-arttheory)" },
  politicaltheory:     { label: "political theory",     color: "var(--cat-politheory)" },
  theology:       { label: "theology",   color: "var(--cat-theo)" },
  philosophy:       { label: "philosophy",   color: "var(--cat-phil)" },
  currentevents: {label: "current events", color: "var(--cat-current)"},
  other:       { label: "other",        color: "var(--cat-other)" },
};

const BOARD_WIDTH = 4000;
const BOARD_HEIGHT = 3000;
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.6;
const CARD_W = 240;

// ---------- state ----------

const nodes = new Map();   // id -> node row
const MY_NODES_KEY = "rabbithole_my_nodes";
let editingNodeId = null;

function getMyNodes() {
  try { return JSON.parse(localStorage.getItem(MY_NODES_KEY) || "[]"); }
  catch { return []; }
}
function addMyNode(id) {
  const ids = getMyNodes();
  ids.push(id);
  localStorage.setItem(MY_NODES_KEY, JSON.stringify(ids));
}
function isMyNode(id) {
  return getMyNodes().includes(id);
}
const edges = new Map();   // id -> edge row
const cardEls = new Map(); // id -> DOM element

let view = { scale: 0.7, tx: -600, ty: -400 };
let connectMode = false;
let connectSource = null;
let pendingSpawn = null; // board coords for next new card

// ---------- splash ----------
// Wired first and independently of everything below, so a bad Supabase
// config or a blocked CDN script can never prevent the splash from
// dismissing.

function wireSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  let dismissed = false;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    splash.classList.add("fade-out");
    setTimeout(() => splash.classList.add("gone"), 1200);
  }

  splash.addEventListener("click", dismiss);
  window.addEventListener("keydown", dismiss, { once: true });
  setTimeout(dismiss, 2600); // auto-fade if nobody interacts
}

wireSplash();

// ---------- supabase ----------

let sb = null;
try {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.error("Supabase failed to initialize — check config.js", err);
}

// ---------- dom refs ----------

const viewport = document.getElementById("board-viewport");
const board = document.getElementById("board");
const threadsSvg = document.getElementById("threads");
const cardsLayer = document.getElementById("cards-layer");
const emptyState = document.getElementById("empty-state");
const legend = document.getElementById("legend");
const connectBanner = document.getElementById("connect-banner");

const modalBackdrop = document.getElementById("modal-backdrop");
const addForm = document.getElementById("add-form");
const fTitle = document.getElementById("f-title");
const fNotes = document.getElementById("f-notes");
const fUrl = document.getElementById("f-url");
const fCategory = document.getElementById("f-category");
const fAuthor = document.getElementById("f-author");

// ---------- init ----------

buildLegend();
buildCategorySelect();
applyViewTransform();

if (sb) {
  loadBoard();
  subscribeRealtime();
} else {
  emptyState.textContent = "[ CONNECTION FAILED — check config.js ]";
  emptyState.classList.remove("hidden");
}

wireControls();

// ---------- legend + form select ----------

function buildLegend() {
  legend.innerHTML = "";
  for (const key in CATEGORIES) {
    const item = document.createElement("span");
    item.className = "legend-item";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = CATEGORIES[key].color;
    dot.style.color = CATEGORIES[key].color;
    const label = document.createElement("span");
    label.textContent = CATEGORIES[key].label;
    item.appendChild(dot);
    item.appendChild(label);
    legend.appendChild(item);
  }
}

function buildCategorySelect() {
  fCategory.innerHTML = "";
  for (const key in CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = CATEGORIES[key].label;
    fCategory.appendChild(opt);
  }
}

// ---------- data load ----------

async function loadBoard() {
  const [{ data: nodeRows, error: nodeErr }, { data: edgeRows, error: edgeErr }] =
    await Promise.all([
      sb.from("nodes").select("*"),
      sb.from("edges").select("*"),
    ]);

  if (nodeErr || edgeErr) {
    console.error(nodeErr || edgeErr);
    emptyState.textContent = "[ CONNECTION FAILED — check config.js ]";
    emptyState.classList.remove("hidden");
    return;
  }

  nodeRows.forEach((n) => { nodes.set(n.id, n); renderCard(n); });
  edgeRows.forEach((e) => { edges.set(e.id, e); });
  redrawThreads();
  updateEmptyState();
}

function subscribeRealtime() {
  sb
    .channel("board-changes")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "nodes" }, (payload) => {
      if (nodes.has(payload.new.id)) return;
      nodes.set(payload.new.id, payload.new);
      renderCard(payload.new);
      updateEmptyState();
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "nodes" }, (payload) => {
      nodes.set(payload.new.id, payload.new);
      const el = cardEls.get(payload.new.id);
      if (!el || el.dataset.dragging) return;
      el.remove();
      cardEls.delete(payload.new.id);
      renderCard(payload.new);
      redrawThreads();
    })
    .subscribe();
}

function updateEmptyState() {
  emptyState.classList.toggle("hidden", nodes.size > 0);
}

// ---------- card ("window") rendering ----------

function renderCard(node) {
  const el = document.createElement("div");
  el.className = "card";
  el.style.left = node.x + "px";
  el.style.top = node.y + "px";
  el.dataset.id = node.id;
  el.tabIndex = 0;

  const cat = CATEGORIES[node.category] || CATEGORIES.other;
  el.style.setProperty("--glow-color", cat.color);
  const isTitleCard = !node.notes || !node.notes.trim();
if (isTitleCard) el.classList.add("card-title-only");

  // titlebar: LED + subject + decorative window buttons
  const titlebar = document.createElement("div");
  titlebar.className = "card-titlebar";

  const led = document.createElement("span");
  led.className = "pin";
  led.style.background = cat.color;
  led.style.color = cat.color; // powers the currentColor glow
  titlebar.appendChild(led);

  const title = document.createElement("span");
  title.className = "card-title";
  title.textContent = node.title;
  titlebar.appendChild(title);

  if (isMyNode(node.id)) {
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "card-edit-btn";
  editBtn.textContent = "edit";
      editBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEditModal(node);
  });
  titlebar.appendChild(editBtn);
}

  const winButtons = document.createElement("span");
  winButtons.className = "card-winbuttons";
  winButtons.innerHTML = "<span></span><span></span><span></span>";
  titlebar.appendChild(winButtons);

  el.appendChild(titlebar);

  // content: notes + link, wiki-article style
  const content = document.createElement("div");
  content.className = "card-content";

  if (node.notes) {
    const notes = document.createElement("div");
    notes.className = "card-notes";
    notes.textContent = node.notes;
    content.appendChild(notes);
  }

  if (node.url && /^https?:\/\//i.test(node.url)) {
    const link = document.createElement("a");
    link.className = "card-link";
    link.href = node.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = shortenUrl(node.url);
    content.appendChild(link);
  }

  el.appendChild(content);

  // statusbar: author + category
  const meta = document.createElement("div");
  meta.className = "card-meta";
  const author = document.createElement("span");
  author.textContent = node.author || "anonymous";
  const catLabel = document.createElement("span");
  catLabel.textContent = cat.label;
  meta.appendChild(author);
  meta.appendChild(catLabel);
  el.appendChild(meta);

  wireCardDrag(el, node);
  el.addEventListener("click", (e) => onCardClick(e, node));

  updateCardHighlight(el, node);
  cardsLayer.appendChild(el);
  cardEls.set(node.id, el);
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

// ---------- threads (rendered as right-angle circuit traces) ----------

function openEditModal(node) {
  editingNodeId = node.id;
  fTitle.value = node.title;
  fNotes.value = node.notes || "";
  fUrl.value = node.url || "";
  fCategory.value = node.category;
  fAuthor.value = node.author || "";
  document.getElementById("form-modal-title").textContent = "edit_window.exe";
  addForm.querySelector('button[type="submit"]').textContent = "save_window";
  modalBackdrop.classList.remove("hidden");
  fTitle.focus();
}

function openAddModal() {
  editingNodeId = null;
  document.getElementById("form-modal-title").textContent = "new_window.exe";
  addForm.querySelector('button[type="submit"]').textContent = "open_window";

  const rect = viewport.getBoundingClientRect();
  const cx = (rect.width / 2 - view.tx) / view.scale;
  const cy = (rect.height / 2 - view.ty) / view.scale;
  pendingSpawn = {
    x: cx - CARD_W / 2 + (Math.random() * 60 - 30),
    y: cy - 20 + (Math.random() * 60 - 30),
  };
  addForm.reset();
  modalBackdrop.classList.remove("hidden");
  fTitle.focus();
}

function closeAddModal() {
  modalBackdrop.classList.add("hidden");
}

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = fTitle.value.trim();
  if (!title) return;

  const fields = {
    title,
    notes: fNotes.value.trim(),
    url: fUrl.value.trim() || null,
    category: fCategory.value,
    author: fAuthor.value.trim() || "anonymous",
  };

  const submitBtn = addForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  let error, data;
  if (editingNodeId) {
    ({ error } = await sb.from("nodes").update(fields).eq("id", editingNodeId));
  } else {
    ({ data, error } = await sb.from("nodes").insert({
      ...fields,
      x: pendingSpawn.x,
      y: pendingSpawn.y,
      rotation: 0,
    }).select().single());
  }

  submitBtn.disabled = false;

  if (error) {
    console.error(error);
    alert(editingNodeId ? "edit failed — try again." : "window failed to open — try again in a moment.");
    return;
  }

  if (data) addMyNode(data.id); // only fires on insert
  closeAddModal();
});

function redrawThreads() {
  threadsSvg.innerHTML = "";
  edges.forEach((edge) => drawThread(edge));
}


function drawThread(edge) {
  const a = nodes.get(edge.source_id);
  const b = nodes.get(edge.target_id);
  if (!a || !b) return;

  const ax = a.x + CARD_W / 2, ay = a.y + 14;
  const bx = b.x + CARD_W / 2, by = b.y + 14;

  // deterministic step point so the trace looks the same for everyone
  const seed = hashString(edge.id);
  const horizFirst = seed % 2 === 0;
  const midx = horizFirst ? bx : ax;
  const midy = horizFirst ? ay : by;

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", `M ${ax} ${ay} L ${midx} ${midy} L ${bx} ${by}`);
  path.setAttribute("class", "thread-line");
  path.dataset.edgeId = edge.id;
  threadsSvg.appendChild(path);

  [[ax, ay], [midx, midy], [bx, by]].forEach(([x, y]) => {
    const via = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    via.setAttribute("cx", x);
    via.setAttribute("cy", y);
    via.setAttribute("r", 3);
    via.setAttribute("class", "thread-via");
    threadsSvg.appendChild(via);
  });
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

// ---------- pan + zoom ----------

function applyViewTransform() {
  board.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
}

(function wirePanZoom() {
  let panning = false;
  let startX, startY, startTx, startTy;

  viewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".card")) return;
    panning = true;
    viewport.classList.add("panning");
    startX = e.clientX; startY = e.clientY;
    startTx = view.tx; startTy = view.ty;
    viewport.setPointerCapture(e.pointerId);
  });

  viewport.addEventListener("pointermove", (e) => {
    if (!panning) return;
    view.tx = startTx + (e.clientX - startX);
    view.ty = startTy + (e.clientY - startY);
    applyViewTransform();
  });

  viewport.addEventListener("pointerup", () => {
    panning = false;
    viewport.classList.remove("panning");
  });

  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const boardX = (px - view.tx) / view.scale;
    const boardY = (py - view.ty) / view.scale;

    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale + delta));

    view.tx = px - boardX * newScale;
    view.ty = py - boardY * newScale;
    view.scale = newScale;
    applyViewTransform();
  }, { passive: false });
})();

function centerBoard() {
  const rect = viewport.getBoundingClientRect();
  view.scale = 0.7;
  view.tx = rect.width / 2 - (BOARD_WIDTH / 2) * view.scale;
  view.ty = rect.height / 2 - (BOARD_HEIGHT / 2) * view.scale;
  applyViewTransform();
}

// ---------- card drag ----------

function wireCardDrag(el, node) {
  let dragging = false;
  let startX, startY, origX, origY;
  let moved = false;
  let debounceTimer = null;

  el.addEventListener("pointerdown", (e) => {
    if (connectMode) return; // clicks handled separately in connect mode
    dragging = true;
    moved = false;
    el.dataset.dragging = "1";
    startX = e.clientX; startY = e.clientY;
    origX = parseFloat(el.style.left);
    origY = parseFloat(el.style.top);
    el.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });

  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = (e.clientX - startX) / view.scale;
    const dy = (e.clientY - startY) / view.scale;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
    const newX = origX + dx;
    const newY = origY + dy;
    el.style.left = newX + "px";
    el.style.top = newY + "px";
    node.x = newX;
    node.y = newY;
    redrawThreads();
  });

  el.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    delete el.dataset.dragging;
    e.stopPropagation();
    if (moved) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        sb.from("nodes").update({ x: node.x, y: node.y }).eq("id", node.id)
          .then(({ error }) => { if (error) console.error(error); });
      }, 250);
    }
  });
}

// ---------- connect ("trace a connection") mode ----------

function onCardClick(e, node) {
  if (!connectMode) return;
  e.stopPropagation();

  if (!connectSource) {
    connectSource = node;
    cardEls.get(node.id).classList.add("connect-source");
    return;
  }

  if (connectSource.id === node.id) return; // no self-trace

  const already = [...edges.values()].some(
    (edge) =>
      (edge.source_id === connectSource.id && edge.target_id === node.id) ||
      (edge.source_id === node.id && edge.target_id === connectSource.id)
  );

  const sourceEl = cardEls.get(connectSource.id);

  if (already) {
    sourceEl.classList.remove("connect-source");
    connectSource = null;
    return;
  }

  sb.from("edges").insert({
    source_id: connectSource.id,
    target_id: node.id,
  }).then(({ error }) => {
    if (error) {
      console.error(error);
      alert("trace failed — check the console for details.");
      return; // stays highlighted so you can see something went wrong and retry
    }
    sourceEl.classList.remove("connect-source");
    connectSource = null;
  });
}

function setConnectMode(on) {
  connectMode = on;
  connectBanner.classList.toggle("hidden", !on);
  if (!on && connectSource) {
    cardEls.get(connectSource.id)?.classList.remove("connect-source");
    connectSource = null;
  }
  document.getElementById("btn-connect").classList.toggle("tool-btn-primary", on);
}

// ---------- wire top-level controls ----------

function wireControls() {
  document.getElementById("btn-add").addEventListener("click", openAddModal);
  document.getElementById("f-cancel").addEventListener("click", closeAddModal);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeAddModal();
  });

  document.getElementById("btn-connect").addEventListener("click", () => setConnectMode(!connectMode));
  document.getElementById("btn-connect-cancel").addEventListener("click", () => setConnectMode(false));
  document.getElementById("btn-center").addEventListener("click", centerBoard);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!modalBackdrop.classList.contains("hidden")) closeAddModal();
      if (connectMode) setConnectMode(false);
    }
  });

  centerBoard();
}

function buildLegend() {
  legend.innerHTML = "";
  for (const key in CATEGORIES) {
    const item = document.createElement("span");
    item.className = "legend-item";
    item.dataset.category = key;
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = CATEGORIES[key].color;
    dot.style.color = CATEGORIES[key].color;
    const label = document.createElement("span");
    label.textContent = CATEGORIES[key].label;
    item.appendChild(dot);
    item.appendChild(label);
    item.addEventListener("click", () => toggleCategoryHighlight(key));
    legend.appendChild(item);
  }
}

let highlightedCategory = null;

function toggleCategoryHighlight(key) {
  highlightedCategory = highlightedCategory === key ? null : key;
  legend.querySelectorAll(".legend-item").forEach((el) => {
    el.classList.toggle("legend-item-active", el.dataset.category === highlightedCategory);
  });
  cardEls.forEach((el, id) => {
    const node = nodes.get(id);
    if (node) updateCardHighlight(el, node);
  });
}

function updateCardHighlight(el, node) {
  if (!highlightedCategory) {
    el.classList.remove("card-glow", "card-dim");
    return;
  }
  if (node.category === highlightedCategory) {
    el.classList.add("card-glow");
    el.classList.remove("card-dim");
  } else {
    el.classList.add("card-dim");
    el.classList.remove("card-glow");
  }
}
