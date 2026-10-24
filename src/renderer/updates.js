'use strict';
// Settings > Privacy: shows the app version. There is no auto-update.
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    const el = document.getElementById('app-version');
    if (el && window.cordoval && window.cordoval.appVersion) window.cordoval.appVersion().then(function (v) { el.textContent = v; }).catch(function () {});
  });
})();
