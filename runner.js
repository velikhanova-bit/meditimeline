/**
 * Человечек на канате слева от таймлайна.
 *
 * Вниз — перебирает руками по канату, ноги обхватывают его и придерживают.
 * Вверх — лезет: рука и противоположная нога подтягиваются по очереди.
 *
 * Украшение. Держится в отдельном файле намеренно: чтобы убрать, достаточно
 * снять одну строку <script> в index.html и блок «канат» в app.css —
 * ни одна строка продуктовой логики на этот код не завязана.
 */
(function (global) {
  'use strict';

  var STEP_FAST = 200;   // мс на перехват при быстрой прокрутке
  var STEP_SLOW = 640;   // мс на перехват при медленной
  var IDLE_AFTER = 170;  // через столько тишины считаем, что человек замер

  function init() {
    var scroll = document.getElementById('tl-scroll');
    var frame = scroll && scroll.parentNode;
    if (!scroll || !frame) return;
    if (document.getElementById('tl-runner')) return;

    // Уважаем системную настройку: кому анимации мешают, тому их не показываем.
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var rope = document.createElement('div');
    rope.id = 'tl-rope';
    rope.className = 'tl-rope';
    rope.setAttribute('aria-hidden', 'true');
    frame.appendChild(rope);

    var el = document.createElement('div');
    el.id = 'tl-runner';
    el.className = 'tl-runner is-down';
    el.setAttribute('aria-hidden', 'true');   // декорация, скринридеру не нужна
    // Канат проходит по x=11 внутри вьюбокса: туда тянутся руки,
    // вокруг него смыкаются ноги.
    el.innerHTML =
      '<svg viewBox="0 0 30 40" fill="none" stroke="currentColor" ' +
           'stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">' +
        '<g class="figure">' +
          '<circle class="head" cx="18" cy="11" r="3.5" fill="currentColor" stroke="none"/>' +
          '<path class="torso" d="M17.5 14.5V25"/>' +
          '<path class="arm-a" d="M17 16.5C14 15.5 12 13.5 11 11"/>' +
          '<path class="arm-b" d="M17 18.5C14.5 18.5 12.5 17.5 11 16"/>' +
          '<path class="leg-a" d="M17.5 25C14 26 11.5 27.5 11 29.5"/>' +
          '<path class="leg-b" d="M17.5 25C15 28 12.5 30 11 31"/>' +
        '</g>' +
      '</svg>';
    frame.appendChild(el);

    var last = scroll.scrollTop;
    var lastAt = 0;
    var idleTimer = null;
    var pending = false;

    function place() {
      pending = false;
      var top = scroll.offsetTop;
      // канат натянут ровно вдоль видимой части ленты
      rope.style.top = top + 'px';
      rope.style.height = scroll.clientHeight + 'px';

      var max = scroll.scrollHeight - scroll.clientHeight;
      var travel = scroll.clientHeight - el.offsetHeight;
      if (max <= 0 || travel <= 0) { el.style.opacity = '0'; rope.style.opacity = '0'; return; }
      el.style.opacity = '1';
      rope.style.opacity = '1';
      var progress = Math.min(1, Math.max(0, scroll.scrollTop / max));
      el.style.transform = 'translateY(' + (top + progress * travel).toFixed(1) + 'px)';
    }

    function onScroll() {
      var now = (global.performance && performance.now()) || 0;
      var pos = scroll.scrollTop;
      var dy = pos - last;
      var dt = Math.max(1, now - lastAt);
      last = pos; lastAt = now;

      if (dy) {
        el.classList.toggle('is-up', dy < 0);
        el.classList.toggle('is-down', dy > 0);
      }

      // Считаем в пикселях на кадр, а не px/мс: события скролла приходят
      // с рваным интервалом, и в миллисекундах даже спокойная прокрутка
      // мгновенно упиралась в потолок.
      var perFrame = Math.abs(dy) * 16 / dt;
      var t = Math.min(1, Math.max(0, (perFrame - 4) / 56));   // 4..60 px/кадр
      var step = STEP_SLOW - (STEP_SLOW - STEP_FAST) * t;
      el.style.setProperty('--step', step.toFixed(0) + 'ms');
      el.classList.add('is-moving');

      if (!pending) { pending = true; requestAnimationFrame(place); }

      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { el.classList.remove('is-moving'); }, IDLE_AFTER);
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
