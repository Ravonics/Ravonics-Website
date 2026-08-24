/* Shared interaction contract for the Ravonics global header. */
(function () {
  'use strict';

  function initHeader(root) {
    var toggle = root.querySelector('.rv-menu-toggle');
    var nav = root.querySelector('.rv-primary-navigation');
    var menus = Array.prototype.slice.call(root.querySelectorAll('details.rv-mega[data-mega-menu]'));
    var mobileQuery = window.matchMedia('(max-width: 899px)');

    if (!toggle || !nav) return;

    function isMobile() {
      return mobileQuery.matches;
    }

    function syncSummary(menu) {
      var summary = menu.querySelector('summary');
      if (summary) summary.setAttribute('aria-expanded', menu.open ? 'true' : 'false');
    }

    function closeMenu(menu, restoreFocus) {
      if (!menu.open) return;
      menu.removeAttribute('open');
      syncSummary(menu);
      if (restoreFocus) {
        var summary = menu.querySelector('summary');
        if (summary && typeof summary.focus === 'function') summary.focus();
      }
    }

    function closeMenus(restoreFocus) {
      var openMenu = menus.find(function (menu) { return menu.open; });
      menus.forEach(function (menu) { closeMenu(menu, false); });
      if (restoreFocus && openMenu) {
        var summary = openMenu.querySelector('summary');
        if (summary && typeof summary.focus === 'function') summary.focus();
      }
    }

    function syncMobileState() {
      var mobile = isMobile();
      if (!mobile) {
        root.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open navigation');
        nav.inert = false;
        document.body.classList.remove('rv-nav-locked');
        return;
      }
      nav.inert = !root.classList.contains('is-open');
    }

    function setMobileOpen(open, restoreFocus) {
      root.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      nav.inert = !open;
      document.body.classList.toggle('rv-nav-locked', open);
      if (!open) {
        closeMenus(false);
        if (restoreFocus && typeof toggle.focus === 'function') toggle.focus();
      }
    }

    menus.forEach(function (menu) {
      syncSummary(menu);
      menu.addEventListener('toggle', function () {
        if (menu.open) {
          menus.forEach(function (other) {
            if (other !== menu) closeMenu(other, false);
          });
        }
        syncSummary(menu);
      });

      var summary = menu.querySelector('summary');
      summary.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          menu.open = true;
          var firstLink = menu.querySelector('a');
          if (firstLink) firstLink.focus();
        } else if (event.key === 'ArrowUp' && menu.open) {
          event.preventDefault();
          closeMenu(menu, true);
        }
      });
    });

    toggle.addEventListener('click', function () {
      if (!isMobile()) {
        var openMenu = menus.find(function (menu) { return menu.open; });
        if (openMenu) {
          closeMenu(openMenu, false);
          toggle.setAttribute('aria-expanded', 'false');
          toggle.setAttribute('aria-label', 'Open navigation');
        } else if (menus[0]) {
          menus[0].open = true;
          toggle.setAttribute('aria-expanded', 'true');
          toggle.setAttribute('aria-label', 'Close navigation');
        }
        return;
      }
      setMobileOpen(!root.classList.contains('is-open'), false);
    });

    nav.addEventListener('click', function (event) {
      var target = event.target;
      if (target && target.closest && target.closest('a') && isMobile()) {
        setMobileOpen(false, false);
      }
    });

    document.addEventListener('click', function (event) {
      if (!root.contains(event.target)) closeMenus(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      var openMenu = menus.find(function (menu) { return menu.open; });
      if (openMenu) {
        event.preventDefault();
        closeMenu(openMenu, true);
        return;
      }
      if (isMobile() && root.classList.contains('is-open')) {
        event.preventDefault();
        setMobileOpen(false, true);
      }
    });

    window.addEventListener('resize', syncMobileState, { passive: true });
    syncMobileState();
  }

  function init() {
    var roots = Array.prototype.slice.call(document.querySelectorAll('[data-site-header]'));
    if (!roots.length) return;

    document.documentElement.setAttribute('data-rv-js', 'true');
    roots.forEach(function (root) {
      initHeader(root);
      function syncScrollState() {
        root.classList.toggle('is-scrolled', window.scrollY > 8);
      }
      syncScrollState();
      window.addEventListener('scroll', syncScrollState, { passive: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
