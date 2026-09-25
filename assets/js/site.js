/* Small behaviours used on every page: the phone menu and click-to-play videos. */
(function () {
  'use strict';

  var menuButton = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (menuButton && nav) {
    menuButton.addEventListener('click', function () {
      var open = menuButton.getAttribute('aria-expanded') !== 'true';
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      nav.classList.toggle('is-open', open);
    });
  }

  // YouTube players (and their cookies) load only when a visitor asks for one.
  document.addEventListener('click', function (event) {
    var thumb = event.target.closest('[data-yt]');
    if (!thumb) return;
    var frame = document.createElement('iframe');
    frame.className = 'video-frame';
    frame.src = 'https://www.youtube-nocookie.com/embed/' +
      encodeURIComponent(thumb.getAttribute('data-yt')) + '?autoplay=1&rel=0';
    frame.title = thumb.getAttribute('aria-label') || 'YouTube video';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    thumb.replaceWith(frame);
    frame.focus();
  });
})();
