/* global Fancybox, WaveDrom */
(() => {
  'use strict';
  // PJAX or a repeated script evaluation must not install duplicate listeners.
  if (window.__pageAssetsInstalled) return;
  const configElement = document.getElementById('page-assets-config');
  if (!configElement) return;
  const config = JSON.parse(configElement.textContent);
  window.__pageAssetsInstalled = true;

  const assets = new Map();
  const stylesheetRetries = new Map();
  let retrySerial = 0;
  const waveOutputs = new WeakMap();
  let lastWaves = [];
  let waveMenuStyle = null;
  let generation = 0;
  let navigating = false;
  let fancyboxReady = false;
  let pendingImage = null;

  function loadAsset(value, css = false, ready = () => true) {
    const asset = typeof value === 'string' ? { url: value } : value;
    if (!asset?.url) return Promise.reject(new Error('Missing page asset URL'));
    const key = `${css ? 'css' : 'js'}:${asset.url}`;
    if (!css && ready()) return Promise.resolve();
    if (assets.has(key)) return assets.get(key);
    if (!css) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const promise = (async () => {
        let objectURL;
        let element;
        try {
          // Abort the transfer before execution: removing a native script does
          // not cancel its download, and same-URL retries can coalesce with it.
          const response = await fetch(asset.url, {
            signal: controller.signal,
            integrity: asset.integrity || '',
            mode: 'cors',
            credentials: 'same-origin'
          });
          if (!response.ok) throw new Error(`Page asset failed: ${asset.url}`);
          const bytes = await response.arrayBuffer();
          controller.signal.throwIfAborted();
          clearTimeout(timer);
          objectURL = URL.createObjectURL(new Blob([bytes], { type: 'application/javascript' }));
          element = document.createElement('script');
          element.src = objectURL;
          await new Promise((resolve, reject) => {
            element.onload = resolve;
            element.onerror = () => reject(new Error(`Page asset failed: ${asset.url}`));
            document.head.appendChild(element);
          });
          if (!ready()) throw new Error(`Page asset API missing: ${asset.url}`);
        } catch (error) {
          if (controller.signal.aborted) throw new Error(`Page asset timed out: ${asset.url}`);
          throw error;
        } finally {
          clearTimeout(timer);
          element?.remove();
          if (objectURL) URL.revokeObjectURL(objectURL);
        }
      })();
      assets.set(key, promise);
      promise.catch(() => { if (assets.get(key) === promise) assets.delete(key); });
      return promise;
    }
    const element = document.createElement('link');
    element.rel = 'stylesheet';
    const retryURL = stylesheetRetries.get(key);
    element.href = retryURL || asset.url;
    if (asset.integrity) {
      element.integrity = asset.integrity;
      element.crossOrigin = 'anonymous';
    }
    const promise = new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        element.onload = element.onerror = null;
        if (error) {
          // Removal cannot cancel a hung download or clear a cached SRI failure.
          // Keep native CSS relative-resource resolution, but isolate retries.
          const url = new URL(asset.url, document.baseURI);
          url.searchParams.set('__page_assets_retry', `${Date.now()}-${++retrySerial}`);
          stylesheetRetries.set(key, url.href);
          element.remove();
          reject(error);
        } else {
          resolve();
        }
      };
      const timer = setTimeout(() => finish(new Error(`Page asset timed out: ${asset.url}`)), 15000);
      element.onload = () => finish(ready() ? null : new Error(`Page asset API missing: ${asset.url}`));
      element.onerror = () => finish(new Error(`Page asset failed: ${asset.url}`));
      document.head.appendChild(element);
    });
    assets.set(key, promise);
    // A failed request must not poison future page/decrypt retries.
    promise.catch(() => { if (assets.get(key) === promise) assets.delete(key); });
    return promise;
  }

  function wrapImages() {
    document.querySelectorAll('.post-body :not(a) > img, .post-body > img').forEach(image => {
      if (image.closest('a')) return;
      const picture = image.parentElement?.tagName === 'PICTURE' ? image.parentElement : null;
      const content = picture || image;
      const link = document.createElement('a');
      link.classList.add('fancybox');
      link.href = image.dataset.src || image.src;
      link.setAttribute('itemscope', '');
      link.setAttribute('itemtype', 'http://schema.org/ImageObject');
      link.setAttribute('itemprop', 'url');
      link.dataset.fancybox = image.closest('.post-gallery') ? 'gallery' :
        image.closest('.group-picture') ? 'group' : 'default';
      // PJAX must not treat an image URL as an HTML navigation.
      link.setAttribute('data-pjax-state', 'fancybox');
      const caption = image.title || image.alt;
      if (caption) {
        link.title = caption;
        link.dataset.caption = caption;
      }
      content.parentNode.insertBefore(link, content);
      link.appendChild(content);
    });
    // Marked image anchors bypass PJAX. Refresh the containing Element, not
    // a NodeList: the real controller expects a querySelectorAll-capable root.
    const container = document.querySelector('.main-inner');
    if (container) window.pjax?.refresh(container);
  }

  async function fancybox(token) {
    if (!config.fancybox || !document.querySelector(
      '.post-body :not(a) > img, .post-body > img, [data-fancybox]')) return;
    // Native image links must exist even while either CDN request is cold or
    // fails. Keep a whole picture intact before refreshing PJAX's exclusions.
    wrapImages();
    await Promise.all([
      loadAsset(config.fancybox.css, true),
      loadAsset(config.fancybox.js, false, () => typeof window.Fancybox?.bind === 'function' &&
        typeof window.Fancybox?.fromTriggerEl === 'function')
    ]);
    if (token !== generation || navigating) return;
    // bind uses a document-body delegate; no rebinding for every navigation.
    if (!fancyboxReady) {
      Fancybox.bind('[data-fancybox]', { Hash: false });
      fancyboxReady = true;
    }
  }

  function clearImageIntent() {
    if (!pendingImage) return;
    const { link, status, busy } = pendingImage;
    if (busy === null) link.removeAttribute('aria-busy');
    else link.setAttribute('aria-busy', busy);
    status.remove();
    pendingImage = null;
  }

  function imageFailure(intent) {
    if (pendingImage !== intent) return;
    const { link, status, busy } = intent;
    if (busy === null) link.removeAttribute('aria-busy');
    else link.setAttribute('aria-busy', busy);
    status.textContent = 'Image viewer failed to load. Click the image to retry, or ';
    const original = document.createElement('a');
    original.href = link.href;
    original.textContent = 'open the original image';
    original.setAttribute('data-pjax-state', 'fancybox');
    status.appendChild(original);
    const container = document.querySelector('.main-inner');
    if (container) window.pjax?.refresh(container);
  }

  // Capture ahead of Fancybox's body delegate and PJAX. Warm and modified
  // clicks retain the existing Fancybox/native link behavior.
  document.addEventListener('click', event => {
    const link = event.target?.closest?.('[data-fancybox]');
    if (!config.fancybox || !link || navigating || fancyboxReady ||
      event.defaultPrevented || event.button !== 0 || event.ctrlKey ||
      event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clearImageIntent();
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Loading image viewer…';
    const intent = { link, status, token: generation, busy: link.getAttribute('aria-busy') };
    pendingImage = intent;
    link.setAttribute('aria-busy', 'true');
    link.parentNode.insertBefore(status, link.nextSibling);
    fancybox(intent.token).then(() => {
      if (pendingImage !== intent || intent.token !== generation || navigating) return;
      if (!link.isConnected) { clearImageIntent(); return; }
      // Fancybox 6 reuses its bound selector, gallery and caption parsing.
      // Replaying a DOM click would also wake unrelated PJAX handlers.
      // In 6.1.14 fromTriggerEl/show can return undefined even after opening;
      // verify the live instance's trigger rather than trusting a return value.
      window.Fancybox.fromTriggerEl(link, { Hash: false });
      if (window.Fancybox.getInstance()?.getOptions().triggerEl !== link) {
        imageFailure(intent);
        return;
      }
      clearImageIntent();
    }).catch(error => {
      if (pendingImage !== intent || intent.token !== generation || navigating) return;
      if (!link.isConnected) { clearImageIntent(); return; }
      imageFailure(intent);
      console.warn('[page-assets]', error);
    });
  }, true);

  function waves() {
    return [...document.querySelectorAll('script[type="wavedrom" i]')];
  }

  async function wavedrom(token) {
    if (!config.wavedrom || !waves().length) return;
    await loadAsset(config.wavedrom.js, false, () => typeof window.WaveDrom?.ProcessAll === 'function');
    if (token !== generation || navigating || !waves().length) return;
    await loadAsset(config.wavedrom.skin, false, () => !!window.WaveSkin);
    if (token !== generation || navigating) return;
    const current = waves();
    if (!current.length || (current.length === lastWaves.length &&
      current.every((script, index) => script === lastWaves[index]))) return;
    // ProcessAll renumbers every diagram and adds output/style on EACH call.
    // Rerender the current set when decrypt reveals more diagrams, removing
    // our previous outputs first so IDs, SVG defs and export menus stay valid.
    current.forEach(script => waveOutputs.get(script)?.remove());
    const oldStyles = new Set(document.head.querySelectorAll('style'));
    try {
      WaveDrom.ProcessAll();
      lastWaves = current;
    } finally {
      current.forEach(script => {
        const output = script.previousElementSibling;
        if (output?.id.startsWith('WaveDrom_Display_')) waveOutputs.set(script, output);
      });
      document.head.querySelectorAll('style').forEach(style => {
        if (oldStyles.has(style) || !style.textContent.includes('div.wavedromMenu')) return;
        if (waveMenuStyle?.isConnected) style.remove();
        else waveMenuStyle = style;
      });
    }
  }

  function refresh() {
    clearImageIntent();
    navigating = false;
    const token = ++generation;
    for (const task of [fancybox, wavedrom]) {
      task(token).catch(error => {
        if (token === generation && !navigating) console.warn('[page-assets]', error);
      });
    }
  }

  document.addEventListener('page:loaded', refresh);
  window.addEventListener('hexo-blog-decrypt', refresh);
  document.addEventListener('pjax:send', () => {
    clearImageIntent();
    navigating = true;
    generation++;
    // Do not retain detached article trees when the next page has no diagrams.
    lastWaves = [];
    window.Fancybox?.close();
  });
  // A failed PJAX request leaves the old document active, so resume its work.
  document.addEventListener('pjax:error', refresh);
  // NexT dispatches page:loaded at DOMContentLoaded. The fallback covers late
  // loading without scheduling a duplicate initial refresh in the normal case.
  if (document.readyState !== 'loading') refresh();
})();
