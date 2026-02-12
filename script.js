/* =========================
   Config
========================= */
const CSV_FILE = "./DADOS-CAMPANHA.csv";

const AUTO_SECONDS = 10;
const PAGE_SIZE = 10;

// D:AN = 36 colunas de giro (D até AN)
const GIRO_WINDOW = 10;   // quantas colunas de giro por vez na TV
const GIRO_START_INDEX_EXCEL = 3;   // D = índice 3 (A=0,B=1,C=2,D=3)
const GIRO_END_INDEX_EXCEL = 39;    // AN = índice 39
const TOTAL_INDEX_EXCEL = 40;       // AO = índice 40
const NAME_INDEX_EXCEL = 1;         // B = índice 1
const VIDAS_INDEX_EXCEL = 2;        // C = índice 2

// prêmios (texto direto)
const PRIZES = [
  "🍟 AIR FRYER",
  "📱 CELULAR",
  "🔊 CAIXA DE SOM",
  "⌚ SMARTWATCH",
  "🎧 FONE BLUETOOTH",
  "🎒 MOCHILA",
  "💨 ESCOVA ROTATIVA",
  "🍿 PIPOQUEIRA",
  "🍳 JOGO DE PANELAS"
];

/* =========================
   State
========================= */
let rows = [];                // dados brutos
let champSorted = [];         // ordenado por AO desc
let page = 0;
let paused = false;
let autoTimer = null;

let mode = "champ";           // "champ" | "sheet"
let giroOffset = 0;           // janela de giros na planilha

/* =========================
   Helpers
========================= */
function nowBR(){
  const d = new Date();
  return d.toLocaleString("pt-BR");
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function toInt(v){
  if (v == null) return 0;
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function isGiroValue(v){
  const n = toInt(v);
  return n >= 6 && n <= 11;
}

function csvParse(text){
  // parser robusto (aceita aspas)
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim().length);
  const out = [];
  for (const line of lines){
    const row = [];
    let cur = "";
    let inQuotes = false;

    for (let i=0; i<line.length; i++){
      const ch = line[i];
      if (ch === '"' ){
        // escape ""
        if (inQuotes && line[i+1] === '"'){
          cur += '"'; i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes){
        row.push(cur);
        cur = "";
      } else if (ch === ";" && !inQuotes){
        // se vier separado por ; (muito comum no Excel BR)
        row.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    row.push(cur);
    out.push(row.map(c => c.trim()));
  }
  return out;
}

function ensureEnoughCols(r){
  // garante tamanho mínimo
  const minCols = TOTAL_INDEX_EXCEL + 1;
  if (r.length >= minCols) return r;
  const copy = r.slice();
  while (copy.length < minCols) copy.push("");
  return copy;
}

/* =========================
   UI
========================= */
const elPrizeTrack = document.getElementById("prizeTrack");

const elViewChamp = document.getElementById("viewChamp");
const elViewSheet = document.getElementById("viewSheet");

const elChampList = document.getElementById("champList");
const elSheetTable = document.getElementById("sheetTable");

const elStatusPage = document.getElementById("statusPage");
const elStatusAuto = document.getElementById("statusAuto");
const elStatusLastUpdate = document.getElementById("statusLastUpdate");

const btnModeChamp = document.getElementById("btnModeChamp");
const btnModeSheet = document.getElementById("btnModeSheet");

const btnPrev = document.getElementById("btnPrev");
const btnNext = document.getElementById("btnNext");
const btnPause = document.getElementById("btnPause");

const btnGiroPrev = document.getElementById("btnGiroPrev");
const btnGiroNext = document.getElementById("btnGiroNext");
const statusGiro = document.getElementById("statusGiro");

/* =========================
   Prize ticker
========================= */
function startPrizeTicker(){
  // um item por vez cruzando a faixa
  let idx = 0;

  function spawn(){
    const item = document.createElement("div");
    item.className = "ticker__item";
    item.textContent = PRIZES[idx % PRIZES.length];
    idx++;

    elPrizeTrack.appendChild(item);

    // medidas
    const trackW = elPrizeTrack.clientWidth;
    const itemW = item.getBoundingClientRect().width;

    // velocidade: baseado no tamanho (TV legível)
    const duration = clamp((trackW + itemW) / 120, 6, 12); // 6-12s

    // animação via Web Animations
    const anim = item.animate([
      { transform: `translate(${0}px, -50%)`, offset: 0 },
      { transform: `translate(${- (trackW + itemW)}px, -50%)`, offset: 1 }
    ], {
      duration: duration * 1000,
      easing: "linear"
    });

    // glow quando passa pelo meio (simples: liga no início e desliga após ~40%)
    item.classList.add("is-glow");
    setTimeout(() => item.classList.remove("is-glow"), (duration * 1000) * 0.45);

    anim.onfinish = () => item.remove();
  }

  // dispara sempre, com intervalo fixo
  spawn();
  setInterval(spawn, 2200);
}

/* =========================
   Data load
========================= */
async function loadCSV(){
  const res = await fetch(CSV_FILE, { cache: "no-store" });
  if (!res.ok) throw new Error("Não consegui carregar o CSV.");
  const text = await res.text();

  const parsed = csvParse(text);
  if (!parsed.length) throw new Error("CSV vazio.");

  // Se a primeira linha parecer cabeçalho (contém letras), removemos do dataset
  // Mas como o seu mapeamento é por coluna, isso só evita incluir a linha de título como vendedor.
  const first = parsed[0].join(" ").toUpperCase();
  const looksHeader = first.includes("VENDEDOR") || first.includes("NOME") || first.includes("TOTAL") || first.includes("VIDA") || first.includes("FEVEREIRO");
  const dataLines = looksHeader ? parsed.slice(1) : parsed;

  rows = dataLines
    .map(ensureEnoughCols)
    .filter(r => String(r[NAME_INDEX_EXCEL] || "").trim().length > 0);

  // ranking ordenado por AO
  champSorted = rows.slice().sort((a,b) => toInt(b[TOTAL_INDEX_EXCEL]) - toInt(a[TOTAL_INDEX_EXCEL]));

  elStatusLastUpdate.textContent = `Dados carregados: ${nowBR()}`;
}

/* =========================
   Championship render
========================= */
function pageCount(){
  return Math.max(1, Math.ceil(champSorted.length / PAGE_SIZE));
}

function renderChamp(){
  elChampList.innerHTML = "";

  const totalPages = pageCount();
  page = clamp(page, 0, totalPages - 1);

  const start = page * PAGE_SIZE;
  const slice = champSorted.slice(start, start + PAGE_SIZE);

  slice.forEach((r, i) => {
    const pos = start + i + 1;

    const row = document.createElement("div");
    row.className = "row";

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = `${pos}º`;

    if (pos === 1) badge.classList.add("badge--gold");
    if (pos === 2) badge.classList.add("badge--silver");
    if (pos === 3) badge.classList.add("badge--bronze");

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = String(r[NAME_INDEX_EXCEL] || "").toUpperCase();

    const points = document.createElement("div");
    points.className = "points";
    points.textContent = `${toInt(r[TOTAL_INDEX_EXCEL])}`;

    row.appendChild(badge);
    row.appendChild(name);
    row.appendChild(points);
    elChampList.appendChild(row);
  });

  elStatusPage.textContent = `Página ${page + 1}/${totalPages}`;
}

/* =========================
   Sheet render (planilha)
========================= */
function girosTotalCols(){
  return (GIRO_END_INDEX_EXCEL - GIRO_START_INDEX_EXCEL + 1);
}

function renderSheet(){
  // janela de giros (0..)
  const total = girosTotalCols();
  giroOffset = clamp(giroOffset, 0, Math.max(0, total - GIRO_WINDOW));

  const gStart = GIRO_START_INDEX_EXCEL + giroOffset;
  const gEnd = gStart + GIRO_WINDOW - 1;

  statusGiro.textContent = `Giros: ${giroOffset + 1}–${giroOffset + GIRO_WINDOW}`;

  // Tabela
  const thead = `
    <thead>
      <tr>
        <th style="width:44px">#</th>
        <th style="width:220px">Vendedor</th>
        <th style="width:70px">Vidas</th>
        ${Array.from({length: GIRO_WINDOW}, (_,k)=>`<th>G${giroOffset + k + 1}</th>`).join("")}
        <th style="width:90px">Total</th>
      </tr>
    </thead>
  `;

  const bodyRows = champSorted.map((r, idx) => {
    const nome = String(r[NAME_INDEX_EXCEL] || "").toUpperCase();
    const vidas = toInt(r[VIDAS_INDEX_EXCEL]);

    // conta giros já registrados (número 6..11) em TODO D:AN
    let done = 0;
    for (let c = GIRO_START_INDEX_EXCEL; c <= GIRO_END_INDEX_EXCEL; c++){
      if (isGiroValue(r[c])) done++;
    }

    const pending = Math.max(0, vidas - done);

    // Para cada coluna na janela: se tem número -> azul
    // Se vazio e ainda existe pendência e esta célula é a "próxima" (da esquerda p/ direita) -> rosa
    // Implementação: identificar as posições vazias (na faixa inteira D:AN) e marcar as primeiras "pending" como rosas.
    const emptyIndexes = [];
    for (let c = GIRO_START_INDEX_EXCEL; c <= GIRO_END_INDEX_EXCEL; c++){
      const val = (r[c] ?? "").toString().trim();
      if (!isGiroValue(val) && val === "") emptyIndexes.push(c);
    }
    const pinkSet = new Set(emptyIndexes.slice(0, pending));

    const giroTds = [];
    for (let c = gStart; c <= gEnd; c++){
      const raw = (r[c] ?? "").toString().trim();
      let cls = "";
      let txt = raw;

      if (isGiroValue(raw)) {
        cls = "cell--blue";
        txt = String(toInt(raw));
      } else if (pinkSet.has(c)) {
        cls = "cell--pink";
        txt = ""; // fica rosa vazio (alerta)
      } else {
        txt = ""; // mantém vazio “normal”
      }

      giroTds.push(`<td class="${cls}" style="text-align:center">${txt}</td>`);
    }

    const totalPts = toInt(r[TOTAL_INDEX_EXCEL]);

    return `
      <tr>
        <td style="text-align:center;color:rgba(255,255,255,.6)">${idx+1}</td>
        <td class="td-name">${nome}</td>
        <td class="td-vidas">${vidas || ""}</td>
        ${giroTds.join("")}
        <td class="td-total">${totalPts}</td>
      </tr>
    `;
  }).join("");

  elSheetTable.innerHTML = thead + `<tbody>${bodyRows}</tbody>`;
}

/* =========================
   Auto paging
========================= */
function startAuto(){
  stopAuto();
  autoTimer = setInterval(() => {
    if (paused) return;
    if (mode !== "champ") return;
    page = (page + 1) % pageCount();
    renderChamp();
  }, AUTO_SECONDS * 1000);
  elStatusAuto.textContent = `Auto: ${AUTO_SECONDS}s`;
}

function stopAuto(){
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
}

/* =========================
   Mode
========================= */
function setMode(next){
  mode = next;

  if (mode === "champ"){
    elViewChamp.classList.add("view--active");
    elViewSheet.classList.remove("view--active");

    btnModeChamp.classList.add("btn--primary");
    btnModeSheet.classList.remove("btn--primary");

    renderChamp();
  } else {
    elViewSheet.classList.add("view--active");
    elViewChamp.classList.remove("view--active");

    btnModeSheet.classList.add("btn--primary");
    btnModeChamp.classList.remove("btn--primary");

    renderSheet();
  }
}

/* =========================
   Events
========================= */
btnModeChamp.addEventListener("click", () => setMode("champ"));
btnModeSheet.addEventListener("click", () => setMode("sheet"));

btnPrev.addEventListener("click", () => {
  page = (page - 1 + pageCount()) % pageCount();
  renderChamp();
});

btnNext.addEventListener("click", () => {
  page = (page + 1) % pageCount();
  renderChamp();
});

btnPause.addEventListener("click", () => {
  paused = !paused;
  btnPause.textContent = paused ? "▶ Retomar" : "⏸ Pausar";
});

btnGiroPrev.addEventListener("click", () => {
  giroOffset = Math.max(0, giroOffset - GIRO_WINDOW);
  renderSheet();
});
btnGiroNext.addEventListener("click", () => {
  const total = girosTotalCols();
  giroOffset = Math.min(Math.max(0, total - GIRO_WINDOW), giroOffset + GIRO_WINDOW);
  renderSheet();
});

// Teclas para TV (opcional)
window.addEventListener("keydown", (e) => {
  if (e.key === " "){ e.preventDefault(); paused = !paused; btnPause.textContent = paused ? "▶ Retomar" : "⏸ Pausar"; }
  if (e.key === "ArrowLeft"){ page = (page - 1 + pageCount()) % pageCount(); renderChamp(); }
  if (e.key === "ArrowRight"){ page = (page + 1) % pageCount(); renderChamp(); }
  if (e.key.toLowerCase() === "p"){ setMode("sheet"); }
  if (e.key.toLowerCase() === "c"){ setMode("champ"); }
});

/* =========================
   Init
========================= */
(async function init(){
  startPrizeTicker();

  try{
    await loadCSV();
    setMode("champ");
    startAuto();
  }catch(err){
    elStatusLastUpdate.textContent = `Erro: ${err.message}`;
    console.error(err);
  }
})();
