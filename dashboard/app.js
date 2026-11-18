// Token Radar dashboard: renders window.BOARD_DATA (written beside this page by main.ts) as a
// sortable, filterable board with a per-protocol detail view. Fully offline: no fetch, no imports.
(function () {
  'use strict';

  var DATA = window.BOARD_DATA;
  if (!DATA) return;
  var rows = DATA.rows;
  var live = DATA.live;
  var meta = DATA.meta;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var state = { tab: 'board', q: '', category: '', chain: '', watchlist: false, sort: 'rank', dir: 1, selected: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtUsdFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return '<span class="chains">unreported</span>';
    var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unrecorded';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs (' + days + 'd)';
    return days + ' days';
  }
  function fmtFactor(n) { return '×' + Number(n).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0'); }

  // ---- Masthead: the snapshot's own counts and the model, stated in the open. ----
  $('stats').innerHTML =
    '<div><dt>Protocols scanned</dt><dd>' + meta.protocols_scanned + '</dd></div>' +
    '<div><dt>On the board</dt><dd>' + meta.board_size + '</dd></div>' +
    '<div><dt>Watchlist</dt><dd>' + meta.watchlist_size + '</dd></div>' +
    '<div><dt>Already trading</dt><dd>' + meta.tokenized_count + '</dd></div>' +
    '<div><dt>Snapshot</dt><dd>' + esc(meta.as_of) + '</dd></div>';
  $('model-note').innerHTML =
    'The model: <code>implied = TVL × category ratio × momentum × maturity</code> — the category ratio is the ' +
    'median market-cap/TVL of the tokens that already trade in that category (realised ratios winsorised to ' +
    '[' + meta.model.winsor_lo + ', ' + meta.model.winsor_hi + '] first, so one outlier cannot drag a category), ' +
    'shrunk toward the overall median ' +
    '(' + meta.overall_ratio.toFixed(3) + ') by head count and clamped to [' + meta.model.ratio_floor + ', ' + meta.model.ratio_cap + ']; ' +
    'momentum reads the 7-day TVL change, maturity the days run with no token. No name is scored by hand. ' +
    'Model ' + esc(meta.model_version) + '.';
  $('foot').innerHTML =
    '<p>An implied value is this board\'s own claim: what a token would be worth if the protocol\'s record stayed ' +
    'as the snapshot has it. It is not a prediction that a token will be issued, or when. A protocol here records no ' +
    'token in the snapshot; that is not proof it has none.</p>' +
    '<p>Data: ' + esc(meta.source) + ' · Snapshot as of ' + esc(meta.as_of) + ' · Watchlist floor ' + fmtUsd(meta.floor_usd) + ' TVL.</p>';

  // ---- Filter options, from the board's own values. ----
  function fillSelect(id, values) {
    var sel = $(id);
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      sel.appendChild(opt);
    });
  }
  var categories = [];
  var chains = [];
  rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort(); chains.sort();
  fillSelect('category', categories);
  fillSelect('chain', chains);

  // ---- Filtering and sorting. ----
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.watchlist && !r.watchlist) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function visibleLive() {
    var q = state.q.trim().toLowerCase();
    return live.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  var BOARD_COLS = [
    { key: 'rank', label: 'Rank', num: true },
    { key: 'name', label: 'Protocol', num: false },
    { key: 'category', label: 'Category', num: false, nosort: true },
    { key: 'chains', label: 'Chains', num: false, nosort: true },
    { key: 'tvl_usd', label: 'TVL', num: true },
    { key: 'change_7d', label: '7d', num: true },
    { key: 'implied_value_usd', label: 'Implied value', num: true }
  ];
  var LIVE_COLS = [
    { key: 'name', label: 'Protocol', num: false },
    { key: 'category', label: 'Category', num: false, nosort: true },
    { key: 'tvl_usd', label: 'TVL', num: true },
    { key: 'mcap_usd', label: 'Market cap', num: true },
    { key: 'ratio', label: 'mcap / TVL', num: true },
    { key: 'change_7d', label: '7d', num: true }
  ];
  function sortRows(list, cols) {
    var key = state.sort;
    var dir = state.dir;
    var valid = cols.some(function (c) { return c.key === key && !c.nosort; });
    if (!valid) { key = cols[0].key; dir = 1; }
    return list.slice().sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }

  function renderHead(cols) {
    $('board-head').innerHTML = '<tr>' + cols.map(function (c) {
      var arrow = (!c.nosort && state.sort === c.key) ? '<span class="arrow">' + (state.dir === 1 ? '▲' : '▼') + '</span>' : '';
      return '<th class="' + (c.num ? 'num' : '') + (c.nosort ? '' : ' sortable') + '" data-key="' + c.key + '">' + c.label + arrow + '</th>';
    }).join('') + '</tr>';
    Array.prototype.forEach.call($('board-head').querySelectorAll('th.sortable'), function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-key');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' || key === 'rank' ? 1 : -1; }
        render();
      });
    });
  }

  function renderBoard() {
    renderHead(BOARD_COLS);
    var list = sortRows(visibleRows(), BOARD_COLS);
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols';
    $('empty').hidden = list.length > 0;
    $('board-body').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="star">watchlist</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num implied">' + fmtUsd(r.implied_value_usd) + '</td></tr>';
    }).join('');
    bindRowClicks();
  }

  function renderLive() {
    renderHead(LIVE_COLS);
    var list = sortRows(visibleLive(), LIVE_COLS);
    $('count').textContent = list.length + ' of ' + live.length + ' shown (top by market cap)';
    $('empty').hidden = list.length > 0;
    $('board-body').innerHTML = list.map(function (r) {
      return '<tr data-live="' + esc(r.slug) + '">' +
        '<td><span class="pname">' + esc(r.name) + '</span>' +
        '<span class="slug">' + esc(r.slug) + (r.symbol ? ' · ' + esc(r.symbol) : '') + '</span></td>' +
        '<td class="cat">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num implied">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num">' + r.ratio.toFixed(3) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td></tr>';
    }).join('');
  }

  function bindRowClicks() {
    Array.prototype.forEach.call($('board-body').querySelectorAll('tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }

  function render() {
    if (state.tab === 'board') renderBoard(); else renderLive();
  }

  // ---- Detail view: the model's inputs for one protocol, and its farm plan. ----
  function openDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    state.selected = slug;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var chips = r.chains.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
    $('drawer-body').innerHTML =
      '<div class="d-rank">Rank ' + r.rank + ' of ' + rows.length + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</div>' +
      '<h2 class="d-name">' + esc(r.name) + '</h2>' +
      '<div class="d-sub">' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + ' · records no token in the snapshot</div>' +
      '<div class="d-implied">' + fmtUsdFull(r.implied_value_usd) + '</div>' +
      '<div class="d-implied-label">Implied value, model ' + esc(meta.model_version) + '</div>' +
      '<dl class="d-grid">' +
      '<div><dt>TVL</dt><dd>' + fmtUsdFull(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day TVL change</dt><dd>' + (r.change_7d === null ? 'unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</dd></div>' +
      '<div><dt>Tracked since</dt><dd>' + esc(r.listed_at || 'unrecorded') + '</dd></div>' +
      '<div><dt>Age with no token</dt><dd>' + fmtAge(r.age_days) + '</dd></div>' +
      '<div><dt>Category ratio</dt><dd>' + r.category_ratio.toFixed(3) + ' <span class="chains">(' + (r.category_peers > 0 ? r.category_peers + ' trading peers' : 'overall median') + ')</span></dd></div>' +
      '<div><dt>Momentum · maturity</dt><dd>' + fmtFactor(r.momentum_factor) + ' · ' + fmtFactor(r.maturity_factor) + '</dd></div>' +
      '</dl>' +
      '<div class="d-formula">' + fmtUsdFull(r.tvl_usd) + ' × ' + r.category_ratio.toFixed(3) + ' × ' + r.momentum_factor.toFixed(3) + ' × ' + r.maturity_factor.toFixed(3) + ' ≈ ' + fmtUsdFull(r.implied_value_usd) + '</div>' +
      '<div class="d-chains">' + chips + '</div>' +
      '<h3 class="d-steps-title">How to farm it</h3>' +
      '<ol class="d-steps">' + steps + '</ol>';
    $('drawer').hidden = false;
    $('scrim').hidden = false;
    syncHash();
  }
  function closeDetail() {
    state.selected = null;
    $('drawer').hidden = true;
    $('scrim').hidden = true;
    syncHash();
  }
  $('drawer-close').addEventListener('click', closeDetail);
  $('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  // ---- Deep links: #p=<slug> opens a protocol, #f=<category> sets the filter. ----
  function syncHash() {
    var parts = [];
    if (state.category) parts.push('f=' + encodeURIComponent(state.category));
    if (state.selected) parts.push('p=' + encodeURIComponent(state.selected));
    var hash = parts.length ? '#' + parts.join('&') : '';
    if (window.location.hash !== hash) history.replaceState(null, '', hash || window.location.pathname + window.location.search);
  }
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    hash.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv.length !== 2) return;
      var key = kv[0];
      var value = decodeURIComponent(kv[1]);
      if (key === 'f' && categories.indexOf(value) >= 0) { state.category = value; $('category').value = value; }
      if (key === 'p' && bySlug[value]) state.selected = value;
    });
  }

  // ---- Controls. ----
  $('q').addEventListener('input', function () { state.q = this.value; render(); });
  $('category').addEventListener('change', function () { state.category = this.value; render(); syncHash(); });
  $('chain').addEventListener('change', function () { state.chain = this.value; render(); });
  $('watchlist-only').addEventListener('change', function () { state.watchlist = this.checked; render(); });
  $('tab-board').addEventListener('click', function () { setTab('board'); });
  $('tab-live').addEventListener('click', function () { setTab('live'); });
  function setTab(tab) {
    state.tab = tab;
    $('tab-board').classList.toggle('active', tab === 'board');
    $('tab-live').classList.toggle('active', tab === 'live');
    render();
  }

  readHash();
  render();
  if (state.selected) openDetail(state.selected);
})();
