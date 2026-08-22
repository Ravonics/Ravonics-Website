/* Shared accessibility enhancements for the legacy static shell. */
(function () {
  'use strict';

  function focusable(root) {
    return Array.prototype.slice.call(root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (element) {
      return element.offsetParent !== null;
    });
  }

  function labelCarouselDots(root) {
    root.querySelectorAll('.owl-dots').forEach(function (dots) {
      dots.setAttribute('role', 'tablist');
      dots.querySelectorAll('.owl-dot').forEach(function (dot, index) {
        dot.setAttribute('type', 'button');
        dot.setAttribute('aria-label', 'Go to slide ' + (index + 1));
        dot.setAttribute('role', 'tab');
        dot.setAttribute('aria-selected', dot.classList.contains('active') ? 'true' : 'false');
      });
    });
  }

  function setPanelState(open, returnFocus) {
    var wrap = document.getElementById('extra-wrap');
    if (!wrap) return;
    wrap.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      window.setTimeout(function () {
        var close = document.getElementById('btn-close');
        if (close && typeof close.focus === 'function') close.focus();
      }, 0);
    } else if (returnFocus && typeof returnFocus.focus === 'function') {
      returnFocus.focus();
    }
  }

  function init() {
    labelCarouselDots(document);

    var observer = new MutationObserver(function () {
      labelCarouselDots(document);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    var openButton = document.getElementById('btn-extra');
    var closeButton = document.getElementById('btn-close');
    var dialog = document.getElementById('extra-wrap');
    if (!dialog) return;

    var lastTrigger = null;
    if (openButton) {
      openButton.addEventListener('click', function () {
        lastTrigger = openButton;
        setPanelState(true);
      });
    }
    if (closeButton) {
      closeButton.addEventListener('click', function () {
        setPanelState(false, lastTrigger);
      });
    }
    document.addEventListener('keydown', function (event) {
      var wrap = document.getElementById('extra-wrap');
      if (!wrap || !wrap.classList.contains('open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (closeButton) closeButton.click();
        return;
      }
      if (event.key !== 'Tab') return;
      var elements = focusable(dialog);
      if (!elements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      var first = elements[0];
      var last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.classList.add('prefers-reduced-motion');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
