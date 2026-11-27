// The finder: renders the audit board, the flagged section and the
// cross-store comparison, and wires search, filters and sorting.
// Nothing here fetches anything — the deals are in deals.js, checked
// by hand before they were written in.

import { DEALS, COMPARES } from './deals.js';

const RANK = { low: 0, strong: 1, routine: 2, flag: 3 };
const LABEL = {
  low: 'All-time low',
  strong: 'Strong deal',
  routine: 'Routine sale',
  flag: 'Not a deal',
};

const board = document.getElementById('deal-cards');
const flagged = document.getElementById('flagged-cards');
const countLine = document.getElementById('count');
const emptyNote = document.getElementById('empty');
const qInput = document.getElementById('q');
const catSelect = document.getElementById('cat');
const storeSelect = document.getElementById('store');
const offSelect = document.getElementById('off');
const sortSelect = document.getElementById('sort');

function money(n) {
  const text = Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2);
  return '$' + text;
}

function pct(deal) {
  return Math.round((1 - deal.sale / deal.was) * 100);
}

function save(deal) {
  return deal.was - deal.sale;
}

function card(deal) {
  const el = document.createElement('article');
  el.className = 'card' + (deal.verdict === 'flag' ? ' flagged' : '');
  const off = pct(deal);
  el.innerHTML =
    '<span class="badge ' + deal.verdict + '">' + LABEL[deal.verdict] + '</span>' +
    '<h3></h3>' +
    '<p class="meta"></p>' +
    '<p class="prices"><span class="sale"></span><span class="was"></span><span class="off"></span></p>' +
    '<p class="why"></p>' +
    '<p class="proof"></p>' +
    '<a class="store-link" target="_blank" rel="noopener"></a>';
  el.querySelector('h3').textContent = deal.product;
  el.querySelector('.meta').textContent = deal.store + ' · ' + deal.category;
  el.querySelector('.sale').textContent = money(deal.sale);
  el.querySelector('.was').textContent = money(deal.was);
  const offEl = el.querySelector('.off');
  if (deal.verdict === 'flag') {
    // A flagged deal's discount is the claim being audited, not a saving
    // to celebrate: show it in red, with no "save" figure.
    offEl.classList.add('flag');
    offEl.textContent = off + '% off';
  } else {
    offEl.textContent = off + '% off · save ' + money(save(deal));
  }
  el.querySelector('.why').innerHTML = '<strong>Why:</strong> ';
  el.querySelector('.why').append(document.createTextNode(deal.why));
  el.querySelector('.proof').textContent =
    'Checked ' + deal.checked + ' · ' + deal.source;
  const link = el.querySelector('.store-link');
  link.href = deal.url;
  link.textContent = 'View at ' + deal.store + ' →';
  return el;
}

function compareRow(row) {
  const el = document.createElement('div');
  el.className = 'compare-row';
  const byId = new Map(DEALS.map((d) => [d.id, d]));
  const a = byId.get(row.a);
  const b = byId.get(row.b);
  if (!a || !b) return el;
  const winner = a.sale <= b.sale ? a : b;
  const gap = Math.abs(a.sale - b.sale);
  el.innerHTML =
    '<h3></h3>' +
    '<div class="compare-cell"><div class="store"></div><div class="price"></div><span class="was"></span><br><a target="_blank" rel="noopener"></a></div>' +
    '<div class="vs">vs</div>' +
    '<div class="compare-cell"><div class="store"></div><div class="price"></div><span class="was"></span><br><a target="_blank" rel="noopener"></a></div>' +
    '<div class="winner"></div>';
  el.querySelector('h3').textContent = row.product;
  const cells = el.querySelectorAll('.compare-cell');
  [a, b].forEach((deal, i) => {
    cells[i].querySelector('.store').textContent = deal.store;
    cells[i].querySelector('.price').textContent = money(deal.sale);
    cells[i].querySelector('.was').textContent = 'was ' + money(deal.was);
    const link = cells[i].querySelector('a');
    link.href = deal.url;
    link.textContent = 'View at ' + deal.store;
  });
  el.querySelector('.winner').textContent =
    winner.store + ' wins by ' + money(gap);
  return el;
}

function fillOptions(select, values) {
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
}

function currentFilters() {
  return {
    q: qInput.value.trim().toLowerCase(),
    cat: catSelect.value,
    store: storeSelect.value,
    off: offSelect.value === '' ? 0 : Number(offSelect.value),
    sort: sortSelect.value,
  };
}

function applyFilters(list, f) {
  let out = list.filter((deal) => {
    if (deal.verdict === 'flag') return false;
    if (f.q && !(deal.product + ' ' + deal.store + ' ' + deal.category).toLowerCase().includes(f.q)) return false;
    if (f.cat && deal.category !== f.cat) return false;
    if (f.store && deal.store !== f.store) return false;
    if (f.off && pct(deal) < f.off) return false;
    return true;
  });
  const by = {
    verdict: (x, y) => RANK[x.verdict] - RANK[y.verdict] || pct(y) - pct(x),
    off: (x, y) => pct(y) - pct(x),
    save: (x, y) => save(y) - save(x),
    price: (x, y) => x.sale - y.sale,
  };
  return out.sort(by[f.sort] || by.verdict);
}

function render() {
  const f = currentFilters();
  const shown = applyFilters(DEALS, f);
  board.replaceChildren(...shown.map(card));
  const total = DEALS.filter((d) => d.verdict !== 'flag').length;
  countLine.textContent =
    shown.length + ' of ' + total + ' verified deals shown' +
    (f.q || f.cat || f.store || f.off ? ' — filtered' : '');
  emptyNote.hidden = shown.length > 0;
}

function readParams() {
  const params = new URLSearchParams(location.search);
  if (params.get('q')) qInput.value = params.get('q');
  if (params.get('cat')) catSelect.value = params.get('cat');
  if (params.get('store')) storeSelect.value = params.get('store');
  if (params.get('off')) offSelect.value = params.get('off');
  if (params.get('sort')) sortSelect.value = params.get('sort');
}

export function boot() {
  const cats = [...new Set(DEALS.map((d) => d.category))].sort();
  const stores = [...new Set(DEALS.map((d) => d.store))].sort();
  fillOptions(catSelect, cats);
  fillOptions(storeSelect, stores);

  flagged.replaceChildren(...DEALS.filter((d) => d.verdict === 'flag').map(card));
  document.getElementById('compare-rows')
    .replaceChildren(...COMPARES.map(compareRow));

  const lows = DEALS.filter((d) => d.verdict === 'low').length;
  const flags = DEALS.filter((d) => d.verdict === 'flag').length;
  document.getElementById('stats').textContent =
    DEALS.length + ' deals checked · ' + lows + ' all-time lows · ' +
    flags + ' flagged as not a deal · ' + stores.length + ' stores';

  readParams();
  for (const el of [qInput, catSelect, storeSelect, offSelect, sortSelect]) {
    el.addEventListener('input', render);
  }
  render();
  // A focused view (?view=board, ?view=compare) shows one section at
  // the top by hiding the sections above it, so a link to a section
  // below the fold actually arrives there — including in screenshot
  // tools, which render nothing when the page is scrolled by a fragment
  // or by script before first paint. A plain #board link still works
  // in a real browser through the native anchor scroll.
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'board' || view === 'compare') {
    document.body.classList.add('focus-' + view);
  }
}
