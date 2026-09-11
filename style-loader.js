// style-loader.js — fetches style.css and injects it inline
// Works around preview proxies that rewrite Content-Type to text/plain,
// which prevents <link rel="stylesheet"> from applying the CSS.
(function () {
  var link = document.querySelector('link[rel="stylesheet"][href="style.css"]');
  fetch('style.css')
    .then(function (r) { return r.text(); })
    .then(function (css) {
      var style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      if (link) link.remove();
    })
    .catch(function () {});
})();
