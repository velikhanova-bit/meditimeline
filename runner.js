/**
 * Человечек, бегущий по таймлайну вместе со скроллом.
 *
 * Украшение. Держится в отдельном файле намеренно: чтобы убрать, достаточно
 * снять одну строку <script> в index.html и блок «бегунок» в app.css —
 * ни одна строка продуктовой логики не завязана на этот код.
 *
 * Поведение: положение по вертикали повторяет прогресс прокрутки, лицом
 * вниз при движении вниз и вверх при движении вверх, частота шага растёт
 * со скоростью прокрутки. Когда прокрутка замирает — переходит в покой.
 */
(function (global) {
  'use strict';

  var STEP_FAST = 140;   // мс на шаг при быстрой прокрутке
  var STEP_SLOW = 460;   // мс на шаг при медленной
  var IDLE_AFTER = 160;  // через столько тишины считаем, что человек остановился

  function init() {
    var scroll = document.getElementById('tl-scroll');
    var frame = scroll && scroll.parentNode;
    if (!scroll || !frame) return;
    if (document.getElementById('tl-runner')) return;

    // Уважаем системную настройку: кому анимации мешают, тому их не показываем.
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var el = document.createElement('div');
    el.id = 'tl-runner';
    el.className = 'tl-runner';
    el.setAttribute('aria-hidden', 'true');   // декорация, скринридеру не нужна
    el.innerHTML =
      '<svg viewBox="0 0 28 34" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="14" cy="5.5" r="3.6" fill="currentColor" stroke="none"/>' +
        '<path class="body" d="M14 10v9"/>' +
        '<path class="arm-a" d="M14 12.5 8 16"/>' +
        '<path class="arm-b" d="M14 12.5 20 16"/>' +
        '<path class="leg-a" d="M14 19 9 27"/>' +
        '<path class="leg-b" d="M14 19 19 27"/>' +
      '</svg>';
    frame.appendChild(el);

    var last = scroll.scrollTop;
    var lastAt = 0;
    var idleTimer = null;
    var pending = false;

    function place() {
      pending = false;
      var max = scroll.scrollHeight - scroll.clientHeight;
      var top = scroll.offsetTop;
      var travel = scroll.clientHeight - el.offsetHeight;
      if (max <= 0 || travel <= 0) { el.style.opacity = '0'; return; }
      el.style.opacity = '1';
      var progress = Math.min(1, Math.max(0, scroll.scrollTop / max));
      el.style.transform = 'translateY(' + (top + progress * travel).toFixed(1) + 'px)';
    }

    function onScroll() {
      var now = (global.performance && performance.now()) || 0;
      var pos = scroll.scrollTop;
      var dy = pos - last;
      var dt = Math.max(1, now - lastAt);
      last = pos; lastAt = now;

      if (dy) el.classList.toggle('is-up', dy < 0);

      // Считаем в пикселях на кадр, а не px/мс: события скролла приходят
      // с рваным интервалом, и в миллисекундах даже спокойная прокрутка
      // мгновенно упиралась в потолок.
      var perFrame = Math.abs(dy) * 16 / dt;
      var t = Math.min(1, Math.max(0, (perFrame - 4) / 56));   // 4..60 px/кадр
      var step = STEP_SLOW - (STEP_SLOW - STEP_FAST) * t;
      el.style.setProperty('--step', step.toFixed(0) + 'ms');
      el.classList.add('is-running');

      if (!pending) { pending = true; requestAnimationFrame(place); }

      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { el.classList.remove('is-running'); }, IDLE_AFTER);
    }

    scroll.addEventListener('scroll', onScroll, { passive: true });
    global.addEventListener('resize', place);
    // лента перерисовывается при фильтрах и правках — ловим смену размеров
    if (global.ResizeObserver) new ResizeObserver(place).observe(scroll.firstElementChild || scroll);
    place();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
