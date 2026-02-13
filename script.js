/* =========================
   Config
========================= */
const CSV_FILE = "./DADOS-CAMPANHA.csv";

// janela de giros mostrada na TV
const GIRO_WINDOW = 10;

// IMPORTANTE: seus índices estão ajustados para CSV SEM coluna A
// (nome na 1ª coluna do CSV)
const NAME_INDEX = 0;        // vendedor
const VIDAS_INDEX = 1;       // vidas
const GIRO_START_INDEX = 2;  // início dos giros
const GIRO_END_INDEX = 38;   // fim dos giros
const TOTAL_INDEX = 39;      // total

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
let rows = [];          // dados brutos
let sorted = [];        // ordenado por total desc
let giroOffset = 0;     // janela de giros (0..)

/* =========================
   Helpers
========================= */
function nowBR(){
  return new Date().toLocaleString("pt-BR");
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
  // aceita vírgula ou ponto-e-vírgula, com aspas
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim().length);
  const out = [];

  for (const line of lines){
    const row = [];
    let cur = "";
    let inQuotes = false;

    for (let i=0; i<line.length; i++){
      const ch = line[i];

      if (ch === '"'){
        if (inQuotes && line[i+1] === '"'){
          cur += '"'; i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((ch === "," || ch === ";") && !inQuotes){
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
  const minCols = TOTAL_INDEX + 1;
  if (r.length >= minCols) return r;
  const copy = r.slice();
  while (copy.length < minCols) copy.push("");
  return copy;
}

/* =========================
   UI refs
========================= */
const elPrizeTrack = document.getElementById("prizeTrack");
const elSheetTable = document.getElementById("sheetTable");
const elStatusLastUpdate = document.getElementById("statusLastUpdate");
const statusGiro = document.getElementById("statusGiro");

const btnGiroPrev = document.getElementById("btnGiroPrev");
const btnGiroNext = document.getElementById("btnGiroNext");

/* =========================
   Prize ticker
========================= */
function startPrizeTicker(){
  let idx = 0;

  function spawn(){
    if (!elPrizeTrack) return;

    const item = document.createElement("div");
    item.className = "ticker__item";
    item.textContent = PRIZES[idx % PRIZES.length];
    idx++;

    elPrizeTrack.appendChild(item);

    const trackW = elPrizeTrack.clientWidth;
    const itemW = item.getBoundingClientRect().width;

    const duration = clamp((trackW + itemW) / 120, 6, 12);

    const anim = item.animate([
      { transform: `translate(${0}px, -50%)`, offset: 0 },
      { transform: `translate(${- (trackW + itemW)}px, -50%)`, offset: 1 }
    ], { duration: duration * 1000, easing: "linear" });

    item.classList.add("is-glow");
    setTimeout(() => item.classList.remove("is-glow"), (duration * 1000) * 0.45);

    anim.onfinish = () => item.remove();
  }

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

  // tenta detectar cabeçalho (se houver)
  const first = parsed[0].join(" ").toUpperCase();
  const looksHeader =
    first.includes("VENDEDOR") ||
    first.includes("NOME") ||
    first.includes("TOTAL") ||
    first.includes("VIDA") ||
    first.includes("VIDAS");

  const dataLines = looksHeader ? parsed.slice(1) : parsed;

  rows = dataLines
    .map(ensureEnoughCols)
    .filter(r => String(r[NAME_INDEX] || "").trim().length > 0);

  sorted = rows.slice().sort((a,b) => toInt(b[TOTAL_INDEX]) - toInt(a[TOTAL_INDEX]));

  elStatusLastUpdate.textContent = `Dados carregados: ${nowBR()}`;
}

/* =========================
   Sheet render
========================= */
function girosTotalCols(){
  return (GIRO_END_INDEX - GIRO_START_INDEX + 1);
}

function renderSheet(){
  if (!elSheetTable) return;

  const total = girosTotalCols();
  giroOffset = clamp(giroOffset, 0, Math.max(0, total - GIRO_WINDOW));

  const gStart = GIRO_START_INDEX + giroOffset;
  const gEnd = gStart + GIRO_WINDOW - 1;

  if (statusGiro) statusGiro.textContent = `Giros: ${giroOffset + 1}–${giroOffset + GIRO_WINDOW}`;

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

  const bodyRows = sorted.map((r, idx) => {
    const nome = String(r[NAME_INDEX] || "").toUpperCase();
    const vidas = toInt(r[VIDAS_INDEX]);

    // quantos giros já registrados (6..11) no conjunto todo
    let done = 0;
    for (let c = GIRO_START_INDEX; c <= GIRO_END_INDEX; c++){
      if (isGiroValue(r[c])) done++;
    }

    const pending = Math.max(0, vidas - done);

    // identifica vazios e pinta os primeiros "pending" como rosa
    const emptyIndexes = [];
    for (let c = GIRO_START_INDEX; c <= GIRO_END_INDEX; c++){
      const val = (r[c] ?? "").toString().trim();
      if (!isGiroValue(val) && val === "") emptyIndexes.push(c);
    }
    const pinkSet = new Set(emptyIndexes.slice(0, pending));

    const giroTds = [];
    for (let c = gStart; c <= gEnd; c++){
      const raw = (r[c] ?? "").toString().trim();

      if (isGiroValue(raw)) {
        giroTds.push(`<td class="cell--blue" style="text-align:center">${toInt(raw)}</td>`);
      } else if (pinkSet.has(c)) {
        giroTds.push(`<td class="cell--pink" style="text-align:center"></td>`);
      } else {
        giroTds.push(`<td style="text-align:center"></td>`);
      }
    }

    const totalPts = toInt(r[TOTAL_INDEX]);

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
   Events
========================= */
if (btnGiroPrev){
  btnGiroPrev.addEventListener("click", () => {
    giroOffset = Math.max(0, giroOffset - GIRO_WINDOW);
    renderSheet();
  });
}

if (btnGiroNext){
  btnGiroNext.addEventListener("click", () => {
    const total = girosTotalCols();
    giroOffset = Math.min(Math.max(0, total - GIRO_WINDOW), giroOffset + GIRO_WINDOW);
    renderSheet();
  });
}

// Teclas (TV)
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft"){
    giroOffset = Math.max(0, giroOffset - GIRO_WINDOW);
    renderSheet();
  }
  if (e.key === "ArrowRight"){
    const total = girosTotalCols();
    giroOffset = Math.min(Math.max(0, total - GIRO_WINDOW), giroOffset + GIRO_WINDOW);
    renderSheet();
  }
});

/* =========================
   Init
========================= */
(async function init(){
  startPrizeTicker();

  try{
    await loadCSV();
    renderSheet();
  }catch(err){
    elStatusLastUpdate.textContent = `Erro: ${err.message}`;
    console.error(err);
  }
})();
