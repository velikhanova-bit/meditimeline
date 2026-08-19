/**
 * Вход по почте и паролю — без сервера.
 *
 * Сервера у приложения нет, поэтому проверять пароль негде, кроме браузера.
 * Храним не пароль, а PBKDF2-SHA256 от него: 210 000 итераций и случайная
 * соль на пользователя. Если кто-то доберётся до IndexedDB, он получит хэш,
 * а не пароль — тот же пароль от почты не утечёт.
 *
 * Что это даёт: чужой человек, взявший телефон, не откроет историю болезней.
 * Чего не даёт: шифрования. Сами документы лежат в IndexedDB как есть, и
 * через DevTools их видно. Настоящая защита данных — шифрование ключом из
 * пароля, но тогда забытый пароль означает потерю истории безвозвратно.
 *
 * Пароль восстановить нельзя: писать некому и сравнивать не с чем.
 */
(function (global) {
  'use strict';

  var META = 'auth';                  // запись в сторе meta
  var SESSION = 'mt_unlocked';        // отметка «этот браузер уже впустили»
  var ITERATIONS = 210000;            // OWASP-минимум для PBKDF2-SHA256 на 2024
  var MIN_LEN = 8;

  var subtle = (global.crypto && global.crypto.subtle) || null;
  var record = null;                  // кэш записи из meta
  var loaded = false;

  function bytesToB64(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function b64ToBytes(s) {
    var bin = atob(s), b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }
  function normEmail(s) { return String(s || '').trim().toLowerCase(); }

  function derive(password, salt, iterations) {
    var raw = new TextEncoder().encode(password);
    return subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return subtle.deriveBits(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          key, 256
        );
      })
      .then(bytesToB64);
  }

  function session(on) {
    try {
      if (on) global.localStorage.setItem(SESSION, '1');
      else global.localStorage.removeItem(SESSION);
    } catch (e) { /* приватный режим — просто спросим пароль ещё раз */ }
  }

  var Auth = {
    // Без Web Crypto (http:// не на localhost, древний браузер) хэшировать
    // нечем. Тогда замок не ставим вовсе, но и не притворяемся, что он есть.
    available: !!subtle,
    MIN_LEN: MIN_LEN,

    load: function () {
      if (loaded) return Promise.resolve(record);
      return DB.getMeta(META).then(function (r) {
        record = r || null;
        loaded = true;
        return record;
      });
    },

    exists: function () { return !!record; },
    email: function () { return record ? record.email : ''; },

    unlocked: function () {
      if (!record) return true;                    // пароля нет — нечего отпирать
      try { return global.localStorage.getItem(SESSION) === '1'; } catch (e) { return false; }
    },

    // Пароль ставится при регистрации или позже в настройках.
    create: function (email, password) {
      if (!Auth.available) return Promise.reject(new Error('no-crypto'));
      var salt = global.crypto.getRandomValues(new Uint8Array(16));
      return derive(password, salt, ITERATIONS).then(function (hash) {
        record = {
          email: normEmail(email),
          salt: bytesToB64(salt),
          hash: hash,
          iterations: ITERATIONS
        };
        loaded = true;
        session(true);
        return DB.setMeta(META, record);
      });
    },

    // Почта сверяется вместе с паролем: так на экране входа видно, что
    // аккаунт в этом браузере один и он привязан к конкретной почте.
    verify: function (email, password) {
      if (!record) return Promise.resolve(true);
      if (normEmail(email) !== record.email) return Promise.resolve(false);
      return derive(password, b64ToBytes(record.salt), record.iterations)
        .then(function (hash) {
          var ok = hash === record.hash;
          if (ok) session(true);
          return ok;
        });
    },

    lock: function () { session(false); },

    clear: function () {
      record = null;
      loaded = true;
      session(false);
      return DB.setMeta(META, null);
    }
  };

  global.Auth = Auth;
})(window);
