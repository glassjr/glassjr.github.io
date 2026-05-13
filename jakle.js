(function () {
  'use strict';

  var LENGTHS = [5, 6, 7];
  var MAX_LEADERBOARD = 10;
  var KEYS = {
    STREAK: 'jakle.streak.current',
    GAME: 'jakle.game.inProgress',
    LEADERBOARD: 'jakle.leaderboard'
  };
  var KEYBOARD_LAYOUT = [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['ENTER','z','x','c','v','b','n','m','BACK']
  ];
  var STATUS_RANK = { absent: 1, present: 2, correct: 3 };

  // Swappable storage so a real backend can drop in later.
  var LeaderboardStore = {
    getTop: function (limit) {
      var raw = localStorage.getItem(KEYS.LEADERBOARD);
      var list = [];
      if (raw) {
        try { list = JSON.parse(raw) || []; } catch (e) { list = []; }
      }
      list.sort(function (a, b) {
        if (b.streak !== a.streak) return b.streak - a.streak;
        return a.timestamp - b.timestamp;
      });
      return list.slice(0, limit || MAX_LEADERBOARD);
    },
    submit: function (initials, streak) {
      var raw = localStorage.getItem(KEYS.LEADERBOARD);
      var list = [];
      if (raw) {
        try { list = JSON.parse(raw) || []; } catch (e) { list = []; }
      }
      list.push({ initials: initials, streak: streak, timestamp: Date.now() });
      list.sort(function (a, b) {
        if (b.streak !== a.streak) return b.streak - a.streak;
        return a.timestamp - b.timestamp;
      });
      list = list.slice(0, MAX_LEADERBOARD);
      localStorage.setItem(KEYS.LEADERBOARD, JSON.stringify(list));
      return list;
    },
    qualifies: function (streak) {
      if (streak <= 0) return false;
      var top = this.getTop(MAX_LEADERBOARD);
      if (top.length < MAX_LEADERBOARD) return true;
      return streak > top[top.length - 1].streak;
    }
  };

  var state = {
    words: null,
    target: '',
    length: 0,
    maxGuesses: 0,
    guesses: [],
    current: '',
    phase: 'loading',
    streak: 0,
    keyStatus: {}
  };

  function readStreak() {
    var raw = localStorage.getItem(KEYS.STREAK);
    var n = raw == null ? 0 : parseInt(raw, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  }
  function writeStreak(n) { localStorage.setItem(KEYS.STREAK, String(n)); }
  function saveGame() {
    localStorage.setItem(KEYS.GAME, JSON.stringify({
      target: state.target,
      length: state.length,
      guesses: state.guesses.slice()
    }));
  }
  function clearGame() { localStorage.removeItem(KEYS.GAME); }

  function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function pickWord() {
    var len = pickRandom(LENGTHS);
    var pool = state.words.answers[String(len)];
    return { length: len, target: pickRandom(pool) };
  }

  function startNewGame() {
    var pick = pickWord();
    state.target = pick.target;
    state.length = pick.length;
    state.maxGuesses = pick.length + 1;
    state.guesses = [];
    state.current = '';
    state.phase = 'playing';
    state.keyStatus = {};
    // Don't save in-progress yet — opening the page shouldn't risk the streak.
    // We commit the game on first letter typed (see handleLetter).
    renderAll();
    setMessage('');
  }

  function resumeOrAbandon() {
    var raw = localStorage.getItem(KEYS.GAME);
    if (!raw) return false;
    // A persisted in-progress game on load means the previous session was abandoned.
    // Per design: that counts as a loss.
    var prevStreak = state.streak;
    state.streak = 0;
    writeStreak(0);
    clearGame();
    if (prevStreak > 0 && LeaderboardStore.qualifies(prevStreak)) {
      promptInitials(prevStreak);
    }
    return true;
  }

  // ---------- Feedback ----------

  function computeFeedback(guess, target) {
    var n = guess.length;
    var result = new Array(n);
    var targetChars = target.split('');
    var used = new Array(n);
    for (var i = 0; i < n; i++) {
      if (guess[i] === target[i]) {
        result[i] = 'correct';
        used[i] = true;
      }
    }
    for (var j = 0; j < n; j++) {
      if (result[j]) continue;
      var hit = -1;
      for (var k = 0; k < n; k++) {
        if (!used[k] && targetChars[k] === guess[j]) { hit = k; break; }
      }
      if (hit >= 0) { result[j] = 'present'; used[hit] = true; }
      else { result[j] = 'absent'; }
    }
    return result;
  }

  function updateKeyStatus(guess, feedback) {
    for (var i = 0; i < guess.length; i++) {
      var ch = guess[i];
      var s = feedback[i];
      var cur = state.keyStatus[ch];
      if (!cur || STATUS_RANK[s] > STATUS_RANK[cur]) {
        state.keyStatus[ch] = s;
      }
    }
  }

  // ---------- Rendering ----------

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderBoard() {
    var board = document.getElementById('jakle-board');
    board.innerHTML = '';
    var tileSize = 52, gap = 6;
    for (var r = 0; r < state.maxGuesses; r++) {
      var row = el('div', 'jakle-row');
      row.style.gridTemplateColumns = 'repeat(' + state.length + ', ' + tileSize + 'px)';
      var letters, feedback;
      if (r < state.guesses.length) {
        letters = state.guesses[r].split('');
        feedback = computeFeedback(state.guesses[r], state.target);
      } else if (r === state.guesses.length && state.phase === 'playing') {
        letters = state.current.split('');
        feedback = null;
      } else {
        letters = [];
        feedback = null;
      }
      for (var c = 0; c < state.length; c++) {
        var t = el('div', 'jakle-tile');
        var ch = letters[c];
        if (ch) { t.textContent = ch.toUpperCase(); t.classList.add('jakle-filled'); }
        if (feedback) t.classList.add('jakle-' + feedback[c]);
        row.appendChild(t);
      }
      board.appendChild(row);
    }
    // Adjust grid width responsively on narrow viewports
    var narrow = window.matchMedia('(max-width: 480px)').matches;
    if (narrow) {
      var size = 40;
      var rows = board.querySelectorAll('.jakle-row');
      for (var i = 0; i < rows.length; i++) {
        rows[i].style.gridTemplateColumns = 'repeat(' + state.length + ', ' + size + 'px)';
      }
    }
  }

  function renderKeyboard() {
    var kb = document.getElementById('jakle-keyboard');
    kb.innerHTML = '';
    for (var r = 0; r < KEYBOARD_LAYOUT.length; r++) {
      var row = el('div', 'jakle-keyboard-row');
      for (var i = 0; i < KEYBOARD_LAYOUT[r].length; i++) {
        var k = KEYBOARD_LAYOUT[r][i];
        var btn = el('button', 'jakle-key');
        btn.type = 'button';
        btn.setAttribute('data-key', k);
        if (k === 'ENTER') { btn.textContent = 'Enter'; btn.classList.add('jakle-key-wide'); }
        else if (k === 'BACK') { btn.textContent = '⌫'; btn.classList.add('jakle-key-wide'); }
        else {
          btn.textContent = k;
          var s = state.keyStatus[k];
          if (s) btn.classList.add('jakle-' + s);
        }
        row.appendChild(btn);
      }
      kb.appendChild(row);
    }
  }

  function renderStreak() {
    document.getElementById('jakle-streak').textContent = state.streak;
    document.getElementById('jakle-length').textContent = state.length || '—';
  }

  function renderLeaderboard() {
    var top = LeaderboardStore.getTop(MAX_LEADERBOARD);
    var tbody = document.getElementById('jakle-leaderboard-rows');
    tbody.innerHTML = '';
    if (top.length === 0) {
      var tr = el('tr');
      var td = el('td', 'text-center text-muted', 'No scores yet');
      td.setAttribute('colspan', '3');
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (var i = 0; i < top.length; i++) {
      var row = el('tr');
      row.appendChild(el('td', 'jakle-rank', String(i + 1)));
      row.appendChild(el('td', 'jakle-initials', top[i].initials));
      row.appendChild(el('td', 'text-right', String(top[i].streak)));
      tbody.appendChild(row);
    }
  }

  function renderControls() {
    var btn = document.getElementById('jakle-new-game');
    btn.style.display = (state.phase === 'won' || state.phase === 'lost') ? '' : 'none';
  }

  function renderAll() {
    renderBoard();
    renderKeyboard();
    renderStreak();
    renderControls();
  }

  function setMessage(text, kind) {
    var m = document.getElementById('jakle-message');
    m.textContent = text || '';
    m.classList.remove('jakle-win', 'jakle-loss');
    if (kind) m.classList.add('jakle-' + kind);
  }

  function shakeCurrentRow() {
    var board = document.getElementById('jakle-board');
    var rows = board.querySelectorAll('.jakle-row');
    var row = rows[state.guesses.length];
    if (!row) return;
    row.classList.remove('jakle-row-shake');
    void row.offsetWidth;
    row.classList.add('jakle-row-shake');
  }

  // ---------- Input ----------

  function isValidGuess(g) {
    var pool = state.words.valid[String(state.length)];
    // Linear search; pool is bounded (~20k entries max). Fine for v1.
    for (var i = 0; i < pool.length; i++) if (pool[i] === g) return true;
    return false;
  }

  function handleLetter(ch) {
    if (state.phase !== 'playing') return;
    if (state.current.length >= state.length) return;
    state.current += ch;
    saveGame();
    renderBoard();
  }
  function handleBackspace() {
    if (state.phase !== 'playing') return;
    if (state.current.length === 0) return;
    state.current = state.current.slice(0, -1);
    renderBoard();
  }
  function handleEnter() {
    if (state.phase !== 'playing') return;
    if (state.current.length !== state.length) {
      setMessage('Not enough letters');
      shakeCurrentRow();
      return;
    }
    if (!isValidGuess(state.current)) {
      setMessage('Not in word list');
      shakeCurrentRow();
      return;
    }
    var guess = state.current;
    var fb = computeFeedback(guess, state.target);
    state.guesses.push(guess);
    state.current = '';
    updateKeyStatus(guess, fb);
    saveGame();
    setMessage('');
    if (guess === state.target) {
      finishWin();
    } else if (state.guesses.length >= state.maxGuesses) {
      finishLoss();
    }
    renderAll();
  }

  function finishWin() {
    state.phase = 'won';
    state.streak += 1;
    writeStreak(state.streak);
    clearGame();
    setMessage('Solved! Streak ' + state.streak, 'win');
  }

  function finishLoss() {
    state.phase = 'lost';
    var lostStreak = state.streak;
    state.streak = 0;
    writeStreak(0);
    clearGame();
    setMessage('Word was ' + state.target.toUpperCase() + '. Streak reset.', 'loss');
    if (lostStreak > 0 && LeaderboardStore.qualifies(lostStreak)) {
      promptInitials(lostStreak);
    }
  }

  function promptInitials(streak) {
    document.getElementById('jakle-final-streak').textContent = streak;
    var input = document.getElementById('jakle-initials-input');
    input.value = '';
    var $modal = $('#jakle-initials-modal');
    $modal.data('jakle-streak', streak);
    $modal.modal({ backdrop: 'static', keyboard: false });
    setTimeout(function () { input.focus(); }, 250);
  }

  function submitInitials() {
    var $modal = $('#jakle-initials-modal');
    var streak = $modal.data('jakle-streak') || 0;
    var raw = document.getElementById('jakle-initials-input').value || '';
    var initials = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    if (initials.length === 0) initials = 'AAA';
    while (initials.length < 3) initials += 'A';
    LeaderboardStore.submit(initials, streak);
    $modal.modal('hide');
    renderLeaderboard();
  }

  // ---------- Wiring ----------

  function attachInput() {
    document.addEventListener('keydown', function (e) {
      if ($('#jakle-initials-modal').hasClass('in')) return; // modal owns keys
      if (state.phase !== 'playing') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') { e.preventDefault(); handleEnter(); return; }
      if (e.key === 'Backspace') { e.preventDefault(); handleBackspace(); return; }
      var k = e.key;
      if (k && k.length === 1 && /^[a-zA-Z]$/.test(k)) {
        handleLetter(k.toLowerCase());
      }
    });

    document.getElementById('jakle-keyboard').addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== this && !t.hasAttribute('data-key')) t = t.parentNode;
      if (!t || t === this) return;
      var k = t.getAttribute('data-key');
      if (k === 'ENTER') handleEnter();
      else if (k === 'BACK') handleBackspace();
      else handleLetter(k);
    });

    document.getElementById('jakle-new-game').addEventListener('click', function () {
      startNewGame();
    });

    document.getElementById('jakle-initials-submit').addEventListener('click', submitInitials);
    document.getElementById('jakle-initials-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitInitials(); }
    });
    document.getElementById('jakle-initials-input').addEventListener('input', function (e) {
      var v = e.target.value || '';
      e.target.value = v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    });
  }

  function init() {
    state.streak = readStreak();
    renderLeaderboard();
    renderStreak();

    fetch('jakle-words.json')
      .then(function (r) {
        if (!r.ok) throw new Error('Failed to load wordlist (' + r.status + ')');
        return r.json();
      })
      .then(function (data) {
        state.words = data;
        var hadAbandoned = resumeOrAbandon();
        attachInput();
        startNewGame();
        if (hadAbandoned) {
          setMessage('Previous game abandoned. Streak reset.', 'loss');
        }
      })
      .catch(function (err) {
        setMessage('Could not load word list. Try refreshing.', 'loss');
        console.error(err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
