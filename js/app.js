/*
 * app.js — state, rendering and interaction.
 * Every panel is redrawn from the key object; nothing is hand-maintained.
 */
(() => {
  const T = Theory;

  const state = {
    view: 'theory',
    tonic: 'C',
    mode: 'major',
    deg: 0,
    sevenths: false,
    /* Progression slots, not chords: {row, pos} resolved against the current
     * key, so changing key transposes what you have built. */
    prog: [],
    loop: false
  };

  let key = null;
  let singles = []; // registry of single-chord playbacks
  let seqs = [];    // registry of multi-chord playbacks

  // ------------------------------------------------------------ helpers ---

  const $ = (sel) => document.querySelector(sel);

  /* Register a chord for playback and hand back its index. */
  function single(chord) {
    singles.push(T.voice(chord));
    return singles.length - 1;
  }

  function seq(chords) {
    seqs.push(chords.map((c) => T.voice(c)));
    return seqs.length - 1;
  }

  /* Chords whose identity *is* the seventh (dominants, half-diminished) carry a
   * `display` hint from the theory layer and ignore the 7ths toggle. */
  const label = (chord) => chord.display || (state.sevenths && chord.symbol7 ? chord.symbol7 : chord.symbol);
  const roman = (chord) => (state.sevenths && chord.roman7 ? chord.roman7 : chord.roman);

  /* A clickable chord name. */
  function chip(chord, text, extraClass = '') {
    return `<button type="button" class="chip ${extraClass}" data-play="${single(chord)}">${text || label(chord)}</button>`;
  }

  /* A row of chord chips that can be played together as a progression. */
  function chain(chords, texts) {
    const id = seq(chords);
    const items = chords.map((c, i) =>
      `<span class="chain-chip" data-seq="${id}" data-pos="${i}">${(texts && texts[i]) || label(c)}</span>`
    ).join('<span class="arrow">→</span>');
    return `<div class="chain"><button type="button" class="play-seq" data-playseq="${id}" aria-label="Play progression">▶</button>
      <div class="chain-chips">${items}</div></div>`;
  }

  const notesOf = (chord) => chord.notes.map(T.noteName).join(' – ');

  // -------------------------------------------------------- key selector ---

  function keyList() {
    return state.mode === 'major' ? T.MAJOR_KEYS : T.MINOR_KEYS;
  }

  /* Keep the same pitch when switching major/minor, respelling if the list
   * uses a different name for it (A♭ major → G♯ minor). */
  function resolveTonic(tonicStr, mode) {
    const list = mode === 'major' ? T.MAJOR_KEYS : T.MINOR_KEYS;
    if (list.includes(tonicStr)) return tonicStr;
    const target = T.pc(T.parseNote(tonicStr));
    const match = list.find((k) => T.pc(T.parseNote(k)) === target);
    return match || (mode === 'major' ? 'C' : 'A');
  }

  function renderKeyChips() {
    const list = keyList();
    const alt = T.ENHARMONICS[state.mode];
    $('#keyChips').innerHTML = list.map((k) => {
      // If the user swapped to an alternative spelling, show it in that slot.
      const shown = k === state.tonic ? k : (alt[k] === state.tonic ? state.tonic : k);
      const on = shown === state.tonic ? ' on' : '';
      const suffix = state.mode === 'minor' ? 'm' : '';
      return `<button type="button" class="key-chip${on}" data-key="${shown}">${shown}${suffix}</button>`;
    }).join('');

    const swap = alt[state.tonic];
    const btn = $('#enharmSwap');
    if (swap) {
      btn.hidden = false;
      btn.textContent = 'Spell as ' + swap + (state.mode === 'minor' ? 'm' : '');
      btn.dataset.key = swap;
    } else {
      btn.hidden = true;
    }

    const sig = key.signature;
    const n = Math.abs(sig);
    $('#keySig').textContent = sig === 0
      ? 'no sharps or flats'
      : `${n} ${sig > 0 ? T.SHARP : T.FLAT}${n === 1 ? '' : 's'}`;

    document.querySelectorAll('#modeToggle button').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === state.mode);
    });
  }

  // ------------------------------------------------------------ diatonic ---

  function renderDiatonic() {
    $('#keyTitle').textContent = 'The chords in ' + key.name;
    $('#scaleLine').innerHTML = 'Scale: ' + key.scaleNotes.map((n) =>
      `<span class="sn">${T.noteName(n)}</span>`).join('') +
      `<span class="sig-inline">${key.relative.name} is its relative key</span>`;

    $('#chordRow').innerHTML = key.diatonic.map((c) => {
      const sel = c.degree === state.deg ? ' is-selected' : '';
      return `<div class="chord-card fn-${c.fn}${sel}" role="button" tabindex="0"
                   data-deg="${c.degree}" data-play="${single(c)}"
                   aria-label="${c.symbol}, ${c.roman}">
        <div class="card-top"><span class="num">${c.number}</span></div>
        <div class="roman">${roman(c)}</div>
        <div class="sym">${label(c)}</div>
        <div class="sym-alt">${state.sevenths ? c.symbol : c.symbol7}</div>
        <div class="deg-name">${c.degreeName}</div>
      </div>`;
    }).join('');
  }

  // -------------------------------------------------------------- detail ---

  function renderDetail() {
    const chord = key.diatonic[state.deg];
    const ctx = T.chordContext(key, chord);

    const item = (entry, chords) => `
      <li>
        <div class="rel-head">
          ${chip(entry.chord, label(entry.chord))}
          <span class="rn">${entry.label}</span>
          ${entry.title ? `<span class="tag">${entry.title}</span>` : ''}
        </div>
        <p>${entry.text}</p>
        ${chain(chords)}
      </li>`;

    const approaches = ctx.approaches.map((a) => item(a, [a.chord, chord])).join('');
    const departures = ctx.departures.map((d) => item(d, [chord, d.chord])).join('');

    const extras = [];
    if (ctx.interchange) {
      extras.push(`<div class="note-card">
        <h4>Modal interchange</h4>
        <p>${ctx.interchange.text}</p>
        ${chain([chord, ctx.interchange.chord, key.diatonic[0]])}
      </div>`);
    }
    if (ctx.asDominant) {
      extras.push(`<div class="note-card">
        <h4>Use it as a dominant</h4>
        <p>Make it ${ctx.asDominant.chord.symbol7} and it stops being ${chord.roman} — it becomes the
           dominant of ${ctx.asDominant.target.symbol} (${ctx.asDominant.target.roman}) and pulls there instead.</p>
        ${chain([chord, ctx.asDominant.chord, ctx.asDominant.target])}
      </div>`);
    }
    if (ctx.relative) {
      extras.push(`<div class="note-card">
        <h4>Its job in ${key.relative.name}</h4>
        <p>${ctx.relative.text}</p>
        <p class="mini-fact">${chord.symbol}: <b>${chord.roman}</b> (${chord.fnLabel}) in ${key.name} ·
           <b>${ctx.relative.roman}</b> (${ctx.relative.fn}) in ${key.relative.name}</p>
      </div>`);
    }

    $('#detailPanel').innerHTML = `
      <div class="panel-head">
        <h2>${chord.symbol} <span class="thin">— the ${chord.roman} chord</span></h2>
        <p class="sub">
          <span class="pill">${chord.number}</span>
          <span class="pill fn-pill fn-${chord.fn}">${chord.fnLabel}</span>
          ${chord.degreeName} · ${notesOf(chord)}
        </p>
      </div>
      <div class="detail-grid">
        <div class="detail-block">
          <h3>How to get <em>to</em> ${chord.symbol}</h3>
          <ul class="rel-list">${approaches}</ul>
        </div>
        <div class="detail-block">
          <h3>Where ${chord.symbol} wants to go</h3>
          <ul class="rel-list">${departures}</ul>
        </div>
      </div>
      <div class="note-cards">${extras.join('')}</div>`;
  }

  // ------------------------------------------------------------ relative ---

  function renderRelative() {
    const rel = key.relative;
    const pivots = T.relativePivots(key);
    const routes = T.relativeRoutes(key);

    const mini = rel.diatonic.map((c) =>
      `<div class="mini-chord">
        <span class="mini-roman">${c.roman}</span>
        ${chip(c, c.symbol, 'mini')}
      </div>`).join('');

    const rows = pivots.map((p) => `
      <tr>
        <td>${chip(p.chord, p.chord.symbol)}</td>
        <td><b>${p.homeRoman}</b><span class="muted"> ${p.homeFn}</span></td>
        <td><b>${p.relativeRoman}</b><span class="muted"> ${p.relativeFn}</span></td>
      </tr>`).join('');

    const routeList = (list) => list.map((r) => `
      <li>
        <div class="route-label">${r.label}</div>
        ${chain(r.chords)}
        <p>${r.text}</p>
      </li>`).join('');

    $('#relativePanel').innerHTML = `
      <div class="panel-head">
        <h2>Relative key <span class="thin">— ${rel.name}</span></h2>
        <p class="sub">Same seven notes as ${key.name}, different centre of gravity.
           ${key.shortName} is <b>${key.diatonic[0].roman}</b> here and
           <b>${pivots[0].relativeRoman}</b> there.</p>
      </div>
      <div class="mini-row">${mini}</div>

      <h3>Every chord is a pivot</h3>
      <div class="table-wrap">
        <table class="grid-table">
          <thead><tr><th>Chord</th><th>in ${key.name}</th><th>in ${rel.name}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <h3>Getting <em>to</em> ${rel.shortName}</h3>
      <ul class="route-list">${routeList(routes.into)}</ul>

      <h3>Getting <em>back</em> to ${key.shortName}</h3>
      <ul class="route-list">${routeList(routes.out)}</ul>`;
  }

  // ------------------------------------------------- secondary dominants ---

  function renderSecondary() {
    const rows = T.secondaryDominants(key).map((s) => {
      const r = s.resolution;
      return `<tr>
        <td class="target-cell">
          ${chip(s.target, s.target.symbol)}
          <span class="rn">${s.target.roman}</span>
        </td>
        <td>${chip(s.two, s.two.symbol7)}<span class="rn">${s.two.roman}</span></td>
        <td>${chip(s.dominant, s.dominant.symbol7)}<span class="rn">${s.dominant.roman}</span></td>
        <td>${chip(s.sub, s.sub.symbol7)}<span class="rn">tritone sub</span></td>
        <td>${chip(s.leadingTone, s.leadingTone.symbol7)}<span class="rn">${s.leadingTone.roman}</span></td>
        <td class="vl">
          <span class="vl-move">${T.noteName(r.third.from)} <i>→</i> ${T.noteName(r.third.to)}</span>
          <span class="vl-move">${T.noteName(r.seventh.from)} <i>→</i> ${T.noteName(r.seventh.to)}</span>
        </td>
        <td class="play-cell">${chain([s.two, s.dominant, s.target])}</td>
      </tr>`;
    }).join('');

    $('#secondaryPanel').innerHTML = `
      <div class="panel-head">
        <h2>Secondary dominants</h2>
        <p class="sub">Every chord can be treated as a temporary tonic. Borrow its dominant, and the ear
           follows you there — then you are still in ${key.name} when you land.</p>
      </div>
      <div class="table-wrap">
        <table class="grid-table wide">
          <thead>
            <tr>
              <th>To reach</th><th>Its ii</th><th>Its V7</th><th>Tritone sub</th>
              <th>Leading-tone °7</th><th>What resolves</th><th>Hear it</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="footnote">The V7 column is the workhorse: its 3rd rises a semitone into the target root and
         its 7th falls a semitone onto the target third. That squeeze is the whole trick.</p>`;
  }

  // -------------------------------------------------- modal interchange ---

  function renderBorrowed() {
    const cards = T.borrowedChords(key).map((c) => {
      const chords = c.replaces
        ? [key.diatonic[0], c.replaces, c, key.diatonic[0]]
        : [key.diatonic[0], c, key.diatonic[4], key.diatonic[0]];
      return `<div class="borrow-card">
        <div class="borrow-head">
          <span class="borrow-roman">${c.roman}</span>
          ${chip(c, c.symbol, 'big')}
        </div>
        <p class="borrow-note">${c.note}</p>
        <p class="borrow-meta">${notesOf(c)}${c.replaces ? ` · in place of ${c.replaces.symbol} (${c.replaces.roman})` : ''}</p>
        ${chain(chords)}
      </div>`;
    }).join('');

    $('#borrowedPanel').innerHTML = `
      <div class="panel-head">
        <h2>Modal interchange</h2>
        <p class="sub">Chords lifted from ${T.noteName(key.tonic)} ${key.parallel.mode} — same tonic, other
           mode. They keep the key but change its colour.</p>
      </div>
      <div class="borrow-grid">${cards}</div>`;
  }

  // -------------------------------------------------------- progressions ---

  function renderProgressions() {
    const cards = T.progressions(key).map((p) => `
      <div class="prog-card">
        <div class="prog-head">
          <h4>${p.name}</h4>
          <span class="prog-romans">${p.chords.map((c) => c.roman).join(' – ')}</span>
        </div>
        ${chain(p.chords)}
        <p class="prog-note">${p.note}</p>
      </div>`).join('');

    $('#progressionPanel').innerHTML = `
      <div class="panel-head">
        <h2>Progressions in ${key.name}</h2>
        <p class="sub">The same shapes every songwriter reaches for, already transposed for you.</p>
      </div>
      <div class="prog-grid">${cards}</div>`;
  }

  // ------------------------------------------------------------ song mode ---

  const ROW_LABELS = {
    secondary: 'Secondary dominants',
    main: 'Main chords',
    interchange: 'Modal interchange'
  };

  /* Drawn rather than typed, so they render the same everywhere. */
  const LOOP_ICON =
    '<svg class="hint-ico" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>' +
    '<path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
  const NO_LOOP_ICON = LOOP_ICON.replace('</svg>', '<path class="slash" d="M2 2l20 20"/></svg>');

  function renderSong() {
    $('#songTitle').textContent = 'Build a progression in ' + key.name;
    const grid = T.songLayout(key);

    /* Each button carries all three notations, as in theory mode: the numeral,
     * the chord itself, and the number. */
    const cell = (col, row) => {
      const chord = col[row];
      if (!chord) return `<div class="song-cell empty" aria-hidden="true"></div>`;
      const name = label(chord);
      return `<div class="song-cell">
        <button type="button" class="song-chord ${row}" data-add-row="${row}" data-add-pos="${col.pos}"
                title="Add ${name} to the progression">
          <span class="song-roman">${chord.roman}</span>
          <span class="song-sym">${name}</span>
          <span class="song-num">${chord.number}</span>
        </button>
      </div>`;
    };

    /* Every band shares the same gutters — the lead column and the hint column —
     * so the three rows stay in vertical register and a dominant always sits
     * directly above the chord it resolves to. */
    const band = (row, opts = {}) => `
      <div class="song-band">
        <div class="song-lead">${opts.lead || ''}</div>
        <div class="song-col">
          <div class="song-row-label">${ROW_LABELS[row]}</div>
          <div class="song-box box-${row}">
            ${opts.legend || ''}
            <div class="song-box-inner">
              <div class="song-hint">${opts.hint || ''}</div>
              <div class="song-row song-row-${row}">${grid.map((col) => cell(col, row)).join('')}</div>
            </div>
          </div>
        </div>
      </div>`;

    /* The arrows live between the boxes, in a band built like the others so
     * they line up with the columns they join. */
    const arrowBand = (has, glyph, cls) => `
      <div class="song-band">
        <div class="song-lead"></div>
        <div class="song-col">
          <div class="song-box ghost">
            <div class="song-box-inner">
              <div class="song-hint"></div>
              <div class="song-row">${grid.map((col) =>
                `<div class="song-cell">${has(col)
                  ? `<span class="song-arrow ${cls}" aria-hidden="true">${glyph}</span>` : ''}</div>`
              ).join('')}</div>
            </div>
          </div>
        </div>
      </div>`;

    const mixHint = `<span class="hint-label do-mix">${LOOP_ICON}<span>Mix chords</span></span>`;

    $('#songGrid').innerHTML =
      band('secondary', {
        hint: `<span class="hint-label no-mix">${NO_LOOP_ICON}<span>Don’t mix</span></span>`
      }) +
      arrowBand((col) => col.secondary, '↓', 'down') +
      band('main', {
        lead: '<span class="lead-note">Start here<span class="lead-arrow" aria-hidden="true">→</span></span>',
        legend: '<span class="box-legend"><span aria-hidden="true">↑</span> Up to any chord</span>',
        hint: mixHint
      }) +
      arrowBand((col) => col.interchange, '<span>↑</span><span>↓</span>', 'both') +
      band('interchange', {
        legend: '<span class="box-legend on-interchange">' +
          '<span aria-hidden="true">↓</span> down: to any chord ' +
          '<span class="legend-sep">·</span> ' +
          '<span aria-hidden="true">↑</span> up: follow the arrows</span>',
        hint: mixHint
      });
  }

  function renderProgression() {
    const strip = $('#progStrip');
    if (!state.prog.length) {
      strip.innerHTML = `<p class="prog-empty">No chords yet — click any chord above to start building.</p>`;
    } else {
      strip.innerHTML = state.prog.map((slot, i) => {
        const chord = T.songChordAt(key, slot);
        if (!chord) return '';
        return `<div class="prog-slot" data-slot="${i}">
          <span class="prog-index">${i + 1}</span>
          <span class="prog-name">${label(chord)}</span>
          <span class="prog-roman">${chord.roman}</span>
          <button type="button" class="prog-remove" data-remove="${i}" aria-label="Remove ${chord.symbol}">×</button>
        </div>`;
      }).join('');
    }

    const empty = state.prog.length === 0;
    $('#progPlay').disabled = empty;
    $('#progClear').disabled = empty;
    $('#progStop').disabled = !player.playing;
    $('#progLoop').classList.toggle('on', state.loop);
    $('#progLoop').setAttribute('aria-pressed', String(state.loop));
    $('#progPlay').classList.toggle('on', player.playing);
    $('#progPlay').textContent = player.playing ? '▶ Playing' : '▶ Play';
  }

  // ------------------------------------------------------------ sequencer ---

  /* Timing comes from the audio clock: a short interval looks ahead and
   * schedules whatever falls inside the next fraction of a second. */
  const STEP = 1.35;      // seconds per chord
  const LOOKAHEAD = 0.25; // how far ahead to schedule
  const player = { timer: null, step: 0, nextTime: 0, playing: false, marks: [] };

  function clearMarks() {
    player.marks.forEach(clearTimeout);
    player.marks = [];
    document.querySelectorAll('.prog-slot.playing').forEach((e) => e.classList.remove('playing'));
  }

  function markAt(index, when) {
    const delay = Math.max(0, (when - Sound.now()) * 1000);
    player.marks.push(setTimeout(() => {
      document.querySelectorAll('.prog-slot.playing').forEach((e) => e.classList.remove('playing'));
      const el = document.querySelector(`.prog-slot[data-slot="${index}"]`);
      if (el) el.classList.add('playing');
    }, delay));
  }

  function tick() {
    while (player.playing && player.nextTime < Sound.now() + LOOKAHEAD) {
      if (player.step >= state.prog.length) {
        if (!state.loop) {
          // Let the last chord ring, then stop.
          const end = player.nextTime;
          player.playing = false;
          clearInterval(player.timer);
          player.timer = null;
          player.marks.push(setTimeout(() => { stopPlayback(); }, Math.max(0, (end - Sound.now()) * 1000)));
          renderProgression();
          return;
        }
        player.step = 0;
      }
      const chord = T.songChordAt(key, state.prog[player.step]);
      if (chord) {
        Sound.chordAt(T.voice(chord), player.nextTime, STEP * 0.92);
        markAt(player.step, player.nextTime);
      }
      player.nextTime += STEP;
      player.step += 1;
    }
  }

  function startPlayback() {
    if (!state.prog.length) return;
    Sound.unlock();
    stopPlayback();
    player.playing = true;
    player.step = 0;
    player.nextTime = Sound.now() + 0.12;
    player.timer = setInterval(tick, 25);
    tick();
    renderProgression();
  }

  function stopPlayback() {
    if (player.timer) clearInterval(player.timer);
    player.timer = null;
    player.playing = false;
    clearMarks();
    Sound.silence();
    renderProgression();
  }

  // ------------------------------------------------------------- playback ---

  let seqTimers = [];

  function clearHighlights() {
    seqTimers.forEach(clearTimeout);
    seqTimers = [];
    document.querySelectorAll('.chain-chip.playing').forEach((e) => e.classList.remove('playing'));
  }

  function playSequence(id) {
    clearHighlights();
    const chords = seqs[id];
    if (!chords) return;
    const { delays, gap } = Sound.sequence(chords);
    const chips = document.querySelectorAll(`.chain-chip[data-seq="${id}"]`);
    delays.forEach((d, i) => {
      seqTimers.push(setTimeout(() => {
        chips.forEach((c) => c.classList.remove('playing'));
        if (chips[i]) chips[i].classList.add('playing');
      }, d * 1000));
    });
    seqTimers.push(setTimeout(clearHighlights, (delays[delays.length - 1] + gap) * 1000));
  }

  // --------------------------------------------------------------- render ---

  function render() {
    singles = [];
    seqs = [];
    clearHighlights();

    /* Song mode is major-only for now, so a minor key entering it is moved to
     * its parallel major — same tonic, and the key picker stays truthful about
     * what is on screen. */
    if (state.view === 'song' && state.mode === 'minor') {
      state.mode = 'major';
      state.tonic = resolveTonic(state.tonic, 'major');
    }

    key = T.buildKey(T.parseNote(state.tonic), state.mode);
    if (state.deg > 6 || state.deg < 0) state.deg = 0;

    renderKeyChips();

    const song = state.view === 'song';
    $('#songView').hidden = !song;
    $('#theoryView').hidden = song;
    $('#modeToggle').hidden = song;
    document.querySelectorAll('#viewToggle button').forEach((b) => {
      b.classList.toggle('on', b.dataset.view === state.view);
    });

    if (song) {
      renderSong();
      renderProgression();
    } else {
      renderDiatonic();
      renderDetail();
      renderRelative();
      renderSecondary();
      renderBorrowed();
      renderProgressions();
    }
    writeHash();
  }

  // ----------------------------------------------------------------- hash ---

  /* Progressions travel in the URL too, so a worked-out sequence is a link. */
  const ROW_CODE = { main: 'm', secondary: 's', interchange: 'i' };
  const CODE_ROW = { m: 'main', s: 'secondary', i: 'interchange' };

  const encodeProg = () => state.prog.map((s) => ROW_CODE[s.row] + s.pos).join('-');

  function decodeProg(str) {
    if (!str) return [];
    return str.split('-').map((tok) => ({
      row: CODE_ROW[tok[0]],
      pos: parseInt(tok.slice(1), 10)
    })).filter((s) => s.row && s.pos >= 0 && s.pos <= 6);
  }

  function writeHash() {
    let h = `key=${encodeURIComponent(state.tonic)}&mode=${state.mode}&deg=${state.deg}${state.sevenths ? '&7=1' : ''}`;
    if (state.view === 'song') h += '&view=song';
    if (state.prog.length) h += '&p=' + encodeProg();
    if (state.loop) h += '&loop=1';
    if (location.hash.slice(1) === h) return;
    // Sandboxed iframes forbid history writes; the app works fine without them.
    try { history.replaceState(null, '', '#' + h); } catch (e) { /* no shareable URL here */ }
  }

  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const mode = h.get('mode');
    if (mode === 'major' || mode === 'minor') state.mode = mode;
    const k = h.get('key');
    if (k && T.parseNote(k)) state.tonic = resolveTonic(k, state.mode);
    const d = parseInt(h.get('deg'), 10);
    if (!isNaN(d) && d >= 0 && d <= 6) state.deg = d;
    state.sevenths = h.get('7') === '1';
    state.view = h.get('view') === 'song' ? 'song' : 'theory';
    state.prog = decodeProg(h.get('p'));
    state.loop = h.get('loop') === '1';
  }

  // ------------------------------------------------------------- events ---

  function onActivate(target) {
    const card = target.closest('[data-deg]');
    const playBtn = target.closest('[data-play]');
    const seqBtn = target.closest('[data-playseq]');
    const keyBtn = target.closest('[data-key]');

    if (seqBtn) {
      Sound.unlock();
      playSequence(parseInt(seqBtn.dataset.playseq, 10));
      return true;
    }
    if (keyBtn) {
      state.tonic = keyBtn.dataset.key;
      render();
      return true;
    }
    if (playBtn) {
      Sound.unlock();
      clearHighlights();
      Sound.chord(singles[parseInt(playBtn.dataset.play, 10)]);
      playBtn.classList.add('flash');
      setTimeout(() => playBtn.classList.remove('flash'), 260);
    }
    if (card) {
      const deg = parseInt(card.dataset.deg, 10);
      if (deg !== state.deg) {
        state.deg = deg;
        render();
        // Re-render wipes the flash class; keep the selection visible instead.
      }
      return true;
    }
    return !!playBtn;
  }

  document.addEventListener('click', (e) => {
    if (onActivate(e.target)) return;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.matches('[data-deg]')) {
      e.preventDefault();
      onActivate(e.target);
    }
  });

  $('#viewToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn || btn.dataset.view === state.view) return;
    stopPlayback();
    state.view = btn.dataset.view;
    render();
  });

  /* Adding and removing chords, and the transport. */
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-row]');
    if (add) {
      const slot = { row: add.dataset.addRow, pos: parseInt(add.dataset.addPos, 10) };
      state.prog.push(slot);
      const chord = T.songChordAt(key, slot);
      if (chord) {
        Sound.unlock();
        Sound.chord(T.voice(chord));
      }
      add.classList.add('added');
      setTimeout(() => add.classList.remove('added'), 240);
      renderProgression();
      writeHash();
      return;
    }

    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const wasPlaying = player.playing;
      state.prog.splice(parseInt(remove.dataset.remove, 10), 1);
      if (wasPlaying) stopPlayback();
      renderProgression();
      writeHash();
    }
  });

  $('#progPlay').addEventListener('click', startPlayback);
  $('#progStop').addEventListener('click', stopPlayback);

  $('#progClear').addEventListener('click', () => {
    stopPlayback();
    state.prog = [];
    renderProgression();
    writeHash();
  });

  $('#progLoop').addEventListener('click', () => {
    state.loop = !state.loop;
    renderProgression();
    writeHash();
  });

  $('#modeToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    state.mode = btn.dataset.mode;
    state.tonic = resolveTonic(state.tonic, state.mode);
    render();
  });

  $('#seventhToggle').addEventListener('click', (e) => {
    state.sevenths = !state.sevenths;
    e.currentTarget.setAttribute('aria-pressed', String(state.sevenths));
    e.currentTarget.classList.toggle('on', state.sevenths);
    render();
  });

  /* The label names the action, not the state: a silent page should never
   * tempt anyone into clicking the control that silences it. */
  $('#muteToggle').addEventListener('click', (e) => {
    const muted = !Sound.isMuted();
    Sound.setMuted(muted);
    e.currentTarget.setAttribute('aria-pressed', String(muted));
    e.currentTarget.classList.toggle('on', muted);
    e.currentTarget.textContent = muted ? 'Unmute' : 'Mute';
    e.currentTarget.title = muted ? 'Turn chord playback back on' : 'Silence chord playback';
  });

  function notify(el, kind, html) {
    el.className = 'audio-notice ' + kind;
    el.innerHTML = html;
    el.hidden = false;
  }

  /* If the browser refuses to start audio at all, say so where everyone can see
   * it — the usual cause is the page being embedded in a frame that is not
   * allowed to play sound. */
  Sound.onBlocked(() => {
    notify($('#audioNotice'), 'bad',
      'This browser will not start audio on this page. If you are viewing it embedded in ' +
      'another page, open it in its own tab and the chords will play. ' +
      'There is a <b>Diagnostics</b> panel at the foot of the page.');
  });

  // ---------------------------------------------------------- diagnostics ---

  function renderDebugFacts() {
    const facts = [
      ['Audio context', Sound.state()],
      ['Sample rate', Sound.sampleRate() ? Sound.sampleRate() + ' Hz' : '—'],
      ['Output route', Sound.route() === 'media-element'
        ? 'media element — ignores the iOS silent switch'
        : Sound.route()],
      ['Playback', Sound.isMuted() ? 'muted' : 'on'],
      ['Embedded in a frame', window.self !== window.top ? 'yes — audio may be blocked here' : 'no'],
      ['Key', key.name + ' · ' + key.diatonic[state.deg].symbol + ' selected'],
      ['Browser', navigator.userAgent]
    ];
    $('#debugFacts').innerHTML = facts.map(([k, v]) =>
      `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  }

  $('#debugToggle').addEventListener('click', (e) => {
    const panel = $('#debugPanel');
    const open = panel.hidden;
    panel.hidden = !open;
    e.currentTarget.setAttribute('aria-expanded', String(open));
    if (open) {
      renderDebugFacts();
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  $('#debugRefresh').addEventListener('click', renderDebugFacts);

  /* Plays a test chord and measures the output, which separates "the page made
   * no sound" from "the page made sound you cannot hear". */
  $('#soundTest').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const out = $('#debugResult');
    if (Sound.isMuted()) {
      notify(out, 'warn', 'Playback is muted. Click <b>Unmute</b> in the top bar and test again.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Listening…';
    const r = await Sound.test();
    btn.disabled = false;
    btn.textContent = 'Test sound';

    if (r.producing) {
      notify(out, 'ok', `Audio is working — the page produced sound at ${Math.round(r.peak * 100)}% of full scale ` +
        `(audio context: ${r.state}). If you still hear nothing, the sound is being lost after this page: ` +
        `check your system volume, the tab's mute state, and whether this page is embedded in another one — ` +
        `an embedded frame is often not allowed to play audio, and opening it in its own tab fixes that.`);
    } else {
      notify(out, 'bad', `No audio came out of the page (audio context: ${r.state}). ` +
        (r.state === 'suspended'
          ? 'The browser is refusing to start audio here, which usually means this page is embedded in a frame that is not permitted to play sound. Open it in its own tab.'
          : r.state === 'unsupported'
            ? 'This browser does not support the Web Audio API.'
            : 'Try reloading the page, then click a chord before testing again.'));
    }
    renderDebugFacts();
  });

  /* Arrow keys walk the diatonic row. */
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (state.view !== 'theory') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      state.deg = (state.deg + delta + 7) % 7;
      render();
      const el = document.querySelector('.chord-card.is-selected');
      if (el) {
        el.focus();
        Sound.unlock();
        Sound.chord(singles[parseInt(el.dataset.play, 10)]);
      }
    }
  });

  window.addEventListener('hashchange', () => { readHash(); render(); });

  readHash();
  render();
})();
