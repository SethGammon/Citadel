(function () {
  'use strict';

  const toggle = document.querySelector('[data-site-nav-toggle]');
  const mobile = document.querySelector('[data-site-nav-mobile]');
  if (toggle && mobile) {
    const closeMobile = (restoreFocus = false) => {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = 'Menu';
      mobile.hidden = true;
      if (restoreFocus) toggle.focus();
    };
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      mobile.hidden = open;
      toggle.textContent = open ? 'Menu' : 'Close';
    });
    mobile.querySelectorAll('a, button').forEach((control) => control.addEventListener('click', () => {
      closeMobile();
    }));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') closeMobile(true);
    });
    window.matchMedia('(min-width: 1081px)').addEventListener('change', (event) => {
      if (event.matches) closeMobile();
    });
  }

  const progress = document.querySelector('.site-scroll-progress span');
  let progressFrame = 0;
  function updateProgress() {
    progressFrame = 0;
    if (!progress) return;
    const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    progress.style.width = `${Math.min(100, Math.max(0, (window.scrollY / scrollable) * 100))}%`;
  }
  window.addEventListener('scroll', () => {
    if (!progressFrame) progressFrame = requestAnimationFrame(updateProgress);
  }, { passive: true });
  updateProgress();

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealTargets = [...document.querySelectorAll('[data-site-reveal]')];
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealTargets.forEach((element) => element.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
    revealTargets.forEach((element) => {
      element.classList.add('site-reveal');
      observer.observe(element);
    });
  }
})();
