(() => {
  'use strict';
  const themes = {
    porcelain: ['Porcelain', 'cool white surfaces and crisp blue accents'],
    jade: ['Jade', 'soft green surfaces and a calmer reading rhythm'],
    sandstone: ['Sandstone', 'warm paper tones for longer reading sessions'],
    midnight: ['Midnight', 'deep blue surfaces and an ice-blue focus'],
    graphite: ['Graphite', 'neutral dark surfaces that let the structure lead'],
    aurora: ['Aurora', 'ink-purple surfaces with soft lavender accents'],
  };
  const themeImage = document.querySelector('#theme-image');
  document.querySelectorAll('[data-theme]').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.dataset.theme, theme = themes[id];
      if (!theme) return;
      document.querySelectorAll('[data-theme]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      themeImage.src = `assets/captures/theme-${id}.png`;
      themeImage.alt = `Skylense in the ${theme[0]} theme`;
      document.querySelector('#theme-caption').textContent = `${theme[0]} — ${theme[1]}.`;
    });
  });
  const flowImage = document.querySelector('#flow-image');
  const motionButton = document.querySelector('#motion-toggle');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduceMotion.matches;
  const updateMotion = () => {
    flowImage.src = paused ? 'assets/captures/flow-still.png' : 'assets/captures/flow.gif';
    motionButton.textContent = paused ? 'Play preview' : 'Pause preview';
    motionButton.setAttribute('aria-pressed', String(paused));
  };
  motionButton.addEventListener('click', () => { paused = !paused; updateMotion(); });
  reduceMotion.addEventListener('change', () => { if (reduceMotion.matches) { paused = true; updateMotion(); } });
  updateMotion();
  document.querySelector('#share-site').addEventListener('click', async () => {
    const url = 'https://danielchen26.github.io/skylense-app/';
    const status = document.querySelector('.share-status');
    try { await navigator.clipboard.writeText(url); status.textContent = 'Link copied. Share a clearer perspective.'; }
    catch { status.textContent = `Copy this link: ${url}`; }
  });
})();
