/* MedTimeline — история здоровья из своих документов. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var KEY_STORE = 'mt_api_key';
  var MODEL_STORE = 'mt_model';
  var PRICE = 299;

  var I = {
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M14 2v6h6"/></svg>',
    img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5L5 20"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke-linejoin="round"/></svg>',
    woman: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="7" r="3.4"/><path d="M12 11c-2.6 0-4 2-4.6 4.4L6 21h12l-1.4-5.6C16 13 14.6 11 12 11Z" stroke-linejoin="round"/></svg>',
    man: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="7" r="3.4"/><path d="M5.5 21v-2.2A4.8 4.8 0 0 1 10.3 14h3.4a4.8 4.8 0 0 1 4.8 4.8V21" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  I.person = I.woman;

  var state = {
    docs: [],            // все документы всех профилей
    profiles: [],        // [{id, name, birth, sex, email}]
    currentId: null,
    pending: new Set(),
    applied: new Set(),
    backTo: 'upload',
    signupDraft: null,   // что подставить в форму регистрации
    signupDocs: [],      // документы, ждущие привязки к новому профилю
    foreign: null        // {patient, docs} — чужие документы, ждут оплаты
  };

  // ─── даты и текст ──────────────────────────────────────────────────
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн',
                      'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  // '2019-05-12' парсится как UTC — западнее Гринвича getDate() отдаёт
  // предыдущий день. Собираем дату по частям.
  function D(v) {
    if (v instanceof Date) return v;
    var p = String(v).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function ruDate(v) { var d = D(v); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function isDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || ''); }
  function toRu(iso) {
    if (!isDate(iso)) return '';
    var p = iso.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }
  function fromRu(s) {
    var m = String(s).trim().match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
  }

  function plural(n, one, few, many) {
    var d10 = n % 10, d100 = n % 100;
    if (d10 === 1 && d100 !== 11) return one;
    if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return few;
    return many;
  }
  function monthsBetween(a, b) {
    var d1 = D(a), d2 = D(b);
    var m = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
    if (d2.getDate() < d1.getDate()) m--;
    return Math.max(0, m);
  }
  function spanText(a, b) {
    var m = monthsBetween(a, b), y = Math.floor(m / 12), rm = m % 12;
    if (!y && !rm) return 'меньше месяца';
    if (!y) return rm + ' ' + plural(rm, 'месяц', 'месяца', 'месяцев');
    var s = y + ' ' + plural(y, 'год', 'года', 'лет');
    if (rm) s += ' ' + rm + ' ' + plural(rm, 'месяц', 'месяца', 'месяцев');
    return s;
  }
  function yearsText(a, b) {
    var y = Math.floor(monthsBetween(a, b) / 12);
    return y + ' ' + plural(y, 'год', 'года', 'лет');
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fileSize(n) {
    if (!n) return '';
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' КБ';
    return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ';
  }

  // «Добавить профиль для Ковалёв Пётр Сергеевич» читается как ошибка.
  // Фамилию сознательно не трогаем: по-русски естественно «для Петра
  // Сергеевича», а склонение фамилий — отдельная наука с сотней исключений.
  var GEN_IRREGULAR = {
    'пётр': 'Петра', 'петр': 'Петра', 'павел': 'Павла',
    'лев': 'Льва', 'любовь': 'Любови'
  };
  var HUSH = /[гкхжчшщ]/;   // после них пишется «и», а не «ы»

  function genGiven(w, female) {
    if (!w) return '';
    var low = w.toLowerCase();
    if (GEN_IRREGULAR[low]) return GEN_IRREGULAR[low];
    var last = low.slice(-1), prev = low.slice(-2, -1);
    if (female) {
      if (low.slice(-2) === 'ия') return w.slice(0, -1) + 'и';
      if (last === 'а') return w.slice(0, -1) + (HUSH.test(prev) ? 'и' : 'ы');
      if (last === 'я' || last === 'ь') return w.slice(0, -1) + 'и';
      return w;                                   // несклоняемое
    }
    if (last === 'й' || last === 'ь') return w.slice(0, -1) + 'я';
    if (last === 'а') return w.slice(0, -1) + (HUSH.test(prev) ? 'и' : 'ы');
    if (last === 'я') return w.slice(0, -1) + 'и';
    if (/[бвгджзйклмнпрстфхцчшщ]/.test(last)) return w + 'а';
    return w;
  }

  function genPatronymic(w) {
    if (!w) return '';
    var low = w.toLowerCase();
    if (/(ович|евич|ич)$/.test(low)) return w + 'а';
    if (/(овна|евна|ична)$/.test(low)) return w.slice(0, -1) + 'ы';
    return w;
  }

  function sexFromName(full) {
    var parts = String(full || '').trim().split(/\s+/);
    var patr = (parts[2] || '').toLowerCase();
    if (/(овна|евна|ична)$/.test(patr)) return 'female';
    if (/(ович|евич|ич)$/.test(patr)) return 'male';
    return 'unknown';
  }

  function genitivePerson(full, sex) {
    var parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    var female = sex === 'female' || /(овна|евна|ична)$/i.test(parts[2] || '');
    // В медицинских бланках порядок «Фамилия Имя Отчество»
    if (parts.length >= 3) return genGiven(parts[1], female) + ' ' + genPatronymic(parts[2]);
    if (parts.length === 2) return genGiven(parts[1], female);
    return genGiven(parts[0], female);
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-open'); }, 2400);
  }

  // ─── профили ───────────────────────────────────────────────────────
  function current() {
    return state.profiles.filter(function (p) { return p.id === state.currentId; })[0] || null;
  }
  function myDocs() {
    return state.docs.filter(function (d) { return d.profileId === state.currentId; });
  }
  function saveProfiles() {
    return Promise.all([
      DB.setMeta('profiles', state.profiles),
      DB.setMeta('currentId', state.currentId)
    ]);
  }
  // Сравниваем людей по ФИО без регистра и ё/е плюс дате рождения.
  // Если в документе нет ни того ни другого — считаем «непонятно», а не «чужой»,
  // иначе плохой скан выкинет пользователя в платный экран.
  function normName(s) {
    return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
  }
  function samePerson(p, doc) {
    var dn = normName(doc.name), pn = normName(p.name);
    var db = doc.birthDate || '', pb = p.birth || '';

    // В документе нет ни ФИО, ни даты рождения — сравнивать не с чем.
    // Считаем своим: плохой скан не должен выкидывать в платный экран.
    if (!dn && !db) return true;

    // Профиль теперь всегда заполнен целиком, поэтому расхождение
    // по любому из двух полей — достаточное основание считать документ чужим.
    if (dn && pn && dn !== pn) return false;
    if (db && pb && db !== pb) return false;
    return true;
  }

  // ─── производные данные ────────────────────────────────────────────
  function dated() {
    return myDocs().filter(function (d) { return isDate(d.date); })
      .sort(function (a, b) { return D(b.date) - D(a.date); });
  }
  // Группы документа: по умолчанию — те, что ИИ проставил его показателям.
  // Если человек назначил группы руками, его выбор перекрывает вывод ИИ.
  // Отдельное поле, а не переписывание system у показателей: у одного
  // документа групп может быть несколько, а у показателя система одна.
  function docSystems(doc) {
    if (doc.systems && doc.systems.length) return doc.systems.slice();
    var set = [];
    (doc.indicators || []).forEach(function (i) {
      if (i.system && set.indexOf(i.system) < 0) set.push(i.system);
    });
    return set;
  }
  // Группы не захардкожены: приложение сводит их из поля system,
  // которое ИИ проставил каждому показателю.
  function allSystems() {
    var counts = {};
    myDocs().forEach(function (d) {
      docSystems(d).forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
    });
    return Object.keys(counts)
      .sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b, 'ru'); })
      .map(function (s) { return { name: s, count: counts[s] }; });
  }
  function sysColor(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return 'hsl(' + h + ' 62% 34%)';
  }
  function badge(name) {
    return '<span class="sys-badge" style="--sys-color:' + sysColor(name) + '">' + esc(name) + '</span>';
  }
  function scaleBottom() {
    var p = current();
    if (p && p.birth) return { date: p.birth, label: 'Рождение' };
    var ds = dated();
    if (!ds.length) return null;
    return { date: ds[ds.length - 1].date, label: 'Первый документ' };
  }

  // ─── навигация ─────────────────────────────────────────────────────
  function go(name) {
    var found = false;
    document.querySelectorAll('[data-screen]').forEach(function (s) {
      var on = s.dataset.screen === name;
      s.classList.toggle('is-active', on);
      if (on) found = true;
    });
    if (!found) return;
    closeSheet();
    openPanel(false);
    document.body.classList.remove('select-mode');
    if (name === 'timeline') { renderFilterUI(); renderTimeline(); renderProfileBtn(); }
    if (name === 'groups') renderGroups();
    if (name === 'signup') renderSignup();
    if (name === 'login') renderLogin();
    if (name === 'profile') renderProfile();
    if (name === 'upload') renderUpload();
    if (name === 'settings') renderSettings();
    if (name === 'foreign') renderForeign();
    if (name === 'payment') renderPayment();
    if (name === 'payment-success') renderPaid();
    if (name !== 'settings') state.backTo = name;
    var body = document.querySelector('[data-screen="' + name + '"] .screen-body');
    if (body) body.scrollTop = 0;
  }

  document.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]');
    if (g) go(g.dataset.go);
  });
  $('#settings-back').addEventListener('click', function () { go(state.backTo); });

  // «Назад» с динамики возвращает в тот же слой даты, откуда её открыли,
  // а не просто на таймлайн: человек смотрел показатели конкретного дня.
  $('#dyn-back').addEventListener('click', function () {
    var from = state.dynFrom;
    go('timeline');
    if (from && state.docs.some(function (d) { return d.id === from; })) openSheet(from);
    state.dynFrom = null;
  });

  // ─── маски ввода ───────────────────────────────────────────────────
  function maskDate(v) {
    var d = v.replace(/\D/g, '').slice(0, 8);
    var out = d.slice(0, 2);
    if (d.length > 2) out += '.' + d.slice(2, 4);
    if (d.length > 4) out += '.' + d.slice(4, 8);
    return out;
  }
  function maskExp(v) {
    var d = v.replace(/\D/g, '').slice(0, 4);
    var out = d.slice(0, 2);
    if (d.length > 2) out += '/' + d.slice(2, 4);
    return out;
  }
  var MASKS = { date: maskDate, exp: maskExp };

  // Делегируем на документ: поля появляются и в разметке, и в формах,
  // которые рисуются на лету (правка своих данных).
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el.dataset || !MASKS[el.dataset.mask]) return;
    // При стирании не вмешиваемся: иначе backspace упирается в разделитель,
    // который мы тут же дорисовываем обратно.
    if (e.inputType && e.inputType.indexOf('delete') === 0) return;
    var atEnd = el.selectionStart === el.value.length;
    var v = MASKS[el.dataset.mask](el.value);
    if (v === el.value) return;
    el.value = v;
    if (atEnd) try { el.setSelectionRange(v.length, v.length); } catch (err) { /* не текстовое поле */ }
  });

  // ─── экран загрузки ────────────────────────────────────────────────
  function apiKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function model() {
    try { return localStorage.getItem(MODEL_STORE) || Extract.DEFAULT_MODEL; }
    catch (e) { return Extract.DEFAULT_MODEL; }
  }

  function renderUpload() {
    $('#picked').hidden = true;
    $('#has-docs-block').hidden = myDocs().length === 0;
    var note = $('#mode-note');
    if (apiKey()) {
      note.innerHTML = 'Распознавание начнётся сразу после выбора файлов. Модель ' + esc(model()) + '.';
    } else {
      note.innerHTML = 'Ключ OpenAI не добавлен — распознать документы не получится.<br>' +
        '<button class="aslink" type="button" data-go="settings">Добавить ключ или включить демо</button>';
    }
  }

  function addFiles(files) {
    var ok = [], skipped = 0;
    Array.prototype.forEach.call(files, function (f) {
      if (f.type === 'application/pdf' || f.type.indexOf('image/') === 0) ok.push(f);
      else skipped++;
    });
    if (skipped) toast('Пропущено файлов не того формата: ' + skipped);
    if (!ok.length) return;

    if (!apiKey()) { go('settings'); toast('Сначала добавьте ключ или включите демо'); return; }

    resolveDuplicates(ok).then(function (plan) {
      if (!plan.length) { toast('Ничего не загружено — все документы уже есть'); return; }
      startRecognition(plan, function (f) { return Extract.withAI(f, apiKey(), model()); });
    });
  }

  $('#file-input').addEventListener('change', function () {
    addFiles(this.files);
    this.value = '';               // иначе тот же файл повторно не выберется
  });

  var dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('is-over'); });
  });
  dz.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  // ─── дубликаты ─────────────────────────────────────────────────────
  // Сличаем до отправки в модель: разбор платный, тратить деньги на файл,
  // который уже разобран, незачем.
  function findDuplicate(file) {
    return myDocs().filter(function (d) {
      return d.fileName === file.name && (!d.size || !file.size || d.size === file.size);
    })[0];
  }

  var dupChoice = null;   // «так же поступить с остальными»

  function askDuplicate(file, existing, restCount) {
    if (dupChoice) return Promise.resolve(dupChoice);
    return new Promise(function (resolve) {
      $('#dup-text').innerHTML = 'Файл <b>' + esc(file.name) + '</b> уже загружен' +
        (isDate(existing.date) ? ' — ' + ruDate(existing.date) + ', ' + esc(existing.title) : '') +
        '. Заменить его новым разбором или оставить как есть?';
      var all = $('#dup-all');
      all.checked = false;
      all.parentNode.hidden = restCount < 1;

      openModal(true);
      function done(choice) {
        openModal(false);
        if (all.checked) dupChoice = choice;
        $('#dup-replace').removeEventListener('click', onReplace);
        $('#dup-keep').removeEventListener('click', onKeep);
        resolve(choice);
      }
      function onReplace() { done('replace'); }
      function onKeep() { done('keep'); }
      $('#dup-replace').addEventListener('click', onReplace);
      $('#dup-keep').addEventListener('click', onKeep);
    });
  }

  function openModal(open) {
    $('#dup-modal').classList.toggle('is-open', open);
    $('#dup-backdrop').classList.toggle('is-open', open);
  }

  function resolveDuplicates(files) {
    dupChoice = null;
    var plan = [];
    var chain = Promise.resolve();
    files.forEach(function (f, idx) {
      chain = chain.then(function () {
        var dup = findDuplicate(f);
        if (!dup) { plan.push({ file: f, replaces: null }); return; }
        return askDuplicate(f, dup, files.length - idx - 1).then(function (choice) {
          if (choice === 'replace') plan.push({ file: f, replaces: dup.id });
        });
      });
    });
    return chain.then(function () { return plan; });
  }

  // Сколько измерений у каждого показателя сейчас. Ключ — каноничное
  // имя первого встреченного написания, чтобы «ТТГ» и «ТТГ (тиреотропный
  // гормон)» считались одним рядом.
  function seriesSnapshot() {
    var out = {};
    myDocs().forEach(function (d) {
      if (!isDate(d.date)) return;
      (d.indicators || []).forEach(function (i) {
        if (numOf(i.value) === null) return;
        var key = Object.keys(out).filter(function (k) { return sameSeries(k, i.name); })[0] || i.name;
        out[key] = (out[key] || 0) + 1;
      });
    });
    return out;
  }

  // Показатели, у которых динамика появилась или пополнилась новыми точками
  function newlyCharted(before) {
    var after = seriesSnapshot();
    return Object.keys(after).filter(function (name) {
      if (after[name] < 2) return false;
      var was = Object.keys(before).filter(function (k) { return sameSeries(k, name); })[0];
      return !was || before[was] < after[name];
    }).map(function (name) { return { name: name, count: after[name] }; });
  }

  // ─── распознавание ─────────────────────────────────────────────────
  function startRecognition(plan, extractor) {
    state.busy = true;              // чтение из IndexedDB не должно перебить экран
    go('processing');
    $('#proc-hint').textContent = 'ИИ читает документы. Обычно 5–15 секунд на файл.';
    $('#proc-list').innerHTML = plan.map(function (p, i) {
      return '<div class="filerow" data-row="' + i + '">' +
        '<span class="fname"><strong>' + esc(p.file.name) + '</strong><span data-note>в очереди</span></span>' +
        '<span class="fstatus"><span class="spinner"></span></span>' +
      '</div>';
    }).join('');

    var cta = $('#proc-cta');
    cta.disabled = true;
    cta.textContent = 'Смотреть историю';

    var done = 0, failed = 0, foreign = [], firstPatient = null;
    state.signupDocs = [];
    // Снимок серий ДО загрузки: после неё сравним и скажем, у каких
    // показателей появилась динамика. Иначе человек не узнает, что новый
    // документ состыковался со старыми, — кнопка просто тихо появится.
    var seriesBefore = seriesSnapshot();

    // Последовательно, а не пачкой: не упираемся в лимит запросов
    // и видно, на каком файле всё встало.
    var chain = Promise.resolve();
    plan.forEach(function (p, i) {
      chain = chain.then(function () {
        var row = document.querySelector('[data-row="' + i + '"]');
        if (row) row.querySelector('[data-note]').textContent = 'читаем…';
        return extractor(p.file).then(function (r) {
          if (!r.isMedical) throw new Error('Это не похоже на медицинский документ');

          var doc = {
            id: DB.uid(),
            profileId: null,
            fileName: p.file.name,
            mime: p.file.type,
            size: p.file.size,
            blob: p.file.size ? p.file : null,
            addedAt: Date.now(),
            date: r.date, title: r.title, clinic: r.clinic,
            patient: r.patient, indicators: r.indicators
          };

          var owner = current();
          var mine = !owner || samePerson(owner, r.patient);

          if (!owner) {
            // профиля ещё нет — первый документ его и задаёт
            if (!firstPatient && (r.patient.name || r.patient.birthDate)) firstPatient = r.patient;
            state.signupDocs.push(doc);
          } else if (mine) {
            doc.profileId = state.currentId;
          } else {
            foreign.push(doc);
          }

          var save = Promise.resolve();
          if (doc.profileId) {
            if (p.replaces) save = DB.remove(p.replaces).then(function () {
              state.docs = state.docs.filter(function (d) { return d.id !== p.replaces; });
            });
            save = save.then(function () { return DB.put(doc); })
              .then(function () { state.docs.push(doc); });
          }

          return save.then(function () {
            done++;
            if (row) {
              row.querySelector('[data-note]').textContent = mine
                ? (isDate(r.date) ? ruDate(r.date) : 'без даты') + ' · ' + r.title +
                  ' · показателей: ' + r.indicators.length
                : 'другой человек: ' + (r.patient.name || 'имя не найдено');
              row.querySelector('.fstatus').innerHTML = mine
                ? '<span class="check-ok">' + I.check + '</span>'
                : '<span class="fail">чужой</span>';
            }
          });
        }).catch(function (err) {
          failed++;
          if (row) {
            row.querySelector('[data-note]').textContent = err.message || 'не получилось';
            row.querySelector('.fstatus').innerHTML = '<span class="fail">сбой</span>';
          }
        });
      });
    });

    chain.then(function () {
      state.busy = false;
      cta.disabled = false;
      $('#proc-hint').textContent = failed
        ? 'Готово: ' + done + ' из ' + plan.length + '. Файлы со сбоем можно загрузить заново.'
        : 'Готово: ' + done + ' ' + plain(done);
      renderUpload();

      if (!current() && state.signupDocs.length) {
        state.signupDraft = firstPatient || { name: '', birthDate: '', sex: 'unknown' };
        cta.textContent = 'Проверить свои данные';
        cta.onclick = function () { go('signup'); };
        return;
      }
      if (foreign.length) {
        state.foreign = { patient: foreign[0].patient, docs: foreign };
        var gen = genitivePerson(foreign[0].patient.name, foreign[0].patient.sex);
        cta.textContent = gen ? 'Добавить профиль для ' + gen : 'Добавить профиль для этого человека';
        cta.onclick = function () { go('foreign'); };
        return;
      }
      cta.onclick = function () { go('timeline'); };
      showNewCharts(seriesBefore);
    });
  }
  function plain(n) { return plural(n, 'документ', 'документа', 'документов'); }

  function showNewCharts(before) {
    var zone = $('#proc-new');
    var fresh = newlyCharted(before);
    zone.hidden = !fresh.length;
    if (!fresh.length) return;
    zone.innerHTML = '<div class="section-label">Обновилась динамика</div>' +
      '<p class="muted" style="font-size:var(--text-sm)">Новые документы состыковались со старыми — ' +
      'у этих показателей график пересчитан:</p>' +
      '<div class="chip-row">' + fresh.map(function (s) {
        return '<button class="chip" type="button" data-newchart="' + esc(s.name) + '">' +
          esc(s.name) + ' <span class="count">' + s.count + '</span></button>';
      }).join('') + '</div>';
  }

  $('#proc-new').addEventListener('click', function (e) {
    var chip = e.target.closest('[data-newchart]');
    if (!chip) return;
    state.dynFrom = null;              // пришли не из слоя даты, а со сводки
    showDynamics(chip.dataset.newchart);
  });

  $('#proc-cta').addEventListener('click', function () {
    if (!this.onclick) go('timeline');
  });

  // ─── вход и пароль ─────────────────────────────────────────────────
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s).trim()); }

  // «Показать пароль» там, где второго поля нет. На регистрации вместо него
  // поле «Повторить пароль». Проверка на null обязательна: пропавший элемент
  // иначе роняет весь скрипт, и молча отваливаются все обработчики ниже.
  function bindReveal(box, input) {
    var b = $(box), i = $(input);
    if (!b || !i) return;
    b.addEventListener('change', function () { i.type = this.checked ? 'text' : 'password'; });
  }
  bindReveal('#li-show', '#li-pass');
  bindReveal('#ap-show', '#ap-pass');

  function renderLogin() {
    $('#li-email').value = Auth.email() || '';
    $('#li-pass').value = '';
    $('#li-show').checked = false;
    $('#li-pass').type = 'password';
  }

  function unlock() {
    var email = $('#li-email').value.trim();
    var pass = $('#li-pass').value;
    if (!email || !pass) return toast('Введите почту и пароль');
    var btn = $('#li-go');
    btn.disabled = true;
    Auth.verify(email, pass)
      .then(function (ok) {
        btn.disabled = false;
        if (!ok) { $('#li-pass').value = ''; return toast('Почта или пароль не подходят'); }
        boot();
      })
      .catch(function () { btn.disabled = false; toast('Не удалось проверить пароль'); });
  }
  $('#li-go').addEventListener('click', unlock);
  $('#li-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock(); });

  $('#li-forgot').addEventListener('click', function () {
    if (!confirm('Стереть все документы, показатели и профили из этого браузера и начать заново? Отменить будет нельзя.')) return;
    DB.clear()
      .then(function () {
        return Promise.all([DB.setMeta('profiles', []), DB.setMeta('currentId', null), Auth.clear()]);
      })
      .then(function () {
        state.docs = []; state.profiles = []; state.currentId = null;
        state.applied.clear(); state.pending.clear();
        boot();
        toast('История стёрта');
      });
  });

  // ─── регистрация ───────────────────────────────────────────────────
  function renderSignup() {
    var d = state.signupDraft || { name: '', birthDate: '' };
    var adding = !!state.paidPending;

    $('#su-name').value = d.name || '';
    $('#su-birth').value = toRu(d.birthDate) || '';
    $('#su-name-tag').hidden = !d.name;
    $('#su-birth-tag').hidden = !d.birthDate;
    $('#su-pass2').value = '';
    $('#su-pass').value = '';
    $('#su-pass-hint').hidden = true;

    // Пароль уже стоит (аккаунт есть) — второй раз не спрашиваем.
    var needPass = Auth.available && !Auth.exists() && !adding;
    $('#su-pass').closest('.field').hidden = !needPass;
    $('#su-pass2').closest('.field').hidden = !needPass;
    $('#su-email').closest('.field').hidden = !needPass;
    if (!needPass) $('#su-email').value = Auth.email() || '';

    document.querySelector('[data-screen="signup"] h1').textContent = adding ? 'Кого добавляем?' : 'Это вы?';
    $('#su-save').textContent = adding ? 'Создать профиль' : 'Сохранить историю';

    var banner = $('#signup-found');
    if (adding) {
      banner.innerHTML = 'Оплата прошла. Впишите, чей это профиль — дата рождения нужна, чтобы построить шкалу таймлайна.';
      return;
    }
    var src = state.signupDocs[0];
    banner.innerHTML = d.name || d.birthDate
      ? 'ИИ нашёл ваши данные в документе <b>' + esc(src ? src.fileName : '') + '</b>. Проверьте и поправьте, если что-то не так.'
      : 'В документе не нашлись ФИО и дата рождения — впишите их сами. Дата рождения нужна, чтобы построить шкалу.';
  }

  // Несовпадение видно до нажатия «Сохранить», а не после
  function checkPassMatch() {
    var a = $('#su-pass').value, b = $('#su-pass2').value;
    $('#su-pass-hint').hidden = !(b && a !== b);
  }
  $('#su-pass').addEventListener('input', checkPassMatch);
  $('#su-pass2').addEventListener('input', checkPassMatch);

  $('#su-save').addEventListener('click', function () {
    var name = $('#su-name').value.trim();
    var birthRu = $('#su-birth').value.trim();
    var birth = fromRu(birthRu);
    var bad = validateIdentity(name, birthRu, birth);
    if (bad) return toast(bad);

    var adding = !!state.paidPending;
    var email = $('#su-email').value.trim();
    var pass = $('#su-pass').value, pass2 = $('#su-pass2').value;
    var needPass = Auth.available && !Auth.exists() && !adding;
    if (needPass) {
      if (!isEmail(email)) return toast('Впишите почту — по ней вы будете входить');
      if (pass.length < Auth.MIN_LEN) return toast('Пароль — не короче ' + Auth.MIN_LEN + ' символов');
      if (pass !== pass2) { $('#su-pass-hint').hidden = false; return toast('Пароли не совпадают'); }
    }

    var p = {
      id: DB.uid(),
      name: name,
      birth: birth,
      // Отчество говорит о поле надёжнее, чем ничего: при ручном вводе
      // ИИ пол не подсказал, а иконку показывать всё равно надо.
      sex: (state.signupDraft && state.signupDraft.sex !== 'unknown' && state.signupDraft.sex) || sexFromName(name),
      email: email,
      paid: adding
    };
    state.profiles.push(p);
    state.currentId = p.id;

    var docs = state.signupDocs.slice();
    docs.forEach(function (d) { d.profileId = p.id; });
    state.signupDocs = [];

    var btn = this;
    btn.disabled = true;
    (needPass ? Auth.create(email, pass) : Promise.resolve())
      .then(function () { return Promise.all(docs.map(function (d) { return DB.put(d); })); })
      .then(function () { docs.forEach(function (d) { state.docs.push(d); }); return saveProfiles(); })
      .then(function () {
        btn.disabled = false;
        var wasAdding = state.paidPending;
        state.paidPending = false;
        state.addProfile = false;
        state.applied.clear(); state.pending.clear();
        go('timeline');
        toast(wasAdding ? 'Профиль создан' : 'История сохранена');
      })
      .catch(function (err) {
        btn.disabled = false;
        console.error(err);
        toast('Не удалось сохранить — попробуйте ещё раз');
      });
  });

  // ─── чужой документ → питч → оплата ────────────────────────────────
  // Питч работает в двух режимах: после чужого документа и просто по
  // кнопке «Добавить профиль» в профиле — там платить предлагают заранее,
  // а имя человека спросят после оплаты.
  function renderForeign() {
    var f = state.foreign;
    var back = $('#foreign .topbar .iconbtn') || document.querySelector('[data-screen="foreign"] .iconbtn');

    if (!f) {
      if (!state.addProfile) return go('timeline');
      document.querySelector('[data-screen="foreign"] h1').textContent = 'Ещё один профиль';
      $('#foreign-note').innerHTML = 'Второй профиль — для родственника или ребёнка. ' +
        'Его документы и показатели не смешаются с вашими: своя история, свой таймлайн, свои графики.';
      $('#foreign-title').innerHTML = 'Добавьте профиль ещё одного человека';
      $('#foreign-skip').textContent = 'Не сейчас';
      if (back) back.dataset.go = 'profile';
      return;
    }

    document.querySelector('[data-screen="foreign"] h1').textContent = 'В документе другое имя';
    if (back) back.dataset.go = 'timeline';
    $('#foreign-skip').textContent = 'Не сейчас — не загружать эти документы';

    var who = f.patient.name || 'другой человек';
    var bd = f.patient.birthDate ? ', ' + toRu(f.patient.birthDate) : '';
    var names = f.docs.map(function (d) { return d.fileName; }).join(', ');
    $('#foreign-note').innerHTML = 'В ' + (f.docs.length > 1 ? 'файлах' : 'файле') + ' <b>' + esc(names) +
      '</b> указан <b>' + esc(who) + esc(bd) + '</b>. Это не ваши анализы — в вашу историю они не попали.';
    var gen = genitivePerson(who, f.patient.sex);
    $('#foreign-title').innerHTML = gen
      ? 'Заведите профиль для ' + esc(gen)
      : 'Заведите отдельный профиль<br><span class="who">' + esc(who) + '</span>';
  }

  $('#foreign-skip').addEventListener('click', function () {
    if (!state.foreign) { state.addProfile = false; return go('profile'); }
    var n = state.foreign.docs.length;
    state.foreign = null;
    go('timeline');
    toast(n + ' ' + plain(n) + ' не загружено');
  });

  function renderPayment() {
    var f = state.foreign;
    if (!f && !state.addProfile) return go('timeline');
    $('#pay-summary').innerHTML =
      '<div class="kv"><dt>Профиль</dt><dd>' + esc(f ? (f.patient.name || 'Новый профиль') : 'Новый профиль') + '</dd></div>' +
      (f ? '<div class="kv"><dt>Документов</dt><dd>' + f.docs.length + '</dd></div>' : '') +
      '<div class="kv"><dt>К оплате</dt><dd>' + PRICE + ' ₽</dd></div>';
  }

  $('#pay-go').addEventListener('click', function () {
    var f = state.foreign;
    if (!f && !state.addProfile) return go('timeline');
    if ($('#pay-num').value.replace(/\D/g, '').length < 12) return toast('Введите номер карты');

    // Профиль без документов: имя спрашиваем сразу после оплаты
    if (!f) {
      state.paidPending = true;
      state.signupDraft = null;
      state.signupDocs = [];
      return go('signup');
    }

    var p = {
      id: DB.uid(),
      name: f.patient.name,
      birth: f.patient.birthDate,
      sex: f.patient.sex || 'unknown',
      email: '',
      paid: true
    };
    state.profiles.push(p);
    f.docs.forEach(function (d) { d.profileId = p.id; });

    Promise.all(f.docs.map(function (d) { return DB.put(d); }))
      .then(function () { f.docs.forEach(function (d) { state.docs.push(d); }); return saveProfiles(); })
      .then(function () { state.paidProfile = p; go('payment-success'); });
  });

  function renderPaid() {
    var p = state.paidProfile;
    var f = state.foreign;
    if (!p) return go('timeline');
    var n = f ? f.docs.length : 0;
    $('#paid-note').innerHTML = 'Профиль «' + esc(p.name || 'Без имени') +
      '» добавлен в аккаунт, в нём ' + n + ' ' + plain(n) + '.';
    $('#paid-profiles').innerHTML = '<div class="section-label">Профили в аккаунте</div>' +
      state.profiles.map(profileRow).join('');
  }

  $('#paid-open').addEventListener('click', function () {
    if (state.paidProfile) state.currentId = state.paidProfile.id;
    state.foreign = null;
    state.applied.clear();
    saveProfiles().then(function () { go('timeline'); });
  });
  $('#paid-back').addEventListener('click', function () {
    state.foreign = null;
    go('timeline');
  });

  // ─── таймлайн ──────────────────────────────────────────────────────
  // Масштаб линейный: 2 года ровно вдвое длиннее года. Выше MAX_GAP_PX
  // высота упирается в потолок и промежуток помечается свёрнутым — иначе
  // 29 лет до первого анализа заняли бы 1600 px. Потолок, а не схлопывание
  // в бейдж: так длинный разрыв никогда не окажется короче короткого.
  var PX_PER_YEAR = 56, MAX_GAP_PX = 200, MIN_GAP_PX = 26;

  function gapBlock(a, b) {
    var raw = (monthsBetween(a, b) / 12) * PX_PER_YEAR;
    var cut = raw > MAX_GAP_PX;
    var h = Math.max(MIN_GAP_PX, Math.min(MAX_GAP_PX, Math.round(raw)));
    return '<div class="gap' + (cut ? ' is-cut' : '') + '" style="height:' + h + 'px">' +
      (cut ? '<span class="cut-badge">' + spanText(a, b) + ' свёрнуто</span>'
           : '<span class="gap-label">' + spanText(a, b) + '</span>') + '</div>';
  }
  function marker(cls, dateLabel, sub) {
    return '<div class="mk ' + cls + '"><span class="mk-dot"></span>' +
      '<span class="mk-text"><strong>' + esc(dateLabel) + '</strong><span>' + esc(sub) + '</span></span></div>';
  }

  function renderTimeline() {
    var flow = $('#tl-flow');
    if (!myDocs().length) {
      flow.innerHTML = '<p class="tl-empty">Пока ни одного документа.<br>Загрузите PDF или фото — история появится здесь.</p>';
      return;
    }

    var docs = dated().filter(function (d) {
      if (!state.applied.size) return true;
      return docSystems(d).some(function (s) { return state.applied.has(s); });
    });
    var undated = myDocs().length - dated().length;
    var today = new Date();
    var bottom = scaleBottom();

    if (!docs.length) {
      flow.innerHTML = '<p class="tl-empty">В выбранных группах документов нет</p>';
      return;
    }

    var html = marker('is-now', ruDate(today),
      bottom && bottom.label === 'Рождение' ? 'Сегодня · ' + yearsText(bottom.date, today) : 'Сегодня');
    html += gapBlock(docs[0].date, today);

    docs.forEach(function (d, i) {
      html += '<div class="ev"><span class="ev-dot"></span>' +
        '<button class="ev-card" data-doc="' + d.id + '">' +
          '<span class="tdate">' + ruDate(d.date) + '</span>' +
          '<span class="ttitle">' + esc(d.title) + (d.clinic ? ' · ' + esc(d.clinic) : '') + '</span>' +
          '<span class="ev-badges">' + docSystems(d).map(badge).join('') + '</span>' +
        '</button></div>';
      var next = docs[i + 1];
      if (next) html += gapBlock(next.date, d.date);
    });

    var last = docs[docs.length - 1].date;
    if (bottom && monthsBetween(bottom.date, last) > 0) {
      html += gapBlock(bottom.date, last);
      html += marker('is-birth', ruDate(bottom.date), bottom.label);
    }
    if (undated) {
      html += '<p class="tl-empty">Ещё ' + undated + ' ' + plain(undated) +
        ' без даты — ИИ не нашёл её в файле</p>';
    }

    flow.innerHTML = html;
    $('#tl-scroll').scrollTop = 0;
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-doc]');
    if (b) openSheet(b.dataset.doc);
  });

  function renderProfileBtn() {
    var p = current();
    var sex = p ? p.sex : 'unknown';
    $('#tl-ava').innerHTML = sex === 'male' ? I.man : (sex === 'female' ? I.woman : I.person);
    $('#tl-pname').textContent = p && p.name
      ? (p.name.split(/\s+/)[1] || p.name.split(/\s+/)[0])
      : 'Профиль';
  }

  // ─── фильтр ────────────────────────────────────────────────────────
  function sameSets(a, b) {
    return a.size === b.size && Array.from(a).every(function (k) { return b.has(k); });
  }
  function buildOptions() {
    var systems = allSystems();
    $('#filter-options').innerHTML = systems.length
      ? systems.map(function (s) {
          return '<button class="opt" type="button" data-filter="' + esc(s.name) + '">' +
            '<span class="opt-box">' + I.check + '</span>' +
            '<span class="opt-name">' + esc(s.name) + '</span>' +
            '<span class="opt-count">' + s.count + '</span></button>';
        }).join('')
      : '<p class="panel-note">Групп пока нет — загрузите документы.</p>';
  }
  // Пересобирать список внутри обработчика клика нельзя: узел оторвётся
  // от документа, и «клик мимо панели» примет его за внешний.
  function syncOptions() {
    $('#filter-options').querySelectorAll('[data-filter]').forEach(function (o) {
      o.classList.toggle('is-on', state.pending.has(o.dataset.filter));
    });
    var apply = $('#apply-filter');
    apply.disabled = sameSets(state.pending, state.applied);
    apply.textContent = state.pending.size
      ? 'Применить · ' + state.pending.size + ' ' + plural(state.pending.size, 'группа', 'группы', 'групп')
      : 'Показать все документы';
  }
  function renderFilterUI() {
    var live = {};
    allSystems().forEach(function (s) { live[s.name] = true; });
    Array.from(state.applied).forEach(function (s) { if (!live[s]) state.applied.delete(s); });
    buildOptions();
    state.pending = new Set(state.applied);
    syncOptions();
    var on = state.applied.size > 0;
    $('#filter-trigger').classList.toggle('is-on', on);
    $('#reset-filter').hidden = !on;
    $('#ft-label').textContent = on ? Array.from(state.applied).join(', ') : 'Все системы';
  }
  function openPanel(open) {
    $('#filter-panel').hidden = !open;
    $('#filter-trigger').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { state.pending = new Set(state.applied); syncOptions(); }
  }
  $('#filter-trigger').addEventListener('click', function (e) {
    e.stopPropagation();
    openPanel($('#filter-panel').hidden);
  });
  $('#filter-options').addEventListener('click', function (e) {
    e.stopPropagation();
    var opt = e.target.closest('[data-filter]');
    if (!opt) return;
    var k = opt.dataset.filter;
    if (state.pending.has(k)) state.pending.delete(k); else state.pending.add(k);
    syncOptions();
  });
  $('#apply-filter').addEventListener('click', function () {
    state.applied = new Set(state.pending);
    openPanel(false); renderFilterUI(); renderTimeline();
    toast(state.applied.size ? 'Фильтр применён' : 'Показаны все документы');
  });
  $('#reset-filter').addEventListener('click', function () {
    state.pending.clear(); state.applied.clear();
    openPanel(false); renderFilterUI(); renderTimeline();
  });
  document.addEventListener('click', function (e) {
    if ($('#filter-panel').hidden) return;
    if (!document.contains(e.target)) return;
    if (e.target.closest('.tl-filters')) return;
    openPanel(false);
  });

  // ─── экран «Группы документов» ─────────────────────────────────────
  var selected = new Set(), pressTimer = null;

  function renderGroups() {
    var systems = allSystems();
    $('#group-chips').innerHTML = systems.map(function (s) {
      return '<span class="chip">' + esc(s.name) + ' <span class="count">' + s.count + '</span></span>';
    }).join('') + '<button class="chip chip-ghost" id="add-group" type="button">+ Своя группа</button>';

    $('#assign-chips').innerHTML = systems.map(function (s) {
      return '<button class="chip" type="button" data-assign="' + esc(s.name) + '">' +
        '<span class="tick">' + I.check + '</span>' + esc(s.name) + '</button>';
    }).join('');

    $('#group-doclist').innerHTML = dated().concat(
      myDocs().filter(function (d) { return !isDate(d.date); })
    ).map(function (d) {
      var manual = d.systems && d.systems.length;
      return '<div class="doc-select-row" data-id="' + d.id + '">' +
        '<span class="checkbox">' + I.check + '</span>' +
        '<span class="fmeta"><strong>' + esc(d.title) + '</strong>' +
          '<span>' + (isDate(d.date) ? ruDate(d.date) : 'без даты') +
          (d.clinic ? ' · ' + esc(d.clinic) : '') +
          (manual ? ' · группы заданы вручную' : '') + '</span></span>' +
        '<span class="badges">' + docSystems(d).map(badge).join('') + '</span>' +
      '</div>';
    }).join('') || '<p class="muted">Документов пока нет</p>';

    refreshSelection();
    syncAssign();
  }

  function refreshSelection() {
    $('#group-doclist').querySelectorAll('.doc-select-row').forEach(function (r) {
      r.classList.toggle('is-selected', selected.has(r.dataset.id));
    });
    $('#assign-count').textContent = 'Выбрано документов: ' + selected.size +
      '. Отметьте одну или несколько групп.';
    syncAssign();
  }

  $('#group-chips').addEventListener('click', function (e) {
    if (!e.target.closest('#add-group')) return;
    var name = prompt('Название группы, например «Беременность»');
    if (!name || !name.trim()) return;
    name = name.trim();
    // Пустая группа нигде не хранится: она существует, только пока в ней
    // есть документы. Показываем её как цель присвоения и ждём выбора.
    if (!$('#assign-chips').querySelector('[data-assign="' + name.replace(/"/g, '') + '"]')) {
      $('#assign-chips').insertAdjacentHTML('beforeend',
        '<button class="chip" type="button" data-assign="' + esc(name) + '">' +
        '<span class="tick">' + I.check + '</span>' + esc(name) + '</button>');
    }
    chosen.add(name);
    document.body.classList.add('select-mode');
    syncAssign();
    toast(selected.size
      ? 'Группа «' + name + '» отмечена — нажмите «Присвоить»'
      : 'Выделите документы долгим тапом, затем нажмите «Присвоить»');
  });

  var list = $('#group-doclist');
  list.addEventListener('pointerdown', function (e) {
    var row = e.target.closest('.doc-select-row');
    if (!row) return;
    pressTimer = setTimeout(function () {
      document.body.classList.add('select-mode');
      selected.add(row.dataset.id);
      refreshSelection();
    }, 450);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
    list.addEventListener(ev, function () { clearTimeout(pressTimer); });
  });
  list.addEventListener('click', function (e) {
    if (!document.body.classList.contains('select-mode')) return;
    var row = e.target.closest('.doc-select-row');
    if (!row) return;
    if (selected.has(row.dataset.id)) selected.delete(row.dataset.id);
    else selected.add(row.dataset.id);
    refreshSelection();
  });
  $('#cancel-select').addEventListener('click', function () {
    document.body.classList.remove('select-mode');
    selected.clear();
    refreshSelection();
  });
  document.querySelector('[data-screen="groups"] .assign-bar').addEventListener('click', function (e) {
    var chip = e.target.closest('[data-assign]');
    if (chip) {
      var g = chip.dataset.assign;
      if (chosen.has(g)) chosen.delete(g); else chosen.add(g);
      return syncAssign();
    }
    if (e.target.closest('#assign-apply')) return assignChosen();
    if (e.target.closest('#assign-reset')) return resetGroups();
  });

  // Перенос документа в группу переписывает system у всех его показателей:
  // «группа документа» — это и есть общая группа его показателей.
  // Группы копятся в наборе, применяются одним нажатием: документ может
  // принадлежать нескольким системам сразу — общий анализ крови это
  // и «Кровь», и «Витамины и железо».
  var chosen = new Set();

  function syncAssign() {
    $('#assign-chips').querySelectorAll('[data-assign]').forEach(function (c) {
      c.classList.toggle('is-active', chosen.has(c.dataset.assign));
    });
    var btn = $('#assign-apply');
    btn.disabled = !selected.size || !chosen.size;
    btn.textContent = chosen.size
      ? 'Присвоить ' + chosen.size + ' ' + plural(chosen.size, 'группу', 'группы', 'групп')
      : 'Выберите группы';
  }

  function assignChosen() {
    if (!selected.size) return toast('Сначала выделите документы');
    if (!chosen.size) return toast('Выберите хотя бы одну группу');

    var groups = Array.from(chosen);
    var docs = Array.from(selected).map(function (id) {
      return state.docs.filter(function (d) { return d.id === id; })[0];
    }).filter(Boolean);

    docs.forEach(function (d) { d.systems = groups.slice(); });

    Promise.all(docs.map(function (d) { return DB.put(d); })).then(function () {
      document.body.classList.remove('select-mode');
      selected.clear();
      chosen.clear();
      renderGroups();
      renderFilterUI();
      toast(docs.length + ' ' + plain(docs.length) + ' → ' + groups.join(', '));
    });
  }

  // Вернуть документу разбивку, которую предложил ИИ
  function resetGroups() {
    var docs = Array.from(selected).map(function (id) {
      return state.docs.filter(function (d) { return d.id === id; })[0];
    }).filter(Boolean);
    docs.forEach(function (d) { delete d.systems; });
    Promise.all(docs.map(function (d) { return DB.put(d); })).then(function () {
      document.body.classList.remove('select-mode');
      selected.clear(); chosen.clear();
      renderGroups(); renderFilterUI();
      toast('Вернули группы, которые предложил ИИ');
    });
  }

  // ─── слой даты ─────────────────────────────────────────────────────
  var sheet = $('#sheet'), backdrop = $('#sheet-backdrop');
  var openDocId = null;

  // Одно и то же вещество лаборатории называют по-разному: «ТТГ»,
  // «ТТГ (тиреотропный гормон)», «Тиреотропный гормон (ТТГ)». Буквальное
  // сравнение рвало серию на три части, и график не появлялся.
  // Разбираем имя на основную часть и то, что в скобках, и сличаем крест-накрест.
  function clean(s) { return String(s).replace(/[^a-zа-я0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  function parseName(name) {
    var s = String(name || '').toLowerCase().replace(/ё/g, 'е');
    var m = s.match(/^([^(]*)\(([^)]*)\)(.*)$/);
    if (m) return { primary: clean(m[1] + ' ' + m[3]), paren: clean(m[2]) };
    return { primary: clean(s), paren: '' };
  }

  function sameSeries(a, b) {
    var A = parseName(a), B = parseName(b);
    if (!A.primary || !B.primary) return false;
    if (A.primary === B.primary) {
      // «Глюкоза (натощак)» и «Глюкоза (после нагрузки)» — разные серии,
      // скобка здесь уточняет условие, а не расшифровывает название.
      if (A.paren && B.paren && A.paren !== B.paren) return false;
      return true;
    }
    return A.primary === B.paren || B.primary === A.paren;
  }

  // Строгое число: иначе «контроль через 3 месяца» превратится в точку.
  function numOf(v) {
    var m = String(v).trim().replace(',', '.').match(/^[<>≤≥~]?\s*(-?\d+(?:\.\d+)?)$/);
    return m ? parseFloat(m[1]) : null;
  }

  function series(refName) {
    var pts = [];
    myDocs().forEach(function (d) {
      if (!isDate(d.date)) return;
      (d.indicators || []).forEach(function (i) {
        if (!sameSeries(i.name, refName)) return;
        var v = numOf(i.value);
        if (v === null) return;
        pts.push({ date: d.date, value: v, unit: i.unit, norm: i.norm, name: i.name });
      });
    });
    return pts.sort(function (a, b) { return D(a.date) - D(b.date); });
  }

  function indRow(ind) {
    var pts = series(ind.name);
    var isText = numOf(ind.value) === null;
    return '<div class="ind" data-ind="' + ind.id + '">' +
      '<div class="ind-main">' +
        '<div class="ind-name">' + esc(ind.name) + '</div>' +
        (ind.norm ? '<div class="ind-norm">норма ' + esc(ind.norm) + ' ' + esc(ind.unit) + '</div>' : '') +
        (isText ? '<div class="ind-text f-' + ind.flag + '">' + esc(ind.value) + '</div>' : '') +
        '<div class="ind-norm">' + badge(ind.system) + '</div>' +
      '</div>' +
      (isText ? '' :
        '<div class="ind-right">' +
          '<div class="ind-value f-' + ind.flag + '">' + esc(ind.value) + ' ' + esc(ind.unit) + '</div>' +
          (pts.length > 1 ? '<button class="ind-hist" type="button" data-hist="' + esc(ind.name) + '">' +
            I.history + ' Динамика · ' + pts.length + '</button>' : '') +
        '</div>') +
      '<button class="ind-edit" type="button" data-edit="' + ind.id + '" aria-label="Редактировать">' + I.pencil + '</button>' +
    '</div>';
  }

  function indForm(ind) {
    return '<div class="ind-form" data-form="' + ind.id + '">' +
      '<div class="grid">' +
        '<label class="field span2"><span class="label">Показатель</span><input data-f="name" value="' + esc(ind.name) + '"></label>' +
        '<label class="field"><span class="label">Значение</span><input data-f="value" value="' + esc(ind.value) + '"></label>' +
        '<label class="field"><span class="label">Единицы</span><input data-f="unit" value="' + esc(ind.unit) + '"></label>' +
        '<label class="field"><span class="label">Норма</span><input data-f="norm" value="' + esc(ind.norm) + '"></label>' +
        '<label class="field"><span class="label">Группа</span><input data-f="system" value="' + esc(ind.system) + '"></label>' +
      '</div>' +
      '<div class="row">' +
        '<button class="btn" type="button" data-save="' + ind.id + '">Сохранить</button>' +
        '<button class="btn btn-ghost" type="button" data-cancel="1">Отмена</button>' +
      '</div>' +
    '</div>';
  }

  function renderSheet(editId) {
    var doc = state.docs.filter(function (d) { return d.id === openDocId; })[0];
    if (!doc) return closeSheet();

    $('#sheet-date').textContent = isDate(doc.date) ? ruDate(doc.date) : 'Дата не найдена';
    var p = current();
    var sub = esc(doc.title) + (doc.clinic ? ' · ' + esc(doc.clinic) : '');
    if (p && p.birth && isDate(doc.date)) sub = 'Вам было ' + yearsText(p.birth, doc.date) + ' · ' + sub;
    $('#sheet-sub').innerHTML = sub;

    var rows = (doc.indicators || []).map(function (i) {
      return i.id === editId ? indForm(i) : indRow(i);
    }).join('') || '<p class="muted">Показателей не нашлось</p>';

    var isImg = (doc.mime || '').indexOf('image/') === 0;
    $('#sheet-body').innerHTML =
      '<div><div class="section-label">Показатели</div>' + rows + '</div>' +
      '<div><div class="section-label">Документ</div>' +
        '<div class="doc-card">' +
          '<span class="ficon">' + (isImg ? I.img : I.file) + '</span>' +
          '<span class="fname">' + esc(doc.fileName) +
            (doc.size ? '<span class="fmeta">' + fileSize(doc.size) + '</span>' : '') + '</span>' +
          (doc.blob ? '<button class="act" type="button" data-open-file="1">Открыть</button>' : '') +
          '<button class="act del" type="button" data-ask-del="1">Удалить</button>' +
        '</div>' +
        '<div id="del-zone"></div>' +
      '</div>';
  }

  function openSheet(id) {
    openDocId = id;
    renderSheet(null);
    sheet.classList.add('is-open');
    backdrop.classList.add('is-open');
  }
  function closeSheet() {
    sheet.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    openDocId = null;
  }
  $('#sheet-close').addEventListener('click', closeSheet);
  backdrop.addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if ($('#dup-modal').classList.contains('is-open')) return;   // модалку закрывать только кнопкой
    closeSheet();
  });

  $('#sheet-body').addEventListener('click', function (e) {
    var t = e.target;
    var edit = t.closest('[data-edit]');
    if (edit) return renderSheet(edit.dataset.edit);
    if (t.closest('[data-cancel]')) return renderSheet(null);
    var save = t.closest('[data-save]');
    if (save) return saveIndicator(save.dataset.save);
    var hist = t.closest('[data-hist]');
    if (hist) {
      state.dynFrom = openDocId;      // запоминаем слой до его закрытия
      closeSheet();
      return showDynamics(hist.dataset.hist);
    }
    if (t.closest('[data-open-file]')) return openFile();
    if (t.closest('[data-ask-del]')) return askDelete();
    if (t.closest('[data-del-yes]')) return doDelete();
    if (t.closest('[data-del-no]')) { $('#del-zone').innerHTML = ''; return; }
  });

  function saveIndicator(indId) {
    var doc = state.docs.filter(function (d) { return d.id === openDocId; })[0];
    if (!doc) return;
    var form = document.querySelector('[data-form="' + indId + '"]');
    var vals = {};
    form.querySelectorAll('[data-f]').forEach(function (i) { vals[i.dataset.f] = i.value.trim(); });
    if (!vals.name || !vals.value) return toast('Название и значение не могут быть пустыми');

    var ind = doc.indicators.filter(function (i) { return i.id === indId; })[0];
    ind.name = vals.name; ind.value = vals.value; ind.unit = vals.unit;
    ind.norm = vals.norm; ind.system = vals.system || 'Разное';
    ind.edited = true;

    DB.put(doc).then(function () {
      renderSheet(null); renderFilterUI(); renderTimeline();
      toast('Показатель исправлен');
    });
  }

  function openFile() {
    var doc = state.docs.filter(function (d) { return d.id === openDocId; })[0];
    if (!doc || !doc.blob) return;
    var url = URL.createObjectURL(doc.blob);
    window.open(url, '_blank');
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function askDelete() {
    var doc = state.docs.filter(function (d) { return d.id === openDocId; })[0];
    if (!doc) return;
    var n = (doc.indicators || []).length;
    $('#del-zone').innerHTML = '<div class="confirm" style="margin-top:var(--space-3)">' +
      '<p>Удалить «' + esc(doc.fileName) + '»? Вместе с ним исчезнут ' + n + ' ' +
      plural(n, 'показатель', 'показателя', 'показателей') + ', извлечённые из этого файла. Отменить будет нельзя.</p>' +
      '<div class="row">' +
        '<button class="btn btn-danger" type="button" data-del-yes="1">Удалить</button>' +
        '<button class="btn btn-ghost" type="button" data-del-no="1">Оставить</button>' +
      '</div></div>';
  }

  function doDelete() {
    var id = openDocId;
    DB.remove(id).then(function () {
      state.docs = state.docs.filter(function (d) { return d.id !== id; });
      closeSheet(); renderFilterUI(); renderTimeline(); renderProfileBtn();
      toast('Документ и его показатели удалены');
    });
  }

  // ─── динамика ──────────────────────────────────────────────────────
  function showDynamics(name) {
    var pts = series(name);
    $('#dyn-title').textContent = pts.length ? pts[pts.length - 1].name : name;

    if (pts.length < 2) {
      $('#dyn-body').innerHTML = '<p class="muted">Нужно хотя бы два измерения, чтобы построить график.</p>';
      return go('dynamics');
    }

    var unit = pts[pts.length - 1].unit || '';
    var units = {};
    pts.forEach(function (p) { if (p.unit) units[p.unit] = 1; });
    var mixed = Object.keys(units).length > 1;

    var vals = pts.map(function (p) { return p.value; });
    var norm = parseNorm(pts[pts.length - 1].norm);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (norm) { lo = Math.min(lo, norm[0]); hi = Math.max(hi, norm[1]); }
    var pad = (hi - lo) * 0.25 || Math.abs(hi * 0.15) || 1;
    lo -= pad; hi += pad;

    var W = 320, H = 210, L = 22, R = 300, T = 40, B = 168;
    var x = function (i) { return L + (R - L) * i / (pts.length - 1); };
    var y = function (v) { return B - (B - T) * (v - lo) / (hi - lo || 1); };

    var svg = '';
    if (norm) {
      var yTop = y(norm[1]), yBot = y(norm[0]);
      svg += '<rect x="' + L + '" y="' + yTop.toFixed(1) + '" width="' + (R - L) +
        '" height="' + Math.max(1, yBot - yTop).toFixed(1) + '" fill="var(--ok)" opacity="0.15"/>';
    }
    svg += '<line x1="' + L + '" y1="' + (B + 6) + '" x2="' + R + '" y2="' + (B + 6) + '" stroke="var(--border)" stroke-width="1"/>';
    svg += '<polyline fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="' +
      pts.map(function (p, i) { return x(i).toFixed(1) + ',' + y(p.value).toFixed(1); }).join(' ') + '"/>';

    pts.forEach(function (p, i) {
      var px = x(i), py = y(p.value);
      var out = norm && (p.value < norm[0] || p.value > norm[1]);
      svg += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="5" fill="' +
        (out ? 'var(--danger)' : 'var(--primary)') + '"/>';
      svg += '<text x="' + px.toFixed(1) + '" y="' + (py - 12).toFixed(1) +
        '" text-anchor="middle" font-size="12" font-weight="700" fill="var(--fg)">' +
        String(p.value).replace('.', ',') + '</text>';
      svg += '<text x="' + px.toFixed(1) + '" y="' + (B + 22) +
        '" text-anchor="middle" font-size="9" fill="var(--muted-fg)">' +
        MONTHS_SHORT[D(p.date).getMonth()] + ' ' + D(p.date).getFullYear() + '</text>';
    });

    var first = pts[0], lastP = pts[pts.length - 1];
    var delta = lastP.value - first.value;
    var word = delta > 0 ? 'вырос' : (delta < 0 ? 'снизился' : 'не изменился');
    var seenNames = {};
    pts.forEach(function (p) { seenNames[p.name] = 1; });
    var variants = Object.keys(seenNames);

    $('#dyn-body').innerHTML =
      '<p class="muted">' + pts.length + ' ' + plural(pts.length, 'измерение', 'измерения', 'измерений') +
        ' из ваших документов. Значения подписаны на линии.</p>' +
      '<div class="chart-card"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="График показателя ' + esc(name) + '">' +
        svg + '</svg>' +
        (norm ? '<div class="norm-legend"><span class="swatch"></span> Норма: ' + esc(lastP.norm) + ' ' + esc(unit) + '</div>' : '') +
      '</div>' +
      '<div class="card stack-sm"><div class="section-label">Что изменилось</div>' +
        '<p style="font-size:var(--text-sm)">С ' + ruDate(first.date) + ' по ' + ruDate(lastP.date) +
        ' показатель ' + word +
        (delta ? ' с ' + String(first.value).replace('.', ',') + ' до ' + String(lastP.value).replace('.', ',') +
          ' ' + esc(unit) : '') + '.</p>' +
        (variants.length > 1
          ? '<p class="muted" style="font-size:11px">Собрано из разных написаний: ' +
            variants.map(esc).join(', ') + '</p>' : '') +
        (mixed
          ? '<p class="error" style="font-size:11px">В документах разные единицы (' +
            Object.keys(units).map(esc).join(', ') + ') — сверьте, сопоставимы ли значения.</p>' : '') +
      '</div>';

    go('dynamics');
  }

  function parseNorm(s) {
    if (!s) return null;
    var m = String(s).replace(/,/g, '.').match(/(-?\d+(?:\.\d+)?)\s*[–—\-]\s*(-?\d+(?:\.\d+)?)/);
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
  }

  // ─── профиль ───────────────────────────────────────────────────────
  function profileRow(p, deletable) {
    var icon = p.sex === 'male' ? I.man : (p.sex === 'female' ? I.woman : I.person);
    var n = state.docs.filter(function (d) { return d.profileId === p.id; }).length;
    // Кнопка внутри кнопки — невалидная разметка, поэтому строка это
    // контейнер с двумя отдельными кнопками: выбрать и удалить.
    return '<div class="profile-row' + (p.id === state.currentId ? ' is-current' : '') + '">' +
      '<button class="profile-pick" type="button" data-profile="' + p.id + '">' +
        '<span class="ava-sm">' + icon + '</span>' +
        '<span class="pmeta"><strong>' + esc(p.name || 'Без имени') + '</strong>' +
          '<span>' + (p.birth ? toRu(p.birth) + ' · ' : '') + n + ' ' + plain(n) + '</span></span>' +
        (p.id === state.currentId ? '<span class="badge">текущий</span>' : '') +
      '</button>' +
      (deletable && state.profiles.length > 1
        ? '<button class="profile-del" type="button" data-delprofile="' + p.id + '" ' +
          'aria-label="Удалить профиль ' + esc(p.name || '') + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg></button>'
        : '') +
    '</div>';
  }

  function renderProfile() {
    var p = current();
    var ds = dated();
    var icon = p && p.sex === 'male' ? I.man : (p && p.sex === 'female' ? I.woman : I.person);
    var indCount = myDocs().reduce(function (n, d) { return n + (d.indicators || []).length; }, 0);

    $('#profile-body').innerHTML =
      '<div class="profile-hero"><span class="ava-lg">' + icon + '</span>' +
        '<div style="text-align:center">' +
          '<h2 style="font-size:var(--text-lg)">' + esc((p && p.name) || 'Имя не найдено') + '</h2>' +
          '<p class="muted">' + (myDocs().length
            ? 'Профиль заполнен из ваших документов'
            : 'Документов пока нет — загрузите первые') + '</p>' +
        '</div></div>' +
      '<div id="pr-edit-zone"></div>' +
      '<div class="card"><dl style="margin:0">' +
        '<div class="kv"><dt>Дата рождения</dt><dd>' + (p && p.birth ? ruDate(p.birth) : '—') + '</dd></div>' +
        '<div class="kv"><dt>Возраст</dt><dd>' + (p && p.birth ? yearsText(p.birth, new Date()) : '—') + '</dd></div>' +
        '<div class="kv"><dt>Документов</dt><dd>' + myDocs().length + '</dd></div>' +
        '<div class="kv"><dt>Показателей</dt><dd>' + indCount + '</dd></div>' +
        '<div class="kv"><dt>История с</dt><dd>' + (ds.length ? ruDate(ds[ds.length - 1].date) : '—') + '</dd></div>' +
      '</dl></div>' +
      '<button class="btn btn-ghost" type="button" id="pr-editme">Изменить мои данные</button>' +
      '<div class="stack-sm">' +
        '<div class="section-label">Профили в аккаунте</div>' +
        state.profiles.map(function (x) { return profileRow(x, true); }).join('') +
        // Подтверждение рисуется здесь, а не в общей зоне наверху: оттуда
        // оно оказывалось выше видимой области и тап по корзине выглядел
        // как будто кнопка мёртвая.
        '<div id="pr-del-zone"></div>' +
        '<button class="btn btn-ghost" type="button" id="pr-add">Добавить профиль</button>' +
        '<p class="muted" style="font-size:11px">Отдельная история для родственника или ребёнка — ' + PRICE + ' ₽ разово.</p>' +
      '</div>' +
      '<div class="card stack-sm"><div class="section-label">Группы показателей</div>' +
        (allSystems().length
          ? '<div style="display:flex;flex-wrap:wrap;gap:6px">' + allSystems().map(function (s) { return badge(s.name); }).join('') + '</div>'
          : '<p class="muted">Пока пусто</p>') +
      '</div>' +
      accountCard();
  }

  // Пароль ставится при регистрации; пока его нет, менять нечего.
  function accountCard() {
    if (!Auth.available || !Auth.exists()) return '';
    return '<div class="card stack-sm" id="account-card">' +
      '<div class="section-label">Аккаунт</div>' +
      '<p class="muted" style="font-size:var(--text-sm)">Вход по почте <b>' + esc(Auth.email()) + '</b></p>' +
      '<div id="acc-zone"></div>' +
      '<button class="btn" type="button" id="pr-logout">Выйти</button>' +
      '<button class="btn btn-ghost" type="button" id="pr-pass">Изменить пароль</button>' +
      '<button class="btn btn-ghost is-danger" type="button" id="pr-wipe">Удалить аккаунт</button>' +
    '</div>';
  }

  function meForm() {
    var p = current() || {};
    return '<div class="card stack" style="background:var(--muted)">' +
      '<div class="section-label">Мои данные</div>' +
      '<label class="field"><span class="label">Фамилия, имя, отчество</span>' +
        '<input type="text" id="me-name" value="' + esc(p.name || '') + '" autocomplete="name"></label>' +
      '<label class="field"><span class="label">Дата рождения</span>' +
        '<input type="text" id="me-birth" value="' + esc(toRu(p.birth) || '') + '" placeholder="ДД.ММ.ГГГГ" inputmode="numeric" data-mask="date" maxlength="10"></label>' +
      '<label class="field"><span class="label">Пол</span>' +
        '<select id="me-sex">' +
          '<option value="unknown"' + (p.sex === 'female' || p.sex === 'male' ? '' : ' selected') + '>не указан</option>' +
          '<option value="female"' + (p.sex === 'female' ? ' selected' : '') + '>женский</option>' +
          '<option value="male"' + (p.sex === 'male' ? ' selected' : '') + '>мужской</option>' +
        '</select></label>' +
      '<p class="muted" style="font-size:11px">Дата рождения — нижний конец шкалы таймлайна, от неё считается ваш возраст в каждом документе.</p>' +
      '<div class="row" style="display:flex;gap:var(--space-2)">' +
        '<button class="btn" type="button" id="me-save">Сохранить</button>' +
        '<button class="btn btn-ghost" type="button" id="me-cancel">Отмена</button>' +
      '</div></div>';
  }

  function saveMe() {
    var p = current();
    if (!p) return;
    var name = $('#me-name').value.trim();
    var birthRu = $('#me-birth').value.trim();
    var birth = fromRu(birthRu);

    var bad = validateIdentity(name, birthRu, birth);
    if (bad) return toast(bad);

    p.name = name;
    p.birth = birth;
    p.sex = $('#me-sex').value;
    saveProfiles().then(function () {
      $('#pr-edit-zone').innerHTML = '';
      renderProfile();
      renderProfileBtn();
      renderTimeline();
      toast('Данные обновлены');
    });
  }

  // Одно правило на регистрацию и на правку профиля: ФИО целиком и дата
  // рождения. Без них шкала таймлайна не строится, а чужой документ
  // не с чем сравнить.
  function validateIdentity(name, birthRu, birthIso) {
    var words = name.split(/\s+/).filter(Boolean);
    if (words.length < 2) return 'Впишите ФИО полностью — фамилию, имя и отчество';
    if (!birthRu) return 'Впишите дату рождения — без неё не построить шкалу';
    if (!birthIso) return 'Дата рождения — в виде 24.07.1988';
    var y = +birthIso.slice(0, 4);
    if (y < 1900 || D(birthIso) > new Date()) return 'Проверьте дату рождения';
    return '';
  }

  function passForm() {
    return '<div class="card stack" style="background:var(--muted)">' +
      '<label class="field"><span class="label">Текущий пароль</span>' +
        '<input type="password" id="cp-old" autocomplete="current-password"></label>' +
      '<label class="field"><span class="label">Новый пароль — не короче ' + Auth.MIN_LEN + ' символов</span>' +
        '<input type="password" id="cp-new" autocomplete="new-password"></label>' +
      '<label class="field"><span class="label">Повторить новый пароль</span>' +
        '<input type="password" id="cp-new2" autocomplete="new-password"></label>' +
      '<div class="row" style="display:flex;gap:var(--space-2)">' +
        '<button class="btn" type="button" id="cp-save">Сохранить пароль</button>' +
        '<button class="btn btn-ghost" type="button" id="cp-cancel">Отмена</button>' +
      '</div></div>';
  }

  function askDeleteProfile(id) {
    if (state.profiles.length < 2) {
      return toast('Это единственный профиль — его убирает «Удалить аккаунт»');
    }
    var p = state.profiles.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var docs = state.docs.filter(function (d) { return d.profileId === id; });
    var inds = docs.reduce(function (n, d) { return n + (d.indicators || []).length; }, 0);

    var zone = $('#pr-del-zone');
    zone.innerHTML = '<div class="confirm" style="margin-top:var(--space-2)">' +
      '<p>Удалить профиль «' + esc(p.name || 'Без имени') + '»? Вместе с ним исчезнут ' +
      docs.length + ' ' + plain(docs.length) + ' и ' + inds + ' ' +
      plural(inds, 'показатель', 'показателя', 'показателей') +
      '. Остальные профили не тронем. Отменить будет нельзя.</p>' +
      '<div class="row">' +
        '<button class="btn btn-danger" type="button" data-dp-yes="' + id + '">Удалить профиль</button>' +
        '<button class="btn btn-ghost" type="button" id="dp-no">Оставить</button>' +
      '</div></div>';
    if (zone.scrollIntoView) zone.scrollIntoView({ block: 'nearest' });
  }

  function deleteProfile(id) {
    var docs = state.docs.filter(function (d) { return d.profileId === id; });
    Promise.all(docs.map(function (d) { return DB.remove(d.id); }))
      .then(function () {
        state.docs = state.docs.filter(function (d) { return d.profileId !== id; });
        state.profiles = state.profiles.filter(function (p) { return p.id !== id; });
        // Удалили тот, что был открыт — переключаемся на первый оставшийся
        if (state.currentId === id) state.currentId = state.profiles[0].id;
        state.applied.clear(); state.pending.clear();
        return saveProfiles();
      })
      .then(function () {
        renderProfile(); renderProfileBtn(); renderFilterUI(); renderTimeline();
        toast('Профиль удалён');
      })
      .catch(function (err) { console.error(err); toast('Не удалось удалить профиль'); });
  }

  function wipeForm() {
    return '<div class="confirm">' +
      '<p>Удалить аккаунт целиком? Исчезнут все документы (' + state.docs.length + '), ' +
      'все профили (' + state.profiles.length + ') и пароль. Восстановить будет нечем.</p>' +
      '<div class="row">' +
        '<button class="btn btn-danger" type="button" id="wp-yes">Удалить всё</button>' +
        '<button class="btn btn-ghost" type="button" id="wp-no">Отмена</button>' +
      '</div></div>';
  }

  $('#profile-body').addEventListener('click', function (e) {
    var t = e.target;

    if (t.closest('#pr-add')) {
      state.foreign = null;
      state.addProfile = true;
      return go('foreign');
    }

    if (t.closest('#pr-editme')) { $('#pr-edit-zone').innerHTML = meForm(); return; }
    if (t.closest('#me-cancel')) { $('#pr-edit-zone').innerHTML = ''; return; }
    if (t.closest('#me-save')) return saveMe();

    var del = t.closest('[data-delprofile]');
    if (del) return askDeleteProfile(del.dataset.delprofile);
    if (t.closest('#dp-no')) { $('#pr-del-zone').innerHTML = ''; return; }
    var yes = t.closest('[data-dp-yes]');
    if (yes) return deleteProfile(yes.dataset.dpYes);

    if (t.closest('#pr-logout')) return logout();
    if (t.closest('#pr-pass')) { $('#acc-zone').innerHTML = passForm(); return; }
    if (t.closest('#cp-cancel')) { $('#acc-zone').innerHTML = ''; return; }
    if (t.closest('#pr-wipe')) { $('#acc-zone').innerHTML = wipeForm(); return; }
    if (t.closest('#wp-no')) { $('#acc-zone').innerHTML = ''; return; }

    if (t.closest('#cp-save')) return changePassword();
    if (t.closest('#wp-yes')) return wipeAccount();
  });

  function changePassword() {
    var oldp = $('#cp-old').value;
    var np = $('#cp-new').value, np2 = $('#cp-new2').value;
    if (np.length < Auth.MIN_LEN) return toast('Новый пароль — не короче ' + Auth.MIN_LEN + ' символов');
    if (np !== np2) return toast('Новые пароли не совпадают');

    var btn = $('#cp-save');
    btn.disabled = true;
    Auth.verify(Auth.email(), oldp).then(function (ok) {
      if (!ok) { btn.disabled = false; return toast('Текущий пароль не подошёл'); }
      return Auth.create(Auth.email(), np).then(function () {
        $('#acc-zone').innerHTML = '';
        toast('Пароль изменён');
      });
    }).catch(function (err) {
      btn.disabled = false;
      console.error(err);
      toast('Не удалось изменить пароль');
    });
  }

  function wipeAccount() {
    DB.clear()
      .then(function () {
        return Promise.all([
          DB.setMeta('profiles', []), DB.setMeta('currentId', null), Auth.clear()
        ]);
      })
      .then(function () {
        state.docs = []; state.profiles = []; state.currentId = null;
        state.applied.clear(); state.pending.clear();
        state.signupDocs = []; state.signupDraft = null; state.foreign = null;
        renderUpload(); renderProfileBtn();
        go('upload');
        toast('Аккаунт удалён');
      })
      .catch(function (err) { console.error(err); toast('Не удалось удалить аккаунт'); });
  }

  document.addEventListener('click', function (e) {
    var row = e.target.closest('[data-profile]');
    if (!row) return;
    if (row.dataset.profile === state.currentId) return;
    state.currentId = row.dataset.profile;
    state.applied.clear(); state.pending.clear();
    saveProfiles().then(function () {
      renderProfile(); renderProfileBtn();
      toast('Профиль переключён');
    });
  });

  // ─── настройки ─────────────────────────────────────────────────────
  function renderSettings() {
    var k = apiKey();
    $('#api-key').value = k;
    $('#clear-key').hidden = !k;
    var sel = $('#model-select');
    if (!sel.options.length) {
      sel.innerHTML = Extract.MODELS.map(function (m) {
        return '<option value="' + esc(m.id) + '">' + esc(m.label) + '</option>';
      }).join('');
    }
    sel.value = model();
    $('#key-state').textContent = k
      ? 'Ключ сохранён. Распознавание работает через ' + model() + '.'
      : 'Без ключа документы распознать нельзя — можно посмотреть демо-историю.';
    var indCount = state.docs.reduce(function (n, d) { return n + (d.indicators || []).length; }, 0);
    renderAuthCard();
    $('#storage-note').textContent = 'Сейчас в браузере: ' + state.docs.length + ' ' + plain(state.docs.length) +
      ', ' + indCount + ' ' + plural(indCount, 'показатель', 'показателя', 'показателей') +
      (state.profiles.length > 1 ? ', профилей: ' + state.profiles.length : '') + '. Документы никуда не уходят.';
  }

  function renderAuthCard() {
    var has = Auth.exists();
    $('#auth-card').hidden = !Auth.available;
    $('#auth-set').hidden = has;
    $('#logout').hidden = !has;
    if (!has) {
      var p = current();
      $('#ap-email').value = $('#ap-email').value || (p && p.email) || '';
    }
    $('#auth-state').textContent = has
      ? 'Вы вошли как ' + Auth.email() + '. Пароль спросят снова после выхода.'
      : 'Пароля нет: история открывается сразу, любому, кто взял телефон. Поставьте пароль — он проверяется в этом браузере и никуда не уходит.';
  }

  $('#ap-save').addEventListener('click', function () {
    var email = $('#ap-email').value.trim();
    var pass = $('#ap-pass').value;
    if (!isEmail(email)) return toast('Впишите почту — по ней вы будете входить');
    if (pass.length < Auth.MIN_LEN) return toast('Пароль — не короче ' + Auth.MIN_LEN + ' символов');
    var btn = this;
    btn.disabled = true;
    Auth.create(email, pass)
      .then(function () {
        btn.disabled = false;
        $('#ap-pass').value = '';
        renderAuthCard();
        toast('Пароль поставлен');
      })
      .catch(function (err) {
        btn.disabled = false;
        console.error(err);
        toast('Не удалось сохранить пароль');
      });
  });

  function logout() {
    Auth.lock();
    closeSheet();
    go('login');
    toast('Вы вышли');
  }
  $('#logout').addEventListener('click', logout);

  $('#save-key').addEventListener('click', function () {
    var v = $('#api-key').value.trim();
    if (!v) return toast('Вставьте ключ');
    if (v.indexOf('sk-') !== 0) return toast('Ключ OpenAI начинается с sk-');
    try {
      localStorage.setItem(KEY_STORE, v);
      localStorage.setItem(MODEL_STORE, $('#model-select').value);
    } catch (e) { return toast('Браузер не даёт сохранить ключ'); }
    renderSettings(); renderUpload();
    toast('Сохранено');
  });
  $('#model-select').addEventListener('change', function () {
    try { localStorage.setItem(MODEL_STORE, this.value); } catch (e) { /* пусто */ }
    renderSettings(); renderUpload();
  });
  $('#clear-key').addEventListener('click', function () {
    try { localStorage.removeItem(KEY_STORE); } catch (e) { /* пусто */ }
    renderSettings(); renderUpload();
    toast('Ключ удалён');
  });

  $('#load-demo').addEventListener('click', function () {
    Extract.resetDemo();
    var fakes = [
      'crc_2019-05-12.pdf', 'endo_2021-11-03.pdf', 'xray_2023-02-14.jpg',
      'crc_2024-07-20.pdf', 'gastro_2026-03-05.pdf'
    ].map(function (n) {
      return { file: { name: n, type: n.slice(-3) === 'jpg' ? 'image/jpeg' : 'application/pdf', size: 0 }, replaces: null };
    });
    startRecognition(fakes, function (f) { return Extract.demo(f); });
  });

  $('#wipe').addEventListener('click', function () {
    if (!state.docs.length) return toast('Удалять нечего');
    if (!confirm('Удалить все ' + state.docs.length + ' документов и все извлечённые показатели? Отменить будет нельзя.')) return;
    DB.clear()
      .then(function () { return Promise.all([DB.setMeta('profiles', []), DB.setMeta('currentId', null)]); })
      .then(function () {
        state.docs = []; state.profiles = []; state.currentId = null;
        state.applied.clear(); state.pending.clear();
        renderSettings(); renderUpload(); renderTimeline(); renderFilterUI();
        toast('Все документы удалены');
      });
  });

  // ─── старт ─────────────────────────────────────────────────────────
  // Экран решается после того, как данные подняты: замок стоит перед
  // историей, а не перед пустым приложением. Пока пароль не введён,
  // ни один экран с документами не открыт — их просто нечем показать.
  function boot() {
    renderUpload();
    renderProfileBtn();
    if (Auth.exists() && !Auth.unlocked()) return go('login');
    // Чтение из IndexedDB асинхронное: если человек успел выбрать файлы
    // раньше, чем оно закончилось, нельзя выбрасывать его с экрана разбора.
    if (state.busy) return;
    go(myDocs().length ? 'timeline' : 'upload');
  }

  // ─── экран запуска ─────────────────────────────────────────────────
  // Заставка держит первый кадр, пока данные читаются из IndexedDB.
  // Дальше уходит сама: два прохода анимации это 3,6 с, ждём 3,9 с.
  // Пропустить можно тапом в любом месте — на второй раз заставка надоедает.
  var SPLASH_MS = 3900;
  var splashDone = false;

  function leaveSplash() {
    if (splashDone) return;
    splashDone = true;
    if (state.ready) boot();          // данные уже прочитаны — уходим сразу
    else state.splashOver = true;     // иначе уйдём, когда чтение закончится
  }

  function startSplash() {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var wait = reduced ? 900 : SPLASH_MS;
    setTimeout(function () {
      var st = $('#splash-status');
      if (st) { st.textContent = 'Приложение готово к работе'; st.classList.add('is-ready'); }
      setTimeout(leaveSplash, 450);
    }, wait);
  }

  $('#splash-skip').addEventListener('click', leaveSplash);
  document.querySelector('[data-screen="splash"]').addEventListener('click', leaveSplash);

  Promise.all([DB.all(), DB.getMeta('profiles'), DB.getMeta('currentId'), Auth.load()])
    .then(function (r) {
      state.docs = r[0] || [];
      state.profiles = r[1] || [];
      state.currentId = r[2] || (state.profiles[0] && state.profiles[0].id) || null;

      // Данные, записанные до появления профилей, остались бы без владельца.
      var orphans = state.docs.filter(function (d) { return !d.profileId; });
      if (orphans.length && !state.profiles.length) {
        var pat = orphans.map(function (d) { return d.patient || {}; })
          .filter(function (p) { return p.name || p.birthDate; })[0] || {};
        var p = { id: DB.uid(), name: pat.name || '', birth: pat.birthDate || '', sex: pat.sex || 'unknown', email: '' };
        state.profiles = [p];
        state.currentId = p.id;
      }
      if (orphans.length && state.currentId) {
        orphans.forEach(function (d) { d.profileId = state.currentId; });
        return Promise.all(orphans.map(function (d) { return DB.put(d); }))
          .then(saveProfiles);
      }
    })
    .then(function () {
      state.ready = true;
      if (splashDone || state.splashOver) boot();
    })
    .catch(function (err) {
      console.error(err);
      state.ready = true;
      toast('Не удалось открыть хранилище браузера');
      renderUpload();
      if (splashDone || state.splashOver) go('upload');
    });

  // Марка в левом верхнем углу каждого экрана. Вставляем скриптом:
  // руками это дюжина одинаковых правок, которые разъедутся при первой же
  // новой секции.
  document.querySelectorAll('.topbar').forEach(function (bar) {
    var h1 = bar.querySelector('h1');
    if (!h1 || bar.querySelector('.brand')) return;
    var wrap = document.createElement('div');
    wrap.className = 'tb-title';
    bar.insertBefore(wrap, h1);
    var b = document.createElement('span');
    b.className = 'brand';
    b.textContent = 'MedTimeline';
    wrap.appendChild(b);
    wrap.appendChild(h1);
  });

  startSplash();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* офлайн — не критично */ });
    });
  }
})();
