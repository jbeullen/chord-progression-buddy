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
    loop: false,
    bpm: 120,
    lang: 'en',
    instrument: 'synth'
  };

  const t = I18N.t;

  /* Key names are localised: "C major" in English, "C majeur" in Dutch. */
  const keyName = (k) => t('key.name', { tonic: k.tonicName, mode: t('mode.' + k.mode) });

  /* Prose from the theory layer arrives as a key plus values. The names of the
   * current key and its relative are added here, since only this layer knows
   * what language to say them in. */
  function say(entry) {
    return t(entry.key, Object.assign({
      key: keyName(key),
      relKey: keyName(key.relative),
      short: key.shortName,
      relShort: key.relative.shortName
    }, entry.params));
  }

  const BPM_MIN = 40;
  const BPM_MAX = 240;
  const BPM_DEFAULT = 120; // 2 seconds to the bar
  const clampBpm = (n) => Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(n)));

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

  /* Song mode names chords by what they are, so the 7ths toggle only offers the
   * seventh where it is genuinely optional colour — on major and minor chords.
   * A dominant is defined by its ♭7 and always shows it; a diminished chord is
   * defined by its ♭5, which the triad name already carries. */
  const ALWAYS_SEVENTH = { dom7: true, aug7: true };
  const ALWAYS_TRIAD = { halfDim7: true, dim7: true };

  function songLabel(chord) {
    if (chord.display) return chord.display;
    if (ALWAYS_SEVENTH[chord.seventhQuality]) return chord.symbol7;
    if (ALWAYS_TRIAD[chord.seventhQuality]) return chord.symbol;
    return state.sevenths && chord.symbol7 ? chord.symbol7 : chord.symbol;
  }

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
    return `<div class="chain"><button type="button" class="play-seq" data-playseq="${id}" aria-label="${t('prog.playAria')}">▶</button>
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

  /* Everything written directly in the markup, marked with data-i18n. */
  function renderStaticText() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.innerHTML = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    const other = state.lang === 'en' ? 'nl' : 'en';
    $('#langToggle').textContent = t('lang.switchTo');
    $('#langToggle').setAttribute('aria-label', t('lang.switchTo'));
    $('#langToggle').dataset.lang = other;
    $('#muteToggle').textContent = t(Sound.isMuted() ? 'toggle.unmute' : 'toggle.mute');
    $('#progPlay').textContent = t(player.playing ? 'prog.playing' : 'prog.play');
    $('#progStop').textContent = t('prog.stop');
    $('#progLoop').textContent = t('prog.loop');
    $('#progClear').textContent = t('prog.clear');
    $('#soundTest').textContent = t('diag.test');
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
      btn.textContent = t('keybar.spellAs', { name: swap + (state.mode === 'minor' ? 'm' : '') });
      btn.dataset.key = swap;
    } else {
      btn.hidden = true;
    }

    const sig = key.signature;
    const n = Math.abs(sig);
    $('#keySig').textContent = sig === 0
      ? t('keybar.noAccidentals')
      : t(n === 1 ? 'keybar.sharpsOne' : 'keybar.sharps', { n, sym: sig > 0 ? T.SHARP : T.FLAT });

    document.querySelectorAll('#modeToggle button').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === state.mode);
    });
  }

  // ------------------------------------------------------------ diatonic ---

  function renderDiatonic() {
    $('#keyTitle').textContent = t('theory.title', { key: keyName(key) });
    $('#scaleLine').innerHTML = t('theory.scale') + ' ' + key.scaleNotes.map((n) =>
      `<span class="sn">${T.noteName(n)}</span>`).join('') +
      `<span class="sig-inline">${t('theory.relativeIs', { key: keyName(key.relative) })}</span>`;

    $('#chordRow').innerHTML = key.diatonic.map((c) => {
      const sel = c.degree === state.deg ? ' is-selected' : '';
      return `<div class="chord-card fn-${c.fn}${sel}" role="button" tabindex="0"
                   data-deg="${c.degree}" data-play="${single(c)}"
                   aria-label="${c.symbol}, ${c.roman}">
        <div class="card-top"><span class="num">${c.number}</span></div>
        <div class="roman">${roman(c)}</div>
        <div class="sym">${label(c)}</div>
        <div class="sym-alt">${state.sevenths ? c.symbol : c.symbol7}</div>
        <div class="deg-name">${t('degree.' + c.degreeKey)}</div>
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
          ${I18N.t(entry.key + '.title') !== entry.key + '.title'
            ? `<span class="tag">${t(entry.key + '.title')}</span>` : ''}
        </div>
        <p>${say(entry)}</p>
        ${chain(chords)}
      </li>`;

    /* Most entries compare two chords, but where the sentence spells out a
     * longer route the theory layer hands over the whole thing to play. */
    const approaches = ctx.approaches.map((a) => item(a, a.chain || [a.chord, chord])).join('');
    const departures = ctx.departures.map((d) => item(d, d.chain || [chord, d.chord])).join('');

    const extras = [];
    if (ctx.interchange) {
      extras.push(`<div class="note-card">
        <h4>${t('detail.interchange')}</h4>
        <p>${say(ctx.interchange)}</p>
        ${chain([chord, ctx.interchange.chord, key.diatonic[0]])}
      </div>`);
    }
    if (ctx.asDominant) {
      extras.push(`<div class="note-card">
        <h4>${t('detail.asDominant')}</h4>
        <p>${t('detail.asDominant.text', {
          dom: ctx.asDominant.chord.symbol7,
          roman: chord.roman,
          target: ctx.asDominant.target.symbol,
          targetRoman: ctx.asDominant.target.roman
        })}</p>
        ${chain([chord, ctx.asDominant.chord, ctx.asDominant.target])}
      </div>`);
    }
    if (ctx.relative) {
      extras.push(`<div class="note-card">
        <h4>${t('detail.relative', { key: keyName(key.relative) })}</h4>
        <p>${say(ctx.relative)}</p>
        ${chain(ctx.relative.chain)}
        <p class="mini-fact">${t('detail.relative.fact', {
          chord: chord.symbol,
          homeRoman: chord.roman,
          homeFn: t('fn.' + chord.fn),
          key: keyName(key),
          relRoman: ctx.relative.roman,
          relFn: t('fn.' + ctx.relative.fn),
          relKey: keyName(key.relative)
        })}</p>
      </div>`);
    }

    $('#detailPanel').innerHTML = `
      <div class="panel-head">
        <h2>${chord.symbol} <span class="thin">${t('detail.thin', { roman: chord.roman })}</span></h2>
        <p class="sub">
          <span class="pill">${chord.number}</span>
          <span class="pill fn-pill fn-${chord.fn}">${t('fn.' + chord.fn)}</span>
          ${t('degree.' + chord.degreeKey)} · ${notesOf(chord)}
        </p>
      </div>
      <div class="detail-grid">
        <div class="detail-block">
          <h3>${t('detail.approaches', { chord: chord.symbol })}</h3>
          <ul class="rel-list">${approaches}</ul>
        </div>
        <div class="detail-block">
          <h3>${t('detail.departures', { chord: chord.symbol })}</h3>
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
        <td><b>${p.homeRoman}</b><span class="muted"> ${t('fn.' + p.homeFn)}</span></td>
        <td><b>${p.relativeRoman}</b><span class="muted"> ${p.relativeFn ? t('fn.' + p.relativeFn) : '—'}</span></td>
      </tr>`).join('');

    const routeList = (list) => list.map((r) => `
      <li>
        <div class="route-label">${t(r.key + '.label')}</div>
        ${chain(r.chords)}
        <p>${say(r)}</p>
      </li>`).join('');

    $('#relativePanel').innerHTML = `
      <div class="panel-head">
        <h2>${t('relative.heading')} <span class="thin">${t('relative.thin', { key: keyName(rel) })}</span></h2>
        <p class="sub">${t('relative.sub', {
          key: keyName(key),
          short: key.shortName,
          homeRoman: key.diatonic[0].roman,
          relRoman: pivots[0].relativeRoman
        })}</p>
      </div>
      <div class="mini-row">${mini}</div>

      <h3>${t('relative.pivots')}</h3>
      <div class="table-wrap">
        <table class="grid-table">
          <thead><tr><th>${t('relative.colChord')}</th><th>${t('relative.colIn', { key: keyName(key) })}</th><th>${t('relative.colIn', { key: keyName(rel) })}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <h3>${t('relative.into', { key: rel.shortName })}</h3>
      <ul class="route-list">${routeList(routes.into)}</ul>

      <h3>${t('relative.outOf', { key: key.shortName })}</h3>
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
        <td>${chip(s.sub, s.sub.symbol7)}<span class="rn">${t('secondary.tritoneSub')}</span></td>
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
        <h2>${t('secondary.heading')}</h2>
        <p class="sub">${t('secondary.sub', { key: keyName(key) })}</p>
      </div>
      <div class="table-wrap">
        <table class="grid-table wide">
          <thead>
            <tr>
              <th>${t('secondary.colTarget')}</th><th>${t('secondary.colTwo')}</th>
              <th>${t('secondary.colFive')}</th><th>${t('secondary.colTritone')}</th>
              <th>${t('secondary.colLeading')}</th><th>${t('secondary.colResolves')}</th>
              <th>${t('secondary.colHear')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="footnote">${t('secondary.footnote')}</p>`;
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
        <p class="borrow-note">${t(c.noteKey)}</p>
        <p class="borrow-meta">${notesOf(c)}${c.replaces
          ? t('borrowed.replaces', { chord: c.replaces.symbol, roman: c.replaces.roman }) : ''}</p>
        ${chain(chords)}
      </div>`;
    }).join('');

    $('#borrowedPanel').innerHTML = `
      <div class="panel-head">
        <h2>${t('borrowed.heading')}</h2>
        <p class="sub">${t('borrowed.sub', {
          tonic: T.noteName(key.tonic),
          parallelMode: t('mode.' + key.parallel.mode)
        })}</p>
      </div>
      <div class="borrow-grid">${cards}</div>`;
  }

  // -------------------------------------------------------- progressions ---

  function renderProgressions() {
    const cards = T.progressions(key).map((p) => `
      <div class="prog-card">
        <div class="prog-head">
          <h4>${t(p.nameKey)}</h4>
          <span class="prog-romans">${p.chords.map((c) => c.roman).join(' – ')}</span>
        </div>
        ${chain(p.chords)}
        <p class="prog-note">${t(p.noteKey)}</p>
      </div>`).join('');

    $('#progressionPanel').innerHTML = `
      <div class="panel-head">
        <h2>${t('progressions.heading', { key: keyName(key) })}</h2>
        <p class="sub">${t('progressions.sub')}</p>
      </div>
      <div class="prog-grid">${cards}</div>`;
  }

  // ------------------------------------------------------------ song mode ---

  const ROWS = ['secondary', 'main', 'interchange'];

  /* Drawn rather than typed, so they render the same everywhere. */
  const LOOP_ICON =
    '<svg class="hint-ico" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>' +
    '<path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
  const NO_LOOP_ICON = LOOP_ICON.replace('</svg>', '<path class="slash" d="M2 2l20 20"/></svg>');

  function renderSong() {
    $('#songTitle').textContent = t('song.title', { key: keyName(key) });
    const grid = T.songLayout(key);

    /* Each button carries all three notations, as in theory mode: the numeral,
     * the chord itself, and the number. */
    const cell = (col, row) => {
      const chord = col[row];
      if (!chord) return `<div class="song-cell empty" aria-hidden="true"></div>`;
      const name = songLabel(chord);
      return `<div class="song-cell">
        <button type="button" class="song-chord ${row}" data-add-row="${row}" data-add-pos="${col.pos}"
                title="${t('song.addTitle', { chord: name })}">
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
          <div class="song-row-label">${t('song.row.' + row)}</div>
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

    const mixHint = `<span class="hint-label do-mix">${LOOP_ICON}<span>${t('song.mix')}</span></span>`;

    $('#songGrid').innerHTML =
      band('secondary', {
        hint: `<span class="hint-label no-mix">${NO_LOOP_ICON}<span>${t('song.dontMix')}</span></span>`
      }) +
      arrowBand((col) => col.secondary, '↓', 'down') +
      band('main', {
        lead: `<span class="lead-note">${t('song.startHere')}<span class="lead-arrow" aria-hidden="true">→</span></span>`,
        legend: `<span class="box-legend"><span aria-hidden="true">↑</span> ${t('song.upToAny')}</span>`,
        hint: mixHint
      }) +
      arrowBand((col) => col.interchange, '<span>↑</span><span>↓</span>', 'both') +
      band('interchange', {
        legend: '<span class="box-legend on-interchange">' +
          '<span aria-hidden="true">↓</span> ' + t('song.downUp') +
          ' <span class="legend-sep">·</span> ' +
          '<span aria-hidden="true">↑</span> ' + t('song.followArrows') + '</span>',
        hint: mixHint
      });
  }

  function renderProgression() {
    const strip = $('#progStrip');
    if (!state.prog.length) {
      strip.innerHTML = `<p class="prog-empty">${t('prog.empty')}</p>`;
    } else {
      strip.innerHTML = state.prog.map((slot, i) => {
        const chord = T.songChordAt(key, slot);
        if (!chord) return '';
        /* Same three notations, in the same order, as the grid button this
         * chord came from. A running 1, 2, 3… count sat where the number
         * notation belongs and read as one. */
        return `<div class="prog-slot" data-slot="${i}">
          <span class="prog-roman">${chord.roman}</span>
          <span class="prog-name">${songLabel(chord)}</span>
          <span class="prog-num">${chord.number}</span>
          <button type="button" class="prog-remove" data-remove="${i}" aria-label="${t('prog.remove', { chord: chord.symbol })}">×</button>
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
    $('#progPlay').textContent = t(player.playing ? 'prog.playing' : 'prog.play');
  }

  // ------------------------------------------------------------ sequencer ---

  /* Timing comes from the audio clock: a short interval looks ahead and
   * schedules whatever falls inside the next fraction of a second. */
  const BEATS_PER_CHORD = 4; // a chord chart counts one chord to the bar
  const LOOKAHEAD = 0.25;    // how far ahead to schedule
  const player = { timer: null, step: 0, nextTime: 0, playing: false, marks: [] };

  /* Read fresh on every chord, so dragging the tempo takes effect from the
   * next chord rather than needing playback to be restarted. Both modes use
   * these: a chord clicked anywhere on the page rings for one bar, and the
   * worked examples in theory mode step at the same tempo. */
  const stepSeconds = () => (60 / state.bpm) * BEATS_PER_CHORD;
  const chordDuration = () => stepSeconds() * 0.92;

  /* A sequenced chord holds until just short of the next one. The gap keeps
   * consecutive chords from overlapping into mud, while being short enough
   * that the progression still reads as continuous. */
  const CHORD_GAP = 0.09;
  const sustainSeconds = () => Math.max(0.25, stepSeconds() - CHORD_GAP);

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
      const step = stepSeconds();
      if (chord) {
        Sound.chordAt(T.voice(chord), player.nextTime, Math.max(0.25, step - CHORD_GAP));
        markAt(player.step, player.nextTime);
      }
      player.nextTime += step;
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
    const { delays, gap } = Sound.sequence(chords, { gap: stepSeconds(), dur: sustainSeconds() });
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

    renderStaticText();
    renderKeyChips();
    setBpm(state.bpm);

    const song = state.view === 'song';
    $('#songView').hidden = !song;
    $('#theoryView').hidden = song;
    $('#modeToggle').hidden = song;
    document.querySelectorAll('#viewToggle button').forEach((b) => {
      b.classList.toggle('on', b.dataset.view === state.view);
    });
    renderInstrument();

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

  /* Typed chords ride along as their distance from the tonic, the same thing
   * the app stores in memory. The semitone distance is offset so it can never
   * be negative: a minus sign would be indistinguishable from a separator.
   *
   * That is also why the separator moved from "-" to "_". A hyphen is an
   * ordinary way to write a minor chord (C-7), and escaping it does not help —
   * browsers decode %2D back to a hyphen inside the fragment before we ever
   * read it. Links made before the move still say "-" and are still read. */
  const SEMI_OFFSET = 12;
  const SEP = '_';
  const LEGACY_SEP = /^[msi]\d(-[msi]\d)+$/;

  function encodeSlot(s) {
    if (s.row !== 'typed') return ROW_CODE[s.row] + s.pos;
    const parts = ['t' + s.deg, s.semis + SEMI_OFFSET, encodeURIComponent(s.body)];
    if (s.bassDeg !== undefined) parts.push(s.bassDeg, s.bassSemis + SEMI_OFFSET);
    return parts.join('.');
  }

  function decodeSlot(tok) {
    if (tok[0] !== 't') {
      const slot = { row: CODE_ROW[tok[0]], pos: parseInt(tok.slice(1), 10) };
      return slot.row && slot.pos >= 0 && slot.pos <= 6 ? slot : null;
    }
    const p = tok.split('.');
    const deg = parseInt(p[0].slice(1), 10);
    const semis = parseInt(p[1], 10) - SEMI_OFFSET;
    if (isNaN(deg) || isNaN(semis) || deg < 0 || deg > 6) return null;
    let body;
    try { body = decodeURIComponent(p[2] || ''); } catch (e) { return null; }
    const slot = { row: 'typed', deg, semis, body };
    if (p.length >= 5) {
      const bd = parseInt(p[3], 10);
      const bs = parseInt(p[4], 10) - SEMI_OFFSET;
      if (!isNaN(bd) && !isNaN(bs)) { slot.bassDeg = bd; slot.bassSemis = bs; }
    }
    /* The hash is read before the key exists, so the body is checked on its
     * own root: a body that does not parse would render an empty slot, and
     * dropping it is better than showing a hole. */
    return T.typedChord(T.parseNote('C'), slot.body, null) ? slot : null;
  }

  const encodeProg = () => state.prog.map(encodeSlot).join(SEP);

  function decodeProg(str) {
    if (!str) return [];
    const tokens = [];
    str.split(SEP).forEach((tok) => {
      if (LEGACY_SEP.test(tok)) tokens.push(...tok.split('-'));
      else tokens.push(tok);
    });
    return tokens.map(decodeSlot).filter(Boolean);
  }

  function writeHash() {
    let h = `key=${encodeURIComponent(state.tonic)}&mode=${state.mode}&deg=${state.deg}${state.sevenths ? '&7=1' : ''}`;
    if (state.view === 'song') h += '&view=song';
    if (state.prog.length) h += '&p=' + encodeProg();
    if (state.loop) h += '&loop=1';
    if (state.bpm !== BPM_DEFAULT) h += '&bpm=' + state.bpm;
    if (state.lang !== 'en') h += '&lang=' + state.lang;
    if (state.instrument !== 'synth') h += '&snd=' + state.instrument;
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
    /* Without an explicit choice, follow the browser: a Dutch browser opens in
     * Dutch. The toggle overrides it and the choice rides in the URL. */
    const lang = h.get('lang') ||
      ((navigator.language || '').toLowerCase().startsWith('nl') ? 'nl' : 'en');
    state.lang = I18N.set(lang);
    const bpm = parseInt(h.get('bpm'), 10);
    if (!isNaN(bpm)) state.bpm = clampBpm(bpm);
    state.instrument = h.get('snd') === 'piano' ? 'piano' : 'synth';
    Sound.setInstrument(state.instrument);
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
      Sound.chord(singles[parseInt(playBtn.dataset.play, 10)], 0, chordDuration());
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

  $('#langToggle').addEventListener('click', (e) => {
    state.lang = I18N.set(e.currentTarget.dataset.lang);
    render();
    if (!$('#debugPanel').hidden) renderDebugFacts();
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
        Sound.chord(T.voice(chord), 0, chordDuration());
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

  /* Typing a chord the grid does not have. What comes back is stored as a
   * distance from the tonic exactly like a grid position, so a typed C/G
   * follows you to G major as G/D rather than staying behind. */
  function readTypedChord(text) {
    const parsed = T.parseChordSymbol(text);
    if (!parsed) return null;
    return T.songChordAt(key, T.typedSlot(key, parsed));
  }

  function echoTypedChord() {
    const echo = $('#chordEcho');
    const text = $('#chordText').value.trim();
    const chord = text ? readTypedChord(text) : null;
    $('#chordText').classList.toggle('bad', Boolean(text) && !chord);
    echo.classList.toggle('bad', Boolean(text) && !chord);
    echo.textContent = !text ? ''
      : chord ? t('chordinput.preview', { chord: chord.symbol, roman: chord.roman, number: chord.number })
        : t('chordinput.unknown', { text });
  }

  $('#chordText').addEventListener('input', echoTypedChord);

  $('#chordForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chordText');
    const parsed = T.parseChordSymbol(input.value);
    if (!parsed) { echoTypedChord(); input.focus(); return; }

    const slot = T.typedSlot(key, parsed);
    state.prog.push(slot);
    const chord = T.songChordAt(key, slot);
    Sound.unlock();
    Sound.chord(T.voice(chord), 0, chordDuration());
    input.value = '';
    echoTypedChord();
    input.focus();
    renderProgression();
    writeHash();
  });

  /* Tempo. The control lives in static markup rather than in a rendered panel,
   * so adjusting it never interrupts playback. */
  function setBpm(value, fromSlider) {
    state.bpm = clampBpm(value);
    if (!fromSlider) $('#tempo').value = state.bpm;
    const secs = stepSeconds();
    $('#tempoValue').textContent = state.bpm + ' BPM';
    $('#tempoValue').title = secs.toFixed(2) + ' seconds per chord';
    writeHash();
  }

  $('#tempo').addEventListener('input', (e) => setBpm(e.currentTarget.value, true));
  $('#tempoDown').addEventListener('click', () => setBpm(state.bpm - 5));
  $('#tempoUp').addEventListener('click', () => setBpm(state.bpm + 5));

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

  /* Switching instrument mid-phrase would leave half a chord in the old one,
   * so anything already scheduled is cut first. */
  $('#instrumentToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-instrument]');
    if (!btn || btn.dataset.instrument === state.instrument) return;
    stopPlayback();
    state.instrument = btn.dataset.instrument;
    Sound.setInstrument(state.instrument);
    renderInstrument();
    writeHash();
  });

  function renderInstrument() {
    document.querySelectorAll('#instrumentToggle button').forEach((b) => {
      b.classList.toggle('on', b.dataset.instrument === state.instrument);
    });
  }

  /* The label names the action, not the state: a silent page should never
   * tempt anyone into clicking the control that silences it. */
  $('#muteToggle').addEventListener('click', (e) => {
    const muted = !Sound.isMuted();
    Sound.setMuted(muted);
    e.currentTarget.setAttribute('aria-pressed', String(muted));
    e.currentTarget.classList.toggle('on', muted);
    e.currentTarget.textContent = t(muted ? 'toggle.unmute' : 'toggle.mute');
    e.currentTarget.title = t(muted ? 'toggle.unmuteTitle' : 'toggle.muteTitle');
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
      t('diag.blocked'));
  });

  // ---------------------------------------------------------- diagnostics ---

  function renderDebugFacts() {
    const facts = [
      [t('diag.context'), Sound.state()],
      [t('diag.sampleRate'), Sound.sampleRate() ? Sound.sampleRate() + ' Hz' : '—'],
      [t('diag.route'), Sound.route() === 'media-element' ? t('diag.routeMedia') : Sound.route()],
      [t('diag.playback'), t(Sound.isMuted() ? 'diag.muted' : 'diag.on')],
      [t('diag.framed'), t(window.self !== window.top ? 'diag.framedYes' : 'diag.framedNo')],
      [t('diag.key'), t('diag.keyValue', { key: keyName(key), chord: key.diatonic[state.deg].symbol })],
      [t('diag.browser'), navigator.userAgent]
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
      notify(out, 'warn', t('diag.isMuted'));
      return;
    }
    btn.disabled = true;
    btn.textContent = t('diag.listening');
    const r = await Sound.test();
    btn.disabled = false;
    btn.textContent = t('diag.test');

    if (r.producing) {
      notify(out, 'ok', t('diag.working', { pct: Math.round(r.peak * 100), state: r.state }));
    } else {
      const why = r.state === 'suspended' ? 'suspended'
        : r.state === 'unsupported' ? 'unsupported' : 'other';
      notify(out, 'bad', t('diag.none', { state: r.state }) + t('diag.none.' + why));
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
        Sound.chord(singles[parseInt(el.dataset.play, 10)], 0, chordDuration());
      }
    }
  });

  window.addEventListener('hashchange', () => { readHash(); render(); });

  readHash();
  render();
})();
