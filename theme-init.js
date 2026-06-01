// Set theme before first paint to avoid flash
(function() {
  var t = localStorage.getItem('pwt_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();
