/**
 * Извлечение данных из медицинского документа через OpenAI Responses API.
 *
 * Два пути:
 *   Extract.withAI(file, key, model) — настоящий разбор
 *   Extract.demo(file)               — правдоподобные данные без ключа
 *
 * Почему сырой fetch, а не openai-js: приложение собирается без бандлера
 * (правило харнесса — CDN или стандартная библиотека), SDK в браузер
 * без сборки не заезжает.
 *
 * Ключ живёт в localStorage и уходит прямо из браузера в api.openai.com.
 * CORS там разрешён — проверено живым запросом, отдельного заголовка,
 * как у Anthropic, не требуется. Это ключ самого пользователя и его же
 * браузер — приемлемо. Для ОБЩЕГО ключа так нельзя: он станет виден
 * каждому, кто откроет вкладку. Тогда нужен прокси, см. README.
 */
(function (global) {
  'use strict';

  var API = 'https://api.openai.com/v1/responses';

  var MODELS = [
    { id: 'gpt-5.6-terra', label: 'gpt-5.6-terra — по умолчанию' },
    { id: 'gpt-5.6-luna',  label: 'gpt-5.6-luna — вдесятеро дешевле' },
    { id: 'gpt-5.6-sol',   label: 'gpt-5.6-sol — для тяжёлых сканов' }
  ];
  var DEFAULT_MODEL = 'gpt-5.6-terra';

  // OpenAI при detail:"high" вписывает картинку в 2048×2048 — больше
  // отдавать смысла нет, а запрос и счёт растут.
  var MAX_EDGE = 2048;
  // Предел OpenAI — 50 МБ на файл. base64 раздувает на треть, поэтому
  // отсекаем раньше и понятным текстом.
  var MAX_BYTES = 30 * 1024 * 1024;

  var SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['isMedical', 'date', 'title', 'clinic', 'patient', 'indicators'],
    properties: {
      isMedical: {
        type: 'boolean',
        description: 'Похоже ли это на медицинский документ. false — если это чек, паспорт, случайное фото.'
      },
      date: {
        type: 'string',
        description: 'Дата документа СТРОГО в формате YYYY-MM-DD. Дата забора материала или приёма, НЕ дата печати бланка. Пустая строка, если даты нет.'
      },
      title: {
        type: 'string',
        description: 'Короткое название по-русски: «Общий анализ крови», «Заключение эндокринолога», «Рентген предплечья».'
      },
      clinic: {
        type: 'string',
        description: 'Только название лаборатории или клиники, без адреса и номера лицензии. Пустая строка, если не указана.'
      },
      patient: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'birthDate', 'sex'],
        properties: {
          name: { type: 'string', description: 'ФИО пациента как в документе. Пустая строка, если нет.' },
          birthDate: { type: 'string', description: 'Дата рождения СТРОГО в формате YYYY-MM-DD. Пустая строка, если нет.' },
          sex: { type: 'string', enum: ['female', 'male', 'unknown'] }
        }
      },
      indicators: {
        type: 'array',
        description: 'Все измеримые показатели плюс заключение врача, если оно есть.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'value', 'unit', 'norm', 'flag', 'system'],
          properties: {
            name: { type: 'string', description: 'Название показателя по-русски, коротко и без скобок с расшифровкой: «Гемоглобин», «ТТГ», «Т4 свободный».' },
            value: { type: 'string', description: 'Значение как в документе. Десятичный разделитель — запятая.' },
            unit: { type: 'string', description: 'Единицы измерения. Пустая строка для текстовых заключений.' },
            norm: { type: 'string', description: 'Референсный интервал, например «120–150». Пустая строка, если не указан.' },
            flag: {
              type: 'string',
              enum: ['ok', 'low', 'high', 'attn'],
              description: 'ok — в норме, low — ниже нормы, high — выше нормы, attn — требует внимания или норма неизвестна.'
            },
            system: {
              type: 'string',
              description: 'Система организма по-русски, именительный падеж: «Кровь», «Щитовидная железа», «ЖКТ», «Опорно-двигательная», «Сердце и сосуды», «Почки», «Печень», «Гормоны», «Витамины и железо». Если ничего не подходит — придумай короткое название сам.'
            }
          }
        }
      }
    }
  };

  var SYSTEM_PROMPT = [
    'Ты извлекаешь данные из медицинских документов на русском языке.',
    '',
    'Правила:',
    '— Переноси значения ровно как в документе. Ничего не пересчитывай и не переводи в другие единицы.',
    '— Если показателя нет в документе — не выдумывай его.',
    '— Название показателя приводи к общепринятому короткому виду и БЕЗ скобок с расшифровкой: «ТТГ», а не «ТТГ (тиреотропный гормон)» и не «Тиреотропный гормон (ТТГ)». Один и тот же показатель в разных документах обязан называться одинаково — иначе не построится график динамики.',
    '— Дату бери ту, когда сдан анализ или был приём, а не дату печати бланка.',
    '— Вывод, заключение или рекомендацию врача всегда добавляй отдельным показателем: name «Заключение», value — текст вывода, unit и norm пустые. Делай это и тогда, когда в документе есть числовые показатели.',
    '— Поле system группирует показатели по системам организма. Показатели одного анализа могут попасть в разные системы.',
    '— Незаполненное поле — пустая строка, не «нет данных» и не прочерк.'
  ].join('\n');

  // ─── подготовка файла ──────────────────────────────────────────────

  function toDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);   // OpenAI ждёт именно data:-URL, не голый base64
    });
  }

  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 4 * 1024 * 1024) {
          URL.revokeObjectURL(url);
          return resolve(file);
        }
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { resolve(b || file); }, 'image/jpeg', 0.92);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };
      img.src = url;
    });
  }

  function contentBlock(file) {
    if (file.type === 'application/pdf') {
      return toDataUrl(file).then(function (dataUrl) {
        return { type: 'input_file', filename: file.name || 'document.pdf', file_data: dataUrl };
      });
    }
    return shrinkImage(file).then(toDataUrl).then(function (dataUrl) {
      // detail: 'high' — на 'low' картинка ужимается до 512 px и мелкие
      // цифры в бланке становятся нечитаемыми.
      return { type: 'input_image', image_url: dataUrl, detail: 'high' };
    });
  }

  // ─── вызов OpenAI ──────────────────────────────────────────────────

  function withAI(file, key, model) {
    if (file.size > MAX_BYTES) {
      return Promise.reject(new Error('Файл больше 30 МБ — столько не принимают'));
    }

    return contentBlock(file).then(function (block) {
      return fetch(API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + key
        },
        body: JSON.stringify({
          model: model || DEFAULT_MODEL,
          instructions: SYSTEM_PROMPT,
          max_output_tokens: 8000,
          // Извлечение по готовой схеме — не та задача, где нужны долгие
          // размышления: на 'low' качество то же, а ждать вдвое меньше.
          reasoning: { effort: 'low' },
          input: [{
            role: 'user',
            content: [
              block,
              { type: 'input_text', text: 'Извлеки данные из этого документа. Файл называется «' + (file.name || 'без имени') + '».' }
            ]
          }],
          text: {
            format: { type: 'json_schema', name: 'extraction', strict: true, schema: SCHEMA }
          }
        })
      });
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var msg = t;
          try { msg = JSON.parse(t).error.message; } catch (e) { /* оставляем сырой текст */ }
          throw new Error(explainErr(res.status, msg));
        });
      }
      return res.json();
    }).then(function (data) {
      if (data.status === 'incomplete') {
        var why = (data.incomplete_details || {}).reason;
        throw new Error(why === 'max_output_tokens'
          ? 'В документе слишком много показателей — ответ не поместился'
          : 'Ответ пришёл неполным');
      }

      // output_text есть только в SDK; в сыром ответе его нет.
      // Перед message могут идти служебные элементы, поэтому ищем по типу.
      var msg = (data.output || []).filter(function (o) { return o.type === 'message'; })[0];
      if (!msg || !msg.content || !msg.content.length) throw new Error('Пустой ответ модели');

      var part = msg.content[0];
      if (part.type === 'refusal') throw new Error('Модель отказалась разбирать файл: ' + part.refusal);
      if (part.type !== 'output_text' || !part.text) throw new Error('Неожиданный формат ответа');

      return normalize(JSON.parse(part.text));
    });
  }

  function explainErr(status, msg) {
    if (status === 401) return 'Ключ не подошёл. Проверьте его в настройках.';
    if (status === 403) return 'Ключу не разрешена эта модель. Выберите другую в настройках.';
    if (status === 404) return 'Модель недоступна этому ключу. Выберите другую в настройках.';
    if (status === 429 && /quota|billing/i.test(msg)) return 'На счёте OpenAI закончились средства.';
    if (status === 429) return 'Слишком много запросов подряд. Подождите минуту.';
    if (status === 413) return 'Файл слишком большой.';
    if (status >= 500) return 'Сервис OpenAI временно недоступен.';
    return msg || ('Ошибка ' + status);
  }


  // ─── подсказка по показателю ───────────────────────────────────────
  // Что это, на что влияет и в норме ли конкретно у этого человека.
  // Отдельный короткий запрос: он в разы дешевле разбора документа,
  // и делается только когда человек сам нажал на показатель.
  var EXPLAIN_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['what', 'affects', 'yours', 'status', 'seeDoctor', 'advice'],
    properties: {
      what: {
        type: 'string',
        description: 'Что это за показатель — двумя простыми предложениями, как объяснили бы человеку без медицинского образования. Без латыни и без терминов, которые сами требуют объяснения.'
      },
      affects: {
        type: 'string',
        description: 'На что в самочувствии и работе организма это влияет. Одно-два предложения, конкретно и без запугивания.'
      },
      yours: {
        type: 'string',
        description: 'В норме ли значение именно у этого человека. Начни с прямого ответа: «Ваше значение в норме» или «Ваше значение ниже нормы». Затем поясни, насколько далеко от границы. Если референсный интервал не указан, честно скажи, что сравнить не с чем.'
      },
      status: {
        type: 'string',
        enum: ['ok', 'near', 'out', 'unknown'],
        description: 'ok — уверенно внутри интервала; near — внутри, но ближе десятой доли ширины интервала к границе; out — за границей; unknown — интервал не указан.'
      },
      seeDoctor: {
        type: 'boolean',
        description: 'true, если status равен out, near или unknown.'
      },
      advice: {
        type: 'string',
        description: 'Что сделать дальше, одно предложение. При out или near — прямо посоветовать показать результат врачу и не делать выводов самостоятельно. При ok — что достаточно planового наблюдения.'
      }
    }
  };

  var EXPLAIN_PROMPT = [
    'Ты объясняешь человеку без медицинского образования, что означает показатель в его анализе.',
    '',
    'Правила:',
    '— Простым языком, на «вы», короткими предложениями. Никакой латыни и аббревиатур без расшифровки.',
    '— Не ставь диагноз и не назначай лечение. Ты объясняешь цифру, а не лечишь.',
    '— Судить о норме можно только по референсному интервалу из документа. Если его нет — так и скажи.',
    '— Если значение вышло за интервал или подошло к его границе ближе десятой доли ширины — посоветуй показать результат врачу.',
    '— Не пугай. Отклонение показателя само по себе не диагноз, и об этом стоит сказать прямо.',
    '— Не придумывай причин отклонения: их может быть много, и определяет их врач.'
  ].join('\n');

  function explain(ind, person, key, model) {
    var who = [];
    if (person && person.age) who.push('возраст ' + person.age);
    if (person && person.sex === 'female') who.push('пол женский');
    if (person && person.sex === 'male') who.push('пол мужской');

    var text = 'Показатель: ' + ind.name +
      '\nЗначение: ' + ind.value + (ind.unit ? ' ' + ind.unit : '') +
      '\nРеференсный интервал: ' + (ind.norm ? ind.norm + (ind.unit ? ' ' + ind.unit : '') : 'в документе не указан') +
      (who.length ? '\nПациент: ' + who.join(', ') : '');

    return fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        instructions: EXPLAIN_PROMPT,
        max_output_tokens: 2000,
        reasoning: { effort: 'low' },
        input: [{ role: 'user', content: [{ type: 'input_text', text: text }] }],
        text: { format: { type: 'json_schema', name: 'explanation', strict: true, schema: EXPLAIN_SCHEMA } }
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var msg = t;
          try { msg = JSON.parse(t).error.message; } catch (e) { /* сырой текст */ }
          throw new Error(explainErr(res.status, msg));
        });
      }
      return res.json();
    }).then(function (data) {
      if (data.status === 'incomplete') throw new Error('Ответ пришёл неполным');
      var msg = (data.output || []).filter(function (o) { return o.type === 'message'; })[0];
      if (!msg || !msg.content || !msg.content.length) throw new Error('Пустой ответ модели');
      var part = msg.content[0];
      if (part.type === 'refusal') throw new Error('Модель отказалась объяснять этот показатель');
      if (part.type !== 'output_text' || !part.text) throw new Error('Неожиданный формат ответа');
      return JSON.parse(part.text);
    });
  }

  // ─── демо-режим ────────────────────────────────────────────────────

  var SAMPLES = [
    { date: '2019-05-12', title: 'Общий анализ крови', clinic: 'Инвитро',
      ind: [
        ['Гемоглобин', '118', 'г/л', '120–150', 'low', 'Кровь'],
        ['Эритроциты', '4,1', '×10¹²/л', '3,8–5,1', 'ok', 'Кровь'],
        ['Лейкоциты', '6,4', '×10⁹/л', '4,0–9,0', 'ok', 'Кровь'],
        ['Ферритин', '14', 'мкг/л', '15–150', 'low', 'Витамины и железо']
      ] },
    { date: '2021-11-03', title: 'Заключение эндокринолога', clinic: 'Скандинавия',
      ind: [
        ['ТТГ', '3,8', 'мЕд/л', '0,4–4,0', 'ok', 'Щитовидная железа'],
        ['Т4 свободный', '14,2', 'пмоль/л', '9,0–22,0', 'ok', 'Щитовидная железа'],
        ['Витамин D', '18', 'нг/мл', '30–100', 'low', 'Витамины и железо']
      ] },
    { date: '2023-02-14', title: 'Рентген предплечья', clinic: 'ГКБ №1',
      ind: [
        ['Заключение', 'Перелом лучевой кости без смещения', '', '', 'attn', 'Опорно-двигательная']
      ] },
    { date: '2024-07-20', title: 'Общий анализ крови', clinic: 'Инвитро',
      ind: [
        ['Гемоглобин', '132', 'г/л', '120–150', 'ok', 'Кровь'],
        ['Эритроциты', '4,4', '×10¹²/л', '3,8–5,1', 'ok', 'Кровь'],
        ['Лейкоциты', '5,8', '×10⁹/л', '4,0–9,0', 'ok', 'Кровь'],
        ['Ферритин', '48', 'мкг/л', '15–150', 'ok', 'Витамины и железо']
      ] },
    { date: '2026-03-05', title: 'Гастроскопия', clinic: 'ЕМС',
      ind: [
        ['Заключение', 'Поверхностный гастрит, эрадикация не требуется', '', '', 'ok', 'ЖКТ']
      ] }
  ];

  var demoCursor = 0;

  function demo(file) {
    var s = SAMPLES[demoCursor % SAMPLES.length];
    demoCursor++;
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(normalize({
          isMedical: true,
          date: s.date,
          title: s.title,
          clinic: s.clinic,
          patient: { name: 'Смирнова Анна Игоревна', birthDate: '1990-03-12', sex: 'female' },
          indicators: s.ind.map(function (r) {
            return { name: r[0], value: r[1], unit: r[2], norm: r[3], flag: r[4], system: r[5] };
          })
        }));
      }, 500 + Math.random() * 600);
    });
  }

  function resetDemo() { demoCursor = 0; }

  // ─── общая пост-обработка ──────────────────────────────────────────

  function normalize(r) {
    return {
      isMedical: r.isMedical !== false,
      date: (r.date || '').slice(0, 10),
      title: (r.title || '').trim() || 'Документ',
      clinic: (r.clinic || '').trim(),
      patient: {
        name: ((r.patient && r.patient.name) || '').trim(),
        birthDate: ((r.patient && r.patient.birthDate) || '').slice(0, 10),
        sex: (r.patient && r.patient.sex) || 'unknown'
      },
      indicators: (r.indicators || []).map(function (i) {
        return {
          id: DB.uid(),
          name: (i.name || '').trim(),
          value: (i.value || '').trim(),
          unit: (i.unit || '').trim(),
          norm: (i.norm || '').trim(),
          flag: ['ok', 'low', 'high', 'attn'].indexOf(i.flag) >= 0 ? i.flag : 'attn',
          system: (i.system || '').trim() || 'Разное'
        };
      }).filter(function (i) { return i.name && i.value; })
    };
  }

  global.Extract = {
    withAI: withAI,
    explain: explain,
    demo: demo,
    resetDemo: resetDemo,
    MODELS: MODELS,
    DEFAULT_MODEL: DEFAULT_MODEL
  };
})(window);
