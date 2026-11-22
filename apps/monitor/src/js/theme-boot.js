// Apply the saved theme before the stylesheet loads, so there's no theme flash
// (mirrors js/theme.js; key 'gipity-theme'). A file, not an inline script, so
// the page's Content-Security-Policy needs no inline-script allowance.
(function () {
  try {
    var t = localStorage.getItem('gipity-theme');
    document.documentElement.setAttribute('data-theme', (t === 'light' || t === 'blue') ? t : 'dark');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
