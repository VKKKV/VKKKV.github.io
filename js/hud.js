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
  let pageFrame = null;
  let loadPromise = null;
  let loadBar = document.getElementById("pjax-load-bar");
  let statusNode = document.getElementById("pjax-status");
  let loadBarAnimation = null;
  let navigating = false;

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

  function initReveals() {
    revealObserver?.disconnect();
    revealObserver = null;
    if (reducedMotion.matches || !window.IntersectionObserver) return;

    const groups = [
      [".post-body h2", [{ opacity: 0, transform: "translateX(-40px)" }, { opacity: 1, transform: "none" }]],
      [".post-body h3, .post-body blockquote", [{ opacity: 0, transform: "translateY(30px)" }, { opacity: 1, transform: "none" }]],
      [".post-body .highlight, .post-body > pre, .post-body .code-container > pre", [{ opacity: 0, transform: "scale(0.95)" }, { opacity: 1, transform: "none" }]],
      [".post-body > p, .post-body > ul > li, .post-body > ol > li, .post-body > table tbody tr", [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }]],
      [".post-block", [{ opacity: 0, transform: "translateY(40px)" }, { opacity: 1, transform: "none" }]],
    ];
    const frames = new WeakMap();
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        revealObserver?.unobserve(entry.target);
        animateIn(entry.target, frames.get(entry.target));
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.01 });
    groups.forEach(([selector, keyframes]) => {
      document.querySelectorAll(selector).forEach(element => {
        frames.set(element, keyframes);
        revealObserver.observe(element);
      });
    });
  }

  function initPage() {
    pageFrame = null;
    if (navigating || reducedMotion.matches) return;
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
    if (reducedMotion.matches || !desktopMotion.matches) return;
    try {
      await loadLenis();
    } catch (error) {
      console.warn("[motion] Using native scrolling:", error);
    }
    schedulePage();
  }

  // NexT uses Anime.js for these controls. Capture them so only Lenis owns page scrolling.
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
    if (!reducedMotion.matches && desktopMotion.matches) boot();
  };
  reducedMotion.addEventListener("change", syncMotionPreference);
  desktopMotion.addEventListener("change", syncMotionPreference);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();

(function () {
  "use strict";
  if (window.__hudGridInit) return;
  window.__hudGridInit = true;
  // ljj.world uses a 40px static grid and a separate 24px, non-glowing pixel trail.
  const media = matchMedia('(min-width: 1081px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  const cells = new Map();
  const size = 24;
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
    // Deliberately use CSS-pixel resolution, matching the reference's square edges.
    canvas.width = Math.ceil(innerWidth);
    canvas.height = Math.ceil(innerHeight);
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
      document.querySelector('.hud-grid').appendChild(canvas);
    }
    resize();
  }

  function stamp(x, y) {
    const columns = Math.ceil(canvas.width / size);
    const rows = Math.ceil(canvas.height / size);
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
      const x = cell.col * size + 1.25;
      const y = cell.row * size + 1.25;
      context.globalAlpha = (1 - (1 - Math.min(cell.strength, 1)) ** 3) * 0.34 * (0.82 + ((cell.col * 17 + cell.row * 29) % 11) / 60);
      context.fillRect(x, y, size - 2.5, size - 2.5);
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
  const visible = new Set();

  function tick() {
    frame = null;
    if (!activeAnchor?.isConnected || reducedMotion.matches) return;
    const targetY = Math.max(-20, Math.min(20, (activeAnchor.getBoundingClientRect().top - window.innerHeight * 0.3) * 0.05));
    currentY += (targetY - currentY) * 0.16;
    if (Math.abs(targetY - currentY) < 0.25) currentY = targetY;
    projection.style.transform = `translate3d(-50%, ${currentY}px, 0)`;
    if (currentY !== targetY) schedule();
  }

  function schedule() {
    if (frame === null && !document.hidden) frame = requestAnimationFrame(tick);
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
    const anchor = Array.from(visible).sort((a, b) =>
      Math.abs(a.getBoundingClientRect().top - activationY) -
      Math.abs(b.getBoundingClientRect().top - activationY)
    )[0];
    if (anchor) updateText(anchor);
  }

  function stop() {
    observer?.disconnect();
    observer = null;
    visible.clear();
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
    const title = document.querySelector(".post-title, .page-title") || document.querySelector(".site-title");
    if (!title) { projection.style.display = "none"; return; }
    currentY = 0;
    projection.style.transform = "translate3d(-50%, 0, 0)";
    updateText(title);
    if (reducedMotion.matches || !window.IntersectionObserver) return;
    observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
      selectVisibleAnchor();
    }, { rootMargin: "-18% 0% -67% 0%", threshold: 0 });
    document.querySelectorAll(".post-title, .post-body h2, .post-body h3").forEach(el => observer.observe(el));
  }

  function handleResize() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(start);
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", handleResize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = null; }
    else schedule();
  });
  document.addEventListener("pjax:send", stop);
  document.addEventListener("pjax:success", start);
  document.addEventListener("pjax:error", start);
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

  function draw(time) {
    frame = null;
    if (!enabled || !pointer) return;
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
  }

  function schedule() {
    if (frame === null && pointer) frame = requestAnimationFrame(draw);
  }

  function reset() {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(pointerFrame);
    rippleAnimation?.cancel();
    frame = pointerFrame = null;
    queuedPointer = null;
    rippleAnimation = null;
    pointer = target = null;
    node.classList.remove("cursor-visible", "cursor-hover", "cursor-ripple");
    document.documentElement.classList.remove("custom-cursor-active");
  }

  function updatePointer(event) {
    pointerFrame = null;
    if (!enabled || !event) return;
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
    if (!enabled || !event.isPrimary || event.pointerType === "touch") return;
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
    if (!enabled) return;
    target = event.target.closest(selector);
    node.classList.toggle("cursor-hover", !!target);
    schedule();
  }, { passive: true });
  document.addEventListener("mouseout", event => {
    if (!enabled) return;
    target = event.relatedTarget?.closest?.(selector) || null;
    node.classList.toggle("cursor-hover", !!target);
    schedule();
  }, { passive: true });
  document.addEventListener("click", event => {
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
  }, { passive: true });
  document.documentElement.addEventListener("mouseleave", reset);
  window.addEventListener("blur", reset);
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  document.addEventListener("pjax:send", reset);
  document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); });
  media.addEventListener("change", () => { enabled = media.matches; reset(); });
  enabled = media.matches;
})();
