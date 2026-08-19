/**
 * Хранилище: IndexedDB.
 *
 * localStorage не подходит: там строки и ~5 МБ на домен, а один скан
 * заключения — это 3 МБ бинарника. В IndexedDB Blob кладётся как есть.
 *
 * Два стора:
 *   docs — документ вместе с исходным файлом и всем, что из него извлёк ИИ
 *   meta — профиль и настройки, по одной записи на ключ
 */
(function (global) {
  'use strict';

  var NAME = 'meditimeline';
  var VERSION = 1;
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('docs')) {
          var s = db.createObjectStore('docs', { keyPath: 'id' });
          s.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var req = fn(t.objectStore(store));
        t.oncomplete = function () { resolve(req && req.result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  var DB = {
    uid: function () {
      // crypto.randomUUID есть не везде (старый Safari) — отсюда запасной путь
      if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
      return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    },

    put: function (doc) { return tx('docs', 'readwrite', function (s) { return s.put(doc); }); },
    get: function (id) { return tx('docs', 'readonly', function (s) { return s.get(id); }); },
    remove: function (id) { return tx('docs', 'readwrite', function (s) { return s.delete(id); }); },
    all: function () { return tx('docs', 'readonly', function (s) { return s.getAll(); }); },
    clear: function () { return tx('docs', 'readwrite', function (s) { return s.clear(); }); },

    setMeta: function (key, value) {
      return tx('meta', 'readwrite', function (s) { return s.put({ key: key, value: value }); });
    },
    getMeta: function (key) {
      return tx('meta', 'readonly', function (s) { return s.get(key); })
        .then(function (r) { return r ? r.value : null; });
    }
  };

  global.DB = DB;
})(window);
