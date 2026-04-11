/**
 * carousel.js
 * Hero carousel con soporte touch/swipe y teclado.
 */

window.Carousel = (() => {
  let current = 0;
  let timer = null;
  let dragging = false;
  let startX = 0;
  let currentX = 0;
  let diffX = 0;
  let snapTimeout = null;
  let touchBound = false;
  let keyboardBound = false;

  const INTERVAL = 7000;
  const SWIPE_THRESH = 60;

  const track = () => document.getElementById('hero-track');
  const dots = () => document.getElementById('hero-dots');
  const titleEl = () => document.getElementById('hero-title');
  const subEl = () => document.getElementById('hero-sub');
  const ctaBtn = () => document.getElementById('hero-cta-btn');
  const inner = () => document.getElementById('hero-inner');

  function _findEvent(eventId) {
    return EVENTS.find(event => event.id === eventId) || null;
  }

  function _slideData(index) {
    const slide = HERO_SLIDES[index];
    if (!slide) return null;

    const event = _findEvent(slide.eventId);
    return {
      ...slide,
      image: event?.image || slide.image || 'assets/img/logo.png',
      title: slide.title || event?.title || 'Evento Ticketazo',
      sub: slide.sub || [event?.artist, event?.city].filter(Boolean).join(' - '),
      cta: slide.cta || `Ver ${event?.title || 'evento'}`,
    };
  }

  function _renderSlideMarkup(slide) {
    return `
      <div class="hero-slide">
        <img src="${slide.image}" alt="${slide.title}" loading="lazy"/>
        <div class="hero-overlay"></div>
        <div class="hero-overlay-lr"></div>
      </div>`;
  }

  function _renderSlides() {
    const element = track();
    const slides = HERO_SLIDES.map((_, index) => _slideData(index)).filter(Boolean);
    if (!element) return;

    if (!slides.length) {
      element.innerHTML = '';
      return;
    }

    element.innerHTML = [
      _renderSlideMarkup(slides[slides.length - 1]),
      ...slides.map(_renderSlideMarkup),
      _renderSlideMarkup(slides[0]),
    ].join('');

    current = 0;
    element.style.transition = 'none';
    applyTranslate(-100, '%');
  }

  function init() {
    _renderSlides();
    buildDots();
    updateContent();
    bindTouch();
    bindKeyboard();
    startTimer();
  }

  function refresh() {
    clearTimeout(snapTimeout);
    _renderSlides();
    buildDots();
    updateContent();
    updateDots();
    restartTimer();
  }

  function buildDots() {
    const element = dots();
    if (!element) return;

    element.innerHTML = HERO_SLIDES.map((_, index) => `
      <button class="hero-dot${index === 0 ? ' active' : ''}"
        onclick="Carousel.goTo(${index})"
        aria-label="Slide ${index + 1}"
        role="tab"
        aria-selected="${index === 0}">
      </button>`).join('');
  }

  function goTo(nextIndex) {
    const maxIdx = HERO_SLIDES.length;
    const element = track();
    if (!maxIdx || !element) return;

    if (nextIndex < -1) {
      element.style.transition = 'none';
      applyTranslate(maxIdx * -100, '%');
      void element.offsetWidth;
      nextIndex = maxIdx - 2;
    }

    if (nextIndex > maxIdx) {
      element.style.transition = 'none';
      applyTranslate(-100, '%');
      void element.offsetWidth;
      nextIndex = 1;
    }

    current = nextIndex;
    element.style.transition = 'transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    applyTranslate((current + 1) * -100, '%');

    updateDots();
    updateContent();
    restartTimer();

    clearTimeout(snapTimeout);
    if (current === maxIdx) {
      snapTimeout = setTimeout(() => {
        const currentTrack = track();
        if (!dragging && currentTrack && current === maxIdx) {
          currentTrack.style.transition = 'none';
          current = 0;
          applyTranslate((current + 1) * -100, '%');
        }
      }, 500);
    } else if (current === -1) {
      snapTimeout = setTimeout(() => {
        const currentTrack = track();
        if (!dragging && currentTrack && current === -1) {
          currentTrack.style.transition = 'none';
          current = maxIdx - 1;
          applyTranslate((current + 1) * -100, '%');
        }
      }, 500);
    }
  }

  function next() {
    goTo(current + 1);
  }

  function prev() {
    goTo(current - 1);
  }

  function applyTranslate(value, unit = 'px') {
    const element = track();
    if (!element) return;
    element.style.transform = `translateX(${value}${unit})`;
  }

  function updateDots() {
    const maxIdx = HERO_SLIDES.length;
    const element = dots();
    if (!maxIdx || !element) return;

    const realIdx = (current % maxIdx + maxIdx) % maxIdx;
    element.querySelectorAll('.hero-dot').forEach((dot, index) => {
      const active = index === realIdx;
      dot.classList.toggle('active', active);
      dot.setAttribute('aria-selected', active);
    });
  }

  function updateContent() {
    const maxIdx = HERO_SLIDES.length;
    const element = inner();
    if (!maxIdx || !element) return;

    const realIdx = (current % maxIdx + maxIdx) % maxIdx;
    const slide = _slideData(realIdx);
    if (!slide) return;

    element.style.animation = 'none';
    void element.offsetWidth;
    element.style.animation = 'heroFadeUp 0.6s ease both';

    if (titleEl()) titleEl().textContent = slide.title;
    if (subEl()) subEl().textContent = slide.sub;
    if (ctaBtn()) ctaBtn().textContent = slide.cta;
  }

  function startTimer() {
    clearInterval(timer);
    timer = setInterval(() => next(), INTERVAL);
  }

  function restartTimer() {
    clearInterval(timer);
    startTimer();
  }

  function bindTouch() {
    const element = document.getElementById('hero-section');
    if (!element || touchBound) return;

    element.addEventListener('touchstart', onDragStart, { passive: true });
    element.addEventListener('touchmove', onDragMove, { passive: true });
    element.addEventListener('touchend', onDragEnd, { passive: true });
    element.addEventListener('mousedown', onDragStart);
    element.addEventListener('mousemove', onDragMove);
    element.addEventListener('mouseup', onDragEnd);
    element.addEventListener('mouseleave', onDragEnd);
    touchBound = true;
  }

  function getClientX(event) {
    return event.touches ? event.touches[0].clientX : event.clientX;
  }

  function onDragStart(event) {
    dragging = true;
    startX = getClientX(event);
    diffX = 0;
    track()?.classList.add('dragging');
    clearInterval(timer);
  }

  function onDragMove(event) {
    if (!dragging) return;

    const element = track();
    if (!element) return;

    currentX = getClientX(event);
    diffX = currentX - startX;

    const containerWidth = document.getElementById('hero-section')?.offsetWidth || window.innerWidth;
    const baseOffset = (current + 1) * -containerWidth;
    const dragOffset = diffX * 0.85;

    element.style.transition = 'none';
    element.style.transform = `translateX(${baseOffset + dragOffset}px)`;
  }

  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    track()?.classList.remove('dragging');

    if (Math.abs(diffX) >= SWIPE_THRESH) {
      diffX < 0 ? next() : prev();
    } else {
      goTo(current);
    }

    diffX = 0;
  }

  function bindKeyboard() {
    if (keyboardBound) return;
    document.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') prev();
      if (event.key === 'ArrowRight') next();
    });
    keyboardBound = true;
  }

  function handleBuy() {
    const maxIdx = HERO_SLIDES.length;
    if (!maxIdx) return;

    const realIdx = (current % maxIdx + maxIdx) % maxIdx;
    const eventId = HERO_SLIDES[realIdx].eventId;
    if (!Auth.isLoggedIn()) {
      Auth.openModal();
      return;
    }
    Pages.openEvent(eventId);
  }

  function handleCta() {
    const maxIdx = HERO_SLIDES.length;
    if (!maxIdx) return;

    const realIdx = (current % maxIdx + maxIdx) % maxIdx;
    Pages.openEvent(HERO_SLIDES[realIdx].eventId);
  }

  return { init, refresh, goTo, next, prev, handleBuy, handleCta };
})();
