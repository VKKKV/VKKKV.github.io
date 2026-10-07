/* Hello Navi HUD runtime — shared and cached across pages. */

(function () {
  "use strict";
  if (window.__hudSidebarInit) return;
  window.__hudSidebarInit = true;

  function initHeader() {
    const brand = document.querySelector('.brand');
    if (!brand || brand.querySelector('.cyber-underline')) return;
    const title = brand.querySelector('.site-title');
    if (title) {
      const words = title.textContent.trim().split(/\s+/);
      const first = document.createElement('span');
      first.className = 'text-white';
      first.textContent = words.shift();
      title.replaceChildren(first);
      if (words.length) {
        const rest = document.createElement('span');
        rest.className = 'text-red';
        rest.textContent = words.join(' ');
        title.append(' ', rest);
      }
    }
    const underline = document.createElement('div');
    underline.className = 'cyber-underline';
    underline.setAttribute('aria-hidden', 'true');
    underline.innerHTML = '<div class="line-red"></div><div class="line-dark"></div><div class="line-dashes"><i></i><i></i><i></i><i></i><i></i></div>';
    brand.appendChild(underline);
  }

  function initAll() {
    initHeader();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll, { once: true });
  else initAll();
  document.addEventListener('pjax:success', initAll);
})();

(function () {
  "use strict";
  if (window.__motionInit) return;
  window.__motionInit = true;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const desktopMotion = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1081px)");
  const LENIS_URL = "https://cdn.jsdelivr.net/npm/lenis@1.3.26/dist/lenis.min.js";
  const pageAnimations = new Set();
  let lenis = null;
  let revealObserver = null;
  let revealSeen = new WeakSet();
  const revealFrames = new Map();
  let pageFrame = null;
  let loadPromise = null;
  let loadBar = document.getElementById("pjax-load-bar");
  let statusNode = document.getElementById("pjax-status");
  let loadBarAnimation = null;
  let navigating = false;
  let themeScrollTo = null;

  function motionAllowed() {
    return desktopMotion.matches && !reducedMotion.matches;
  }

  function adaptThemeScrolling() {
    const utils = window.NexT?.utils;
    if (!utils?.scrollTo || utils.scrollTo === themeScrollTo) return;
    const original = utils.scrollTo;
    themeScrollTo = function (...args) {
      const [target, top] = args;
      // Explicit instant also overrides CSS scroll-behavior on nested TOC areas.
      if (reducedMotion.matches) return target.scrollTo({ top, behavior: "instant" });
      return original.apply(this, args);
    };
    utils.scrollTo = themeScrollTo;
  }

  function loadLenis() {
    if (window.Lenis) return Promise.resolve();
    if (loadPromise) return loadPromise;
    const source = window.NexT?.utils?.getScript
      ? NexT.utils.getScript(LENIS_URL)
      : new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = LENIS_URL;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
    const promise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(() => finish(new Error("Timed out loading Lenis")), 10000);
      source.then(() => {
        if (window.Lenis) finish();
        else finish(new Error("Lenis is unavailable"));
      }, finish);
    });
    loadPromise = promise;
    promise.catch(() => {
      if (loadPromise === promise) loadPromise = null;
    });
    return promise;
  }

  function trackAnimation(animation) {
    pageAnimations.add(animation);
    const release = () => pageAnimations.delete(animation);
    animation.addEventListener("finish", release, { once: true });
    animation.addEventListener("cancel", release, { once: true });
    return animation;
  }

  function animateIn(element, keyframes, options = {}) {
    if (reducedMotion.matches || !element?.animate) return;
    trackAnimation(element.animate(keyframes, {
      duration: 500,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      ...options,
    }));
  }

  function refreshReveals() {
    if (navigating || !motionAllowed() || !revealObserver) return;
    const groups = [
      [".post-body h2", [{ opacity: 0, transform: "translateX(-40px)" }, { opacity: 1, transform: "none" }]],
      [".post-body h3, .post-body blockquote", [{ opacity: 0, transform: "translateY(30px)" }, { opacity: 1, transform: "none" }]],
      [".post-body .highlight, .post-body > pre, .post-body .code-container > pre", [{ opacity: 0, transform: "scale(0.95)" }, { opacity: 1, transform: "none" }]],
      [".post-body > p, .post-body > ul > li, .post-body > ol > li, .post-body > table tbody tr", [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }]],
      [".post-block", [{ opacity: 0, transform: "translateY(40px)" }, { opacity: 1, transform: "none" }]],
    ];
    // Remember completed targets too: decrypt adds content, not a new page.
    for (const element of revealFrames.keys()) {
      if (element.isConnected) continue;
      revealObserver.unobserve(element);
      revealFrames.delete(element);
    }
    groups.forEach(([selector, keyframes]) => {
      document.querySelectorAll(selector).forEach(element => {
        if (revealSeen.has(element)) return;
        revealSeen.add(element);
        revealFrames.set(element, keyframes);
        revealObserver.observe(element);
      });
    });
  }

  function initReveals() {
    revealObserver?.disconnect();
    revealObserver = null;
    revealSeen = new WeakSet();
    revealFrames.clear();
    if (!motionAllowed() || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      if (navigating || !motionAllowed() || revealObserver !== observer) return;
      entries.forEach(entry => {
        const keyframes = revealFrames.get(entry.target);
        if (!entry.isIntersecting || !entry.target.isConnected || !keyframes) return;
        observer.unobserve(entry.target);
        revealFrames.delete(entry.target);
        animateIn(entry.target, keyframes);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.01 });
    revealObserver = observer;
    refreshReveals();
  }

  function initPage() {
    pageFrame = null;
    if (navigating || !motionAllowed()) return;
    if (window.Lenis) {
      lenis?.destroy();
      lenis = new Lenis({
        autoRaf: true,
        duration: 0.95,
        stopInertiaOnNavigate: true,
        // NexT owns these nested scroll areas.
        prevent: node => node.matches?.(".search-pop-overlay, .sidebar, [data-lenis-prevent]"),
      });
    }
    initReveals();
    const content = document.querySelector(".content-wrap, .main-inner");
    animateIn(content, [
      { opacity: 0, transform: "translateY(20px)" },
      { opacity: 1, transform: "none" },
    ], { duration: 400 });
    const title = document.querySelector(".site-title");
    if (title && !title.dataset.hudAnimated) {
      title.dataset.hudAnimated = "true";
      animateIn(title, [
        { opacity: 0, transform: "translateY(20px)" },
        { opacity: 1, transform: "none" },
      ], { delay: 180 });
    }
  }

  function cleanupPage() {
    cancelAnimationFrame(pageFrame);
    pageFrame = null;
    revealObserver?.disconnect();
    revealObserver = null;
    revealFrames.clear();
    revealSeen = new WeakSet();
    pageAnimations.forEach(animation => animation.cancel());
    pageAnimations.clear();
    lenis?.destroy();
    lenis = null;
  }

  function schedulePage() {
    cancelAnimationFrame(pageFrame);
    pageFrame = requestAnimationFrame(initPage);
  }

  function resetLoadBar() {
    loadBarAnimation?.cancel();
    loadBarAnimation = null;
    if (!loadBar) return;
    loadBar.style.transform = "scaleX(0)";
    loadBar.style.opacity = "0";
  }

  function startLoadBar() {
    loadBar = document.getElementById("pjax-load-bar") || loadBar;
    resetLoadBar();
    if (!loadBar || reducedMotion.matches) return;
    loadBar.style.opacity = "1";
    loadBarAnimation = loadBar.animate(
      [{ transform: "scaleX(0)" }, { transform: "scaleX(0.8)" }],
      { duration: 650, easing: "ease-out", fill: "forwards" }
    );
  }

  function finishLoadBar() {
    loadBar = document.getElementById("pjax-load-bar") || loadBar;
    loadBarAnimation?.cancel();
    if (!loadBar || reducedMotion.matches) { resetLoadBar(); return; }
    loadBarAnimation = loadBar.animate([
      { transform: "scaleX(0.8)", opacity: 1 },
      { transform: "scaleX(1)", opacity: 1, offset: 0.4 },
      { transform: "scaleX(1)", opacity: 0 },
    ], { duration: 300, easing: "ease-out" });
    loadBarAnimation.addEventListener("finish", resetLoadBar, { once: true });
  }

  async function boot() {
    adaptThemeScrolling();
    if (!motionAllowed()) return;
    try {
      await loadLenis();
    } catch (error) {
      console.warn("[motion] Using native scrolling:", error);
    }
    if (navigating || !motionAllowed()) return;
    schedulePage();
  }

  // NexT normally smooth-scrolls these controls. Capture them only while Lenis owns scrolling.
  document.addEventListener("click", event => {
    if (!lenis || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const control = event.target.closest?.(".back-to-top, .post-toc:not(.placeholder-toc) a.nav-link");
    if (!control) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (control.matches(".back-to-top")) {
      lenis.scrollTo(0, { duration: 0.5 });
      return;
    }
    const hash = new URL(control.href, location.href).hash;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    lenis.scrollTo(target, {
      duration: 0.5,
      onComplete: () => history.pushState(null, document.title, hash),
    });
  }, true);

  document.addEventListener("pjax:send", () => {
    navigating = true;
    document.querySelector(".main-inner")?.setAttribute("aria-busy", "true");
    statusNode = document.getElementById("pjax-status") || statusNode;
    if (statusNode) statusNode.textContent = "Loading page";
    cleanupPage();
    startLoadBar();
  });
  document.addEventListener("pjax:complete", finishLoadBar);
  document.addEventListener("pjax:success", () => {
    navigating = false;
    document.querySelector(".main-inner")?.removeAttribute("aria-busy");
    if (statusNode) statusNode.textContent = `Loaded ${document.title}`;
    schedulePage();
  });
  document.addEventListener("pjax:error", () => {
    navigating = false;
    document.querySelector(".main-inner")?.removeAttribute("aria-busy");
    if (statusNode) statusNode.textContent = "Navigation failed";
    schedulePage();
  });
  const syncMotionPreference = () => {
    cleanupPage();
    resetLoadBar();
    if (motionAllowed()) boot();
  };
  adaptThemeScrolling();
  document.addEventListener("page:loaded", adaptThemeScrolling);
  window.addEventListener("hexo-blog-decrypt", refreshReveals);
  reducedMotion.addEventListener("change", syncMotionPreference);
  desktopMotion.addEventListener("change", syncMotionPreference);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();

(function () {
  "use strict";
  if (window.__hudGridInit) return;
  window.__hudGridInit = true;
  // Read the CSS trail size; its origin is shared with the larger background grid.
  const media = matchMedia('(min-width: 1081px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  const cells = new Map();
  const grid = document.querySelector('.hud-grid');
  if (!grid) return;
  let size = 24;
  let width = 0;
  let height = 0;
  const radius = 54;
  const occluders = '.header, .sidebar, .footer, .search-pop-overlay';
  let canvas = null;
  let context = null;
  let frame = null;
  let pointerFrame = null;
  let queuedPointer = null;
  let previous = null;
  let lastFrame = 0;
  let dirty = null;

  function clear(resetCells = true) {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(pointerFrame);
    frame = pointerFrame = null;
    queuedPointer = null;
    previous = null;
    if (resetCells) cells.clear();
    if (context && canvas) context.clearRect(0, 0, canvas.width, canvas.height);
    dirty = null;
  }

  function pause() {
    clear(false);
  }

  function resize() {
    clear();
    if (!canvas) return;
    const bounds = grid.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    size = parseFloat(getComputedStyle(grid).getPropertyValue('--hud-trail-size')) || 24;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    // Drawing coordinates stay in CSS pixels; the backing store must not stretch the lattice.
    context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  }

  function sync() {
    clear();
    if (!media.matches) {
      canvas?.remove();
      canvas = context = null;
      return;
    }
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'hud-grid-trail';
      canvas.setAttribute('aria-hidden', 'true');
      context = canvas.getContext('2d');
      if (!context) { canvas = null; return; }
      grid.appendChild(canvas);
    }
    resize();
  }

  function stamp(x, y) {
    const columns = Math.ceil(width / size);
    const rows = Math.ceil(height / size);
    for (let col = Math.max(0, Math.floor((x - radius) / size)); col < Math.min(columns, Math.ceil((x + radius) / size)); col++) {
      for (let row = Math.max(0, Math.floor((y - radius) / size)); row < Math.min(rows, Math.ceil((y + radius) / size)); row++) {
        const distance = Math.hypot((col + 0.5) * size - x, (row + 0.5) * size - y);
        if (distance >= radius) continue;
        const key = row * columns + col;
        const cell = cells.get(key) || { col, row, strength: 0, target: 0 };
        cell.target = Math.max(cell.target, Math.min(1, (1 - distance / radius) * 1.18));
        cells.set(key, cell);
      }
    }
  }

  function draw(time) {
    frame = null;
    if (!context || document.hidden) return;
    const dt = Math.min(time - lastFrame, 200);
    lastFrame = time;
    if (dirty) context.clearRect(dirty.x, dirty.y, dirty.w, dirty.h);
    let left = Infinity, top = Infinity, right = 0, bottom = 0;
    context.fillStyle = '#f3b9ac';
    for (const [key, cell] of cells) {
      cell.target = Math.max(0, cell.target - dt / 1050);
      const tau = cell.target > cell.strength ? 80 : 150;
      cell.strength += (cell.target - cell.strength) * (1 - Math.exp(-dt / tau));
      if (cell.target <= 0.01 && cell.strength <= 0.01) { cells.delete(key); continue; }
      const x = cell.col * size + 1;
      const y = cell.row * size + 1;
      context.globalAlpha = (1 - (1 - Math.min(cell.strength, 1)) ** 3) * 0.34 * (0.82 + ((cell.col * 17 + cell.row * 29) % 11) / 60);
      context.fillRect(x, y, size - 1, size - 1);
      left = Math.min(left, Math.floor(x)); top = Math.min(top, Math.floor(y));
      right = Math.max(right, Math.ceil(x + size)); bottom = Math.max(bottom, Math.ceil(y + size));
    }
    dirty = cells.size ? { x: left, y: top, w: right - left, h: bottom - top } : null;
    if (cells.size) frame = requestAnimationFrame(draw);
  }

  function processPointer(event) {
    pointerFrame = null;
    if (!canvas || !event || document.hidden) return;
    if (event.target.closest?.(occluders)) { previous = null; return; }
    const now = event.timeStamp || performance.now();
    const x = event.clientX, y = event.clientY;
    if (previous && now - previous.time < 120) {
      const steps = Math.min(24, Math.max(1, Math.ceil(Math.hypot(x - previous.x, y - previous.y) / (size * 0.55))));
      for (let step = 1; step <= steps; step++) stamp(previous.x + (x - previous.x) * step / steps, previous.y + (y - previous.y) * step / steps);
    } else {
      stamp(x, y);
    }
    previous = { x, y, time: now };
    if (frame === null && cells.size) { lastFrame = now; frame = requestAnimationFrame(draw); }
  }

  window.addEventListener('pointermove', event => {
    if (!canvas || !event.isPrimary || event.pointerType === 'touch' || document.hidden) return;
    queuedPointer = event;
    if (pointerFrame === null) {
      pointerFrame = requestAnimationFrame(() => {
        const latest = queuedPointer;
        queuedPointer = null;
        processPointer(latest);
      });
    }
  }, { passive: true });
  window.addEventListener('resize', resize);
  window.addEventListener('blur', () => clear());
  document.documentElement.addEventListener('pointerleave', () => { previous = null; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else if (context && cells.size && frame === null) {
      lastFrame = performance.now();
      frame = requestAnimationFrame(draw);
    }
  });
  document.addEventListener('pjax:send', () => clear());
  media.addEventListener('change', sync);
  sync();
})();

// Share projection measurements only within one frame. Position-only transforms
// do not notify ResizeObserver, and WAAPI does not dispatch CSS animation events.
(function () {
  "use strict";
  function createGeometryCache(onChange) {
    let rects = new WeakMap();
    let sample = 0;
    let resizeObserver = null;
    let watched = new Set();
    function invalidate() {
      rects = new WeakMap();
      onChange();
    }
    function isAnimating(element) {
      for (let node = element; node; node = node.parentElement) {
        if (node.getAnimations?.().some(animation =>
          animation.playState === "running" || animation.pending
        )) return true;
      }
      return false;
    }
    function disconnect() {
      resizeObserver?.disconnect();
      resizeObserver = null;
      rects = new WeakMap();
      watched.clear();
    }
    return {
      invalidate,
      animationChange(event) { if (watched.has(event.target)) invalidate(); },
      begin() { sample++; },
      read(element) {
        let cached = rects.get(element);
        if (!cached || cached.sample !== sample) {
          const animated = isAnimating(element);
          cached = { rect: element.getBoundingClientRect(), animated, sample };
          rects.set(element, cached);
        }
        return cached;
      },
      watch(elements) {
        disconnect();
        watched = new Set([document.documentElement, document.body]);
        elements.forEach(element => {
          for (let node = element; node; node = node.parentElement) watched.add(node);
        });
        if (!window.ResizeObserver) return;
        const observer = new ResizeObserver(() => {
          if (resizeObserver === observer) invalidate();
        });
        resizeObserver = observer;
        watched.forEach(node => { if (node) resizeObserver.observe(node); });
      },
      disconnect,
    };
  }

(function () {
  "use strict";
  const projection = document.getElementById("bg-title-projection");
  if (!projection || projection.dataset.initialized) return;
  projection.dataset.initialized = "true";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let activeAnchor = null;
  let observer = null;
  let frame = null;
  let resizeFrame = null;
  let fadeAnimation = null;
  let currentY = 0;
  let running = false;
  let navigating = false;
  let selectionDirty = false;
  let selectionAnimating = false;
  const visible = new Set();
  const headingTargets = new Set();
  const geometry = createGeometryCache(() => {
    selectionDirty = true;
    if (running && !reducedMotion.matches) schedule();
  });

  function tick() {
    frame = null;
    if (!running || reducedMotion.matches) return;
    geometry.begin();
    if (selectionDirty || selectionAnimating) { selectionDirty = false; selectVisibleAnchor(); }
    if (!activeAnchor?.isConnected) return;
    const measured = geometry.read(activeAnchor);
    const targetY = Math.max(-20, Math.min(20, (measured.rect.top - window.innerHeight * 0.3) * 0.05));
    currentY += (targetY - currentY) * 0.16;
    if (Math.abs(targetY - currentY) < 0.25) currentY = targetY;
    projection.style.transform = `translate3d(-50%, ${currentY}px, 0)`;
    if (currentY !== targetY || measured.animated || selectionAnimating) schedule();
  }

  function schedule() {
    if (running && !reducedMotion.matches && frame === null && !document.hidden) frame = requestAnimationFrame(tick);
  }

  function updateText(anchor) {
    if (!anchor || anchor === activeAnchor) return;
    activeAnchor = anchor;
    const text = anchor.textContent.trim().toUpperCase();
    if (projection.textContent !== text) {
      projection.textContent = text;
      fadeAnimation?.cancel();
      fadeAnimation = null;
      if (!reducedMotion.matches) {
        fadeAnimation = projection.animate(
          [{ opacity: 0.2 }, { opacity: 1 }],
          { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
        );
        const animation = fadeAnimation;
        const release = () => {
          if (fadeAnimation === animation) fadeAnimation = null;
        };
        animation.addEventListener("finish", release, { once: true });
        animation.addEventListener("cancel", release, { once: true });
      }
    }
    projection.style.display = "block";
    projection.style.opacity = "1";
    schedule();
  }

  function selectVisibleAnchor() {
    const activationY = window.innerHeight * 0.3;
    let anchor = null;
    let nearest = Infinity;
    selectionAnimating = false;
    for (const candidate of visible) {
      if (!candidate.isConnected) continue;
      const measured = geometry.read(candidate);
      selectionAnimating ||= measured.animated;
      const distance = Math.abs(measured.rect.top - activationY);
      if (distance < nearest) { nearest = distance; anchor = candidate; }
    }
    if (anchor) updateText(anchor);
  }

  function stop() {
    running = false;
    geometry.disconnect();
    selectionDirty = false;
    selectionAnimating = false;
    observer?.disconnect();
    observer = null;
    visible.clear();
    headingTargets.clear();
    cancelAnimationFrame(frame);
    cancelAnimationFrame(resizeFrame);
    frame = resizeFrame = null;
    activeAnchor = null;
    fadeAnimation?.cancel();
    fadeAnimation = null;
    projection.style.opacity = "0";
  }

  function start() {
    stop();
    if (navigating) return;
    const title = document.querySelector(".post-title, .page-title") || document.querySelector(".site-title");
    if (!title) { projection.style.display = "none"; return; }
    running = true;
    currentY = 0;
    projection.style.transform = "translate3d(-50%, 0, 0)";
    updateText(title);
    if (reducedMotion.matches) return;
    if (!window.IntersectionObserver) { refreshHeadingTargets(true); return; }
    const currentObserver = new IntersectionObserver((entries) => {
      if (!running || observer !== currentObserver) return;
      entries.forEach(entry => {
        if (!headingTargets.has(entry.target) || !entry.target.isConnected) return;
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
      geometry.invalidate();
    }, { rootMargin: "-18% 0% -67% 0%", threshold: 0 });
    observer = currentObserver;
    refreshHeadingTargets(true);
  }

  function refreshHeadingTargets(initial = false) {
    if (navigating || !running || reducedMotion.matches) return;
    const next = new Set(document.querySelectorAll(".post-title, .post-body h2, .post-body h3"));
    let changed = false;
    for (const target of headingTargets) {
      if (next.has(target)) continue;
      observer?.unobserve(target);
      headingTargets.delete(target);
      visible.delete(target);
      changed = true;
    }
    for (const target of next) {
      if (headingTargets.has(target)) continue;
      headingTargets.add(target);
      observer?.observe(target);
      changed = true;
    }
    if (!changed && !initial) return;
    const title = document.querySelector(".post-title, .page-title") || document.querySelector(".site-title");
    geometry.watch([title, ...headingTargets].filter(Boolean));
    if (!activeAnchor?.isConnected) updateText(title);
    geometry.invalidate();
  }

  function handleResize() {
    if (!running) return;
    geometry.invalidate();
    cancelAnimationFrame(frame);
    frame = null;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(start);
  }

  window.addEventListener("scroll", geometry.invalidate, { passive: true, capture: true });
  window.addEventListener("resize", handleResize);
  document.fonts?.addEventListener("loadingdone", geometry.invalidate);
  document.fonts?.ready?.then(geometry.invalidate);
  ["animationstart", "animationend", "animationcancel", "transitionrun", "transitionend", "transitioncancel"].forEach(type =>
    document.addEventListener(type, geometry.animationChange, true)
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = null; }
    else geometry.invalidate();
  });
  document.addEventListener("pjax:send", () => { navigating = true; stop(); });
  document.addEventListener("pjax:success", () => { navigating = false; start(); });
  document.addEventListener("pjax:error", () => { navigating = false; start(); });
  window.addEventListener("hexo-blog-decrypt", () => refreshHeadingTargets());
  reducedMotion.addEventListener("change", start);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();

(() => {
  "use strict";
  const node = document.getElementById("cursor-container");
  if (!node || node.dataset.initialized) return;
  const outer = node.querySelector("#cursor-outer");
  const dot = node.querySelector("#cursor-dot");
  const effect = node.querySelector("#cursor-effect");
  if (!outer || !dot || !effect) return;
  node.dataset.initialized = "true";
  const media = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1081px) and (prefers-reduced-motion: no-preference) and (prefers-contrast: no-preference)");
  const selector = "a, button, input, textarea, select, summary, [role='button'], .copy-btn, .toggle, .sidebar-toggle";
  let enabled = false;
  let frame = null;
  let pointerFrame = null;
  let queuedPointer = null;
  let rippleAnimation = null;
  let target = null;
  let pointer = null;
  let x = 0;
  let y = 0;
  let last = 0;
  let navigating = false;

  function findTarget(element) {
    // Images keep free follow, even inside an otherwise magnetic text/control link.
    if (element?.closest?.("img, picture")) return null;
    const candidate = element?.closest?.(selector);
    // Fancybox wrappers also exclude their padding and caption hit areas.
    if (candidate?.matches?.(".fancybox, [data-fancybox]")) return null;
    return candidate || null;
  }

  function setTarget(next) {
    target = next;
    node.classList.toggle("cursor-hover", !!target);
    schedule();
  }

  function draw(time) {
    frame = null;
    if (!enabled || !media.matches || !pointer || document.hidden) return;
    let tx = pointer.x;
    let ty = pointer.y;
    if (target?.isConnected) {
      const rect = target.getBoundingClientRect();
      tx += (rect.left + rect.width / 2 - tx) * 0.6;
      ty += (rect.top + rect.height / 2 - ty) * 0.6;
    }
    const dt = Math.min(0.025 * (time - last), 1);
    const dx = (tx - x) * dt;
    const dy = (ty - y) * dt;
    x += dx;
    y += dy;
    outer.style.transform = `translate3d(calc(${x}px - 50%), calc(${y}px - 50%), 0)`;
    last = time;
    if (Math.abs(tx - x) > 0.1 || Math.abs(ty - y) > 0.1) schedule();
    else outer.style.transform = `translate3d(calc(${tx}px - 50%), calc(${ty}px - 50%), 0)`;
    // Only a live hovered target keeps sampling after convergence. This discovers
    // silent transforms and later WAAPI starts without a global observer or RAF.
    if (target?.isConnected) schedule();
  }

  function schedule() {
    if (enabled && !document.hidden && frame === null && pointer) frame = requestAnimationFrame(draw);
  }

  function reset() {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(pointerFrame);
    rippleAnimation?.cancel();
    frame = pointerFrame = null;
    queuedPointer = null;
    rippleAnimation = null;
    pointer = target = null;
    node.classList.remove("cursor-visible", "cursor-hover");
    document.documentElement.classList.remove("custom-cursor-active");
  }

  function updatePointer(event) {
    pointerFrame = null;
    if (!enabled || !media.matches || document.hidden || !event) return;
    if (!pointer) {
      x = event.clientX;
      y = event.clientY;
      last = performance.now();
    }
    pointer = { x: event.clientX, y: event.clientY };
    node.classList.add("cursor-visible");
    document.documentElement.classList.add("custom-cursor-active");
    dot.style.transform = `translate3d(calc(${pointer.x}px - 50%), calc(${pointer.y}px - 50%), 0)`;
    schedule();
  }

  document.addEventListener("pointermove", event => {
    if (!enabled || document.hidden || !event.isPrimary || event.pointerType === "touch") return;
    queuedPointer = event;
    if (pointerFrame === null) {
      pointerFrame = requestAnimationFrame(() => {
        const latest = queuedPointer;
        queuedPointer = null;
        updatePointer(latest);
      });
    }
  }, { passive: true });
  document.addEventListener("mouseover", event => {
    if (!enabled || navigating || document.hidden) return;
    setTarget(findTarget(event.target));
  }, { passive: true });
  document.addEventListener("mouseout", event => {
    if (!enabled || navigating || document.hidden) return;
    setTarget(findTarget(event.relatedTarget));
  }, { passive: true });
  // Visual feedback precedes document-level asset/navigation gates, regardless
  // of script order. Do not weaken their stopImmediatePropagation or replay clicks.
  window.addEventListener("click", event => {
    if (!enabled || !pointer || event.detail === 0) return;
    rippleAnimation?.cancel();
    effect.style.left = `${event.clientX}px`;
    effect.style.top = `${event.clientY}px`;
    rippleAnimation = effect.animate(
      [
        { transform: "translate3d(-50%, -50%, 0) scale(0)", opacity: 1 },
        { transform: "translate3d(-50%, -50%, 0) scale(1)", opacity: 0 },
      ],
      { duration: 500, easing: "ease-out" }
    );
    rippleAnimation.addEventListener("finish", () => { rippleAnimation = null; }, { once: true });
  }, { capture: true, passive: true });
  document.documentElement.addEventListener("mouseleave", reset);
  window.addEventListener("blur", reset);
  window.addEventListener("scroll", schedule, { passive: true, capture: true });
  window.addEventListener("resize", schedule);
  // Navigation suspends magnetism, not free follow or the click ripple.
  document.addEventListener("pjax:send", () => { navigating = true; setTarget(null); });
  function finishNavigation() {
    navigating = false;
    // A queued move is newer than the last painted pointer. Hit-test the current
    // DOM once, so a stationary pointer needs no leave/re-entry after replacement.
    const position = queuedPointer ? { x: queuedPointer.clientX, y: queuedPointer.clientY } : pointer;
    const hovered = enabled && media.matches && !document.hidden && position
      ? findTarget(document.elementFromPoint(position.x, position.y))
      : null;
    setTarget(hovered || null);
  }
  document.addEventListener("pjax:success", finishNavigation);
  document.addEventListener("pjax:error", finishNavigation);
  document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); });
  media.addEventListener("change", () => { enabled = media.matches; reset(); });
  enabled = media.matches;
})();
})();
