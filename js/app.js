/*
 * app.js — state, rendering and interaction.
 * Every panel is redrawn from the key object; nothing is hand-maintained.
 */
(() => {
  const T = Theory;

  const state = {
    tonic: 'C',
    mode: 'major',
    deg: 0,
    sevenths: false
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
        <div class="card-top"><span class="num">${state.sevenths ? c.nashville7 : c.nashville}</span></div>
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
          <span class="pill">${state.sevenths ? chord.nashville7 : chord.nashville}</span>
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
    key = T.buildKey(T.parseNote(state.tonic), state.mode);
    if (state.deg > 6 || state.deg < 0) state.deg = 0;

    renderKeyChips();
    renderDiatonic();
    renderDetail();
    renderRelative();
    renderSecondary();
    renderBorrowed();
    renderProgressions();
    writeHash();
  }

  // ----------------------------------------------------------------- hash ---

  function writeHash() {
    const h = `key=${encodeURIComponent(state.tonic)}&mode=${state.mode}&deg=${state.deg}${state.sevenths ? '&7=1' : ''}`;
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

  /* If the browser refuses to start audio at all, say so — the usual cause is
   * the page being embedded in a frame that is not allowed to play sound. */
  Sound.onBlocked(() => {
    const notice = $('#audioNotice');
    if (notice) notice.hidden = false;
  });

  /* Arrow keys walk the diatonic row. */
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
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
