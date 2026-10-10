/* Reading-safe light fields: cached motion, geometry-owned Gaussian exclusions. */
(() => {
  'use strict';
  if (window.__effectExperiment) return;
  window.__effectExperiment = true;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width: 1200px)');
  const contrast = matchMedia('(prefers-contrast: more), (forced-colors: active)');
  const print = matchMedia('print');
  const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
  let enabled = true;
  let preset = 'refined';
  let intensity = 80;
  let dynamic = true; // Refined preference; Original08 is always static.
  let flow = 'lava';
  let composition = 'random'; // Latent until Refined lava is selected.
  let travel = 'full'; // Only dynamic lava changes its clipping area.
  let rendererChoice = 'pixi';
  let rendererSelect;
  // One entropy draw per document. Never persist/reseed in refresh or observers.
  const entropy = new Uint32Array(1);
  try { window.crypto.getRandomValues(entropy); }
  catch { entropy[0] = Math.floor(Math.random() * 4294967296); }
  let seed = entropy[0];
  const random = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const between = (a, b) => (a + (b - a) * random()).toFixed(3);
  const radius = () => Array.from({ length: 2 }, () => {
    const a = Number(between(28, 72)), b = Number(between(28, 72));
    return `${a}% ${(100 - a).toFixed(3)}% ${b}% ${(100 - b).toFixed(3)}%`;
  }).join(' / ');
  const descriptors = ['left', 'right'].map(() => {
    const count = 2 + Math.floor(random() * 3);
    return Array.from({ length: count }, (_, i) => {
      const props = {
        '--lava-width': `${between(95, 145)}%`, '--lava-height': `${between(22, 36)}%`,
        '--lava-top': `${between(27, 43)}%`, '--lava-edge': `${between(-32, -8)}%`,
        '--lava-duration': `${between(24, 40)}s`, '--lava-delay': `${between(-40, -1)}s`
      };
      for (let phase = 0; phase < 4; phase++) {
        props[`--lava-radius-${phase}`] = radius();
        const direction = i % 2 ? -1 : 1;
        const y = phase === 0 ? direction * Number(between(78, 100))
          : phase === 2 ? -direction * Number(between(78, 100)) : Number(between(-12, 12));
        props[`--lava-transform-${phase}`] = `translate(${between(-16, 16)}%, ${y}%) rotate(${between(-24, 24)}deg) skewX(${between(-16, 16)}deg) scale(${between(.70, 1.20)}, ${between(.82, 1.55)})`;
      }
      return Object.freeze(props);
    });
  });
  // Derive broader paths from the same cached draws, never reroll on switching.
  const widePath = (props, i) => {
    const result = {
      '--lava-wide-width': `${72 + (parseFloat(props['--lava-width'] || 125) - 95) * .4}%`,
      '--lava-wide-height': `${20 + (parseFloat(props['--lava-height'] || 28) - 22) * .5}%`
    };
    for (let phase = 0; phase < 4; phase++) {
      const t = (props[`--lava-transform-${phase}`] || [
        'translate(-8%, 90%) rotate(-14deg) skewX(-12deg) scale(.88, 1.18)',
        'translate(12%, -8%) rotate(12deg) skewX(15deg) scale(.70, 1.55)',
        'translate(-4%, -90%) rotate(24deg) skewX(-8deg) scale(1.20, .82)',
        'translate(16%, 0%) rotate(-18deg) skewX(16deg) scale(.76, 1.42)'
      ][(phase + (i % 2 ? 2 : 0)) % 4]).match(/[-\d.]+/g).map(Number);
      const direction = i % 2 ? -1 : 1;
      const x = (phase < 2 ? -1 : 1) * (.17 + Math.abs(t[0]) / 320);
      const y = phase === 0 ? direction * (.37 + Math.abs(t[1]) / 4000)
        : phase === 2 ? -direction * (.37 + Math.abs(t[1]) / 4000) : t[1] / 1200;
      // calc stays literal in runtime custom props; translation uses measured
      // parent CSS pixels, not the percentage-sized child's own dimensions.
      result[`--lava-wide-transform-${phase}`] = `translate(-50%, -50%) translate(calc(var(--lava-area-width) * ${x.toFixed(4)}), calc(var(--lava-area-height) * ${y.toFixed(4)})) rotate(${t[2]}deg) skewX(${t[3]}deg) scale(${t[4]}, ${t[5]})`;
    }
    return Object.freeze(result);
  };
  const wideDescriptors = descriptors.map(side => side.map(widePath));
  const fixedWide = [{}, {}].map(widePath);
  let panel, host, toggle, motion, flowSelect, compositionSelect, travelSelect, select, range, output, status;
  let nodes = [];
  let observer, fullObserver;
  let frame = 0;
  let navigating = false;
  let pageActive = true;
  const transitions = new Map();
  const main = () => document.querySelector('.main-inner');
  const eligible = node => node && (node.matches('.index') || document.querySelector('[data-effects-lab]'));
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function clearField() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    observer?.disconnect();
    observer = undefined;
    fullObserver?.disconnect(); fullObserver = undefined;
    nodes.forEach(node => {
      node.__renderer?.stop();
      node.__renderer?.dispose();
      node.getAnimations?.({ subtree: true }).forEach(animation => animation.cancel());
      node.remove();
    });
    nodes = [];
    delete document.body.dataset.meshChromeGlass;
  }
  function updateControls(message) {
    if (!panel) return;
    const toggleText = enabled ? '关闭留白 Mesh' : '开启留白 Mesh';
    if (toggle.textContent !== toggleText) toggle.textContent = toggleText;
    toggle.setAttribute('aria-pressed', String(enabled));
    motion.disabled = preset !== 'refined';
    flowSelect.disabled = preset !== 'refined';
    flowSelect.value = flow;
    compositionSelect.disabled = preset !== 'refined' || flow !== 'lava' || !dynamic;
    compositionSelect.value = composition;
    travelSelect.disabled = preset !== 'refined' || flow !== 'lava' || !dynamic;
    travelSelect.value = travel;
    if (rendererSelect) {
      rendererSelect.value = rendererChoice;
      rendererSelect.disabled = !isFull();
    }
    const motionText = preset !== 'refined' ? 'Original08 · 静态' : dynamic ? '切换为静态光场' : '开启动态光场';
    if (motion.textContent !== motionText) motion.textContent = motionText;
    motion.setAttribute('aria-pressed', String(preset === 'refined' && dynamic));
    select.value = preset;
    range.value = String(intensity);
    output.value = `${intensity}%`;
    if (message !== undefined && status.textContent !== message) status.textContent = message;
  }
  function mount() {
    const target = main();
    if (!eligible(target)) {
      panel?.remove();
      panel = host = undefined;
      return false;
    }
    if (target === host && (!window.__meshDebugControls || panel?.isConnected)) return true;
    panel?.remove();
    host = target;
    // Production has no settings DOM or hidden focusable controls.
    // Explicit test/debug opt-in retains comparison coverage only.
    if (!window.__meshDebugControls) { panel = undefined; return true; }
    panel = el('div', 'effect-controls');
    panel.dataset.effect = 'mesh';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', '留白 Mesh 对照设置');
    toggle = el('button', 'effect-toggle');
    toggle.type = 'button';
    toggle.addEventListener('click', () => { enabled = !enabled; refresh(); });
    motion = el('button', 'effect-motion');
    motion.type = 'button';
    motion.setAttribute('aria-label', 'Refined 动态光场');
    motion.addEventListener('click', () => {
      if (preset !== 'refined') return;
      dynamic = !dynamic; syncMotion(); geometry(); updateControls();
    });
    const presetLabel = el('label', '', '预设');
    select = el('select', 'effect-preset');
    for (const [value, label] of [['original08', 'Original08'], ['refined', 'Refined']]) {
      const option = el('option', '', label);
      option.value = value;
      select.append(option);
    }
    select.addEventListener('change', () => { preset = select.value; refresh(); });
    presetLabel.append(select);
    const flowLabel = el('label', '', '运动风格');
    flowSelect = el('select', 'effect-flow');
    flowSelect.setAttribute('aria-label', 'Refined 运动风格');
    for (const [value, label] of [['drift', '缓慢漂移'], ['lava', '熔岩流动']]) {
      const option = el('option', '', label);
      option.value = value; flowSelect.append(option);
    }
    // Keep controls, clipping parents and child identity: CSS owns the motion.
    flowSelect.addEventListener('change', () => {
      flow = flowSelect.value; syncMotion(); geometry(); updateControls();
    });
    flowLabel.append(flowSelect);
    const compositionLabel = el('label', '', '构图');
    compositionSelect = el('select', 'effect-composition');
    compositionSelect.setAttribute('aria-label', '熔岩构图');
    for (const [value, label] of [['random', '每次打开随机'], ['fixed', '固定（原版）']]) {
      const option = el('option', '', label);
      option.value = value; compositionSelect.append(option);
    }
    compositionSelect.addEventListener('change', () => {
      composition = compositionSelect.value;
      if (isFull()) populateFull(nodes[0]);
      else nodes.forEach((node, i) => populateLava(node, i));
      updateControls();
    });
    compositionLabel.append(compositionSelect);
    const travelLabel = el('label', '', '范围');
    travelSelect = el('select', 'effect-travel');
    travelSelect.setAttribute('aria-label', '熔岩范围');
    for (const [value, label] of [['full', '全背景（推荐）'], ['wide', '宽域'], ['compact', '局部（旧范围）']]) {
      const option = el('option', '', label);
      option.value = value; travelSelect.append(option);
    }
    travelSelect.addEventListener('change', () => {
      travel = travelSelect.value; syncMotion(); geometry(); updateControls();
    });
    travelLabel.append(travelSelect);
    const intensityLabel = el('label', '', '强度');
    range = el('input', 'effect-intensity');
    range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1';
    range.id = 'mesh-intensity';
    range.setAttribute('aria-label', 'Mesh 强度');
    output = el('output', 'effect-intensity-output');
    output.setAttribute('for', range.id);
    // Update opacity in place: no node reconstruction, lost focus or RO churn.
    range.addEventListener('input', () => {
      intensity = Number(range.value);
      nodes.forEach(node => { node.style.opacity = String(intensity / 100); });
      updateControls();
    });
    intensityLabel.append(range, output);
    const reset = el('button', 'effect-reset', '重置');
    reset.type = 'button';
    reset.addEventListener('click', () => { enabled = true; preset = 'refined'; intensity = 80; dynamic = true; flow = 'lava'; composition = 'random'; travel = 'full'; rendererChoice = 'pixi'; refresh(); });
    status = el('span', 'effect-state');
    status.setAttribute('role', 'status');
    const rendererLabel = el('label', '', '渲染器');
    rendererSelect = el('select', 'effect-renderer');
    rendererSelect.setAttribute('aria-label', '全背景渲染器');
    for (const [value, label] of [['pixi', 'PixiJS GPU'], ['canvas', 'Canvas2D 对照']]) {
      const option = el('option', '', label); option.value = value; rendererSelect.append(option);
    }
    rendererSelect.addEventListener('change', () => { rendererChoice = rendererSelect.value; refresh(); rendererSelect.focus({ preventScroll: true }); });
    rendererLabel.append(rendererSelect);
    panel.append(toggle, presetLabel, flowLabel, compositionLabel, travelLabel, rendererLabel, motion, intensityLabel, reset, status);
    target.prepend(panel);
    updateControls();
    return true;
  }
  function blocked() {
    if (!pageActive) return '页面已离开：留白装饰关闭。';
    if (navigating) return '导航中：留白装饰暂停。';
    if (print.matches) return '打印模式：留白装饰关闭。';
    if (reduced.matches) return '减少动态效果偏好：留白装饰关闭。';
    if (contrast.matches) return '高对比度模式：留白装饰关闭。';
    if (!desktop.matches) return '小视口（小于 1200px）：留白装饰不可用，正文保持原版。';
    if (!enabled) return '已关闭 · Original08 / Refined 仅影响两侧留白。';
    if (transitions.size) return '布局调整中：留白装饰暂停。';
    return '';
  }
  function geometry() {
    if (!host?.isConnected || blocked()) return;
    if (isFull()) { fullGeometry(); return; }
    // Union the actual main/content rectangles, not a guessed article width.
    const rects = [host, ...host.querySelectorAll('.content-wrap, .post-block')]
      .map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0);
    if (!rects.length) return;
    const viewport = window.visualViewport;
    const width = document.documentElement.clientWidth;
    const left = Math.max(0, viewport?.offsetLeft || 0);
    const right = Math.min(width, viewport ? left + viewport.width : width);
    const contentLeft = Math.min(...rects.map(rect => rect.left));
    const contentRight = Math.max(...rects.map(rect => rect.right));
    const wide = preset === 'refined' && dynamic && flow === 'lava' && travel === 'wide';
    const limit = preset === 'original08' ? Math.max(0, (width - 1160) / 2) : wide ? Infinity : 320;
    const widths = [Math.max(0, Math.min(limit, contentLeft - left - 24)),
      Math.max(0, Math.min(limit, right - contentRight - 24))];
    for (let i = 0; i < 2; i++) {
      const node = nodes[i];
      if (!node) continue;
      // A large probe avoids 1px layout rounding being multiplied across a
      // broad margin at fractional CSS zoom. Verify the resulting width and
      // shrink by a layout quantum only when it exceeds the safe viewport bound.
      node.style.display = '';
      const probe = 1024;
      node.style.width = `${probe}px`;
      const unit = node.getBoundingClientRect().width / probe || 1;
      let cssWidth = widths[i] / unit;
      node.style.width = `${cssWidth}px`;
      const measuredWidth = node.getBoundingClientRect().width;
      if (measuredWidth > widths[i]) {
        cssWidth = Math.max(0, cssWidth - (measuredWidth - widths[i]) / unit - 1 / 64);
        node.style.width = `${cssWidth}px`;
      }
      node.style.display = widths[i] >= 1 ? '' : 'none';
      if (i === 0) node.style.left = `${left / unit}px`;
      else node.style.right = `${(width - right) / unit}px`;
      if (wide) {
        const height = viewport?.height || window.innerHeight;
        const top = viewport?.offsetTop || 0;
        node.style.top = `${(top + height * .02) / unit}px`;
        node.style.bottom = `${(window.innerHeight - top - height * .98) / unit}px`;
        node.style.setProperty('--lava-area-width', `${widths[i] / unit}px`);
        node.style.setProperty('--lava-area-height', `${height * .96 / unit}px`);
      } else {
        for (const key of ['top', 'bottom', '--lava-area-width', '--lava-area-height']) node.style.removeProperty(key);
      }
    }
    updateControls(widths.some(value => value >= 1)
      ? `显示 ${preset === 'original08' ? 'Original08 · 静态' : dynamic ? document.hidden ? 'Refined · 动态（后台暂停）' : 'Refined · 动态' : 'Refined · 静态'}留白，正文安全间距 ≥ 24px。`
      : '当前布局没有安全留白：装饰不可用，正文保持原版。');
  }
  function syncMotion() {
    if (nodes.length && (isFull() !== (nodes[0].dataset.mesh === 'full-background'))) { refresh(); return; }
    if (isFull()) {
      nodes.forEach(node => {
        node.dataset.paused = String(document.hidden);
        if (node.__renderer) document.hidden ? node.__renderer.stop() : node.__renderer.start();
        else node.getAnimations({ subtree: true }).forEach(a => document.hidden ? a.pause() : a.play());
      });
      return;
    }
    nodes.forEach((node, side) => {
      applyTravel(node, side);
      node.dataset.motion = preset === 'refined' && dynamic ? 'dynamic' : 'static';
      node.dataset.paused = String(document.hidden);
      node.dataset.flow = flow;
    });
  }
  function schedule() {
    if (nodes.length && !frame) frame = requestAnimationFrame(() => { frame = 0; geometry(); });
  }
  function applyTravel(node, side) {
    node.dataset.travel = travel;
    [...node.children].forEach((child, i) => {
      const props = composition === 'random' ? wideDescriptors[side][i] : fixedWide[i];
      for (const [key, value] of Object.entries(props)) {
        if (travel === 'wide') child.style.setProperty(key, value);
        else child.style.removeProperty(key);
      }
    });
  }
  function populateLava(node, side) {
    node.getAnimations?.({ subtree: true }).forEach(animation => animation.cancel());
    [...node.children].forEach(child => child.remove());
    node.dataset.composition = composition;
    if (preset !== 'refined') return;
    const items = composition === 'random' ? descriptors[side] : [{}, {}];
    items.forEach((props, i) => {
      const child = el('div', `mesh-lava mesh-lava-${i % 2 ? 'b' : 'a'}`);
      for (const [key, value] of Object.entries(props)) child.style.setProperty(key, value);
      node.append(child);
    });
    applyTravel(node, side);
  }
  // One coherent viewport root. No old side fields in full mode.
  const isFull = () => preset === 'refined' && dynamic && flow === 'lava' && travel === 'full';
  const protectedSelector = '.post-block, .header, .sidebar, .footer, .search-pop-overlay, .search-popup, .effect-controls';
  const protectedNodes = () => [...document.querySelectorAll(protectedSelector)];
  const fullPaths = descriptors.flatMap((side, sideIndex) => [...side, side[0]].map((props, i) => {
    const t = props['--lava-transform-0'].match(/[-\d.]+/g).map(Number);
    return Object.freeze({ props, palette: sideIndex * 2 + i % 2,
      phase: Math.abs(t[2]) / 24 * Math.PI * 2 + i * 1.7 + sideIndex,
      direction: (i + sideIndex) % 2 ? -1 : 1,
      warp: .04 + Math.abs(t[0]) / 320,
      width: 34 + (parseFloat(props['--lava-width']) - 95) * .32,
      height: 42 + (parseFloat(props['--lava-height']) - 22) * 1.1 });
  }));
  function populateFull(node) {
    if (!node) return;
    node.getAnimations?.({ subtree: true }).forEach(a => a.cancel());
    [...node.children].forEach(child => child.remove());
    node.dataset.composition = composition;
    const items = composition === 'random' ? fullPaths : fullPaths.filter((_, i) => i === 0 || i === 1 || i === descriptors[0].length + 1 || i === descriptors[0].length + 2);
    if (node.__renderer) { node.__renderer.setPaths(items); node.append(node.__renderer.canvas); geometry(); return; }
    for (const path of items) {
      const child = el('div', 'mesh-full-blob');
      child.style.width = `${path.width}%`; child.style.height = `${path.height}%`;
      child.append(el('div', `mesh-full-paint mesh-full-palette-${path.palette}`));
      node.append(child); child.__fullPath = path;
    }
    geometry();
  }
  function fullGeometry() {
    const node = nodes[0];
    if (!node) return;
    if (node.__renderer?.state === 'failed' || node.__renderer?.state === 'retired') {
      node.style.visibility='hidden'; updateControls(node.dataset.renderer === 'pixi-webgl' || rendererChoice === 'pixi' ? 'PixiJS GPU 资源失败：安全关闭；可选 Canvas2D 对照。' : 'Canvas2D 资源失败：效果安全关闭；可关闭后重新开启。'); return;
    }
    // Fail closed, never use an unmasked full-screen fallback.
    if (!node.__renderer && ((!window.CSS?.supports('mask-composite', 'intersect') || !window.CSS?.supports('clip-path', "path('M0,0H10V10H0Z')")) || typeof node.animate !== 'function')) {
      node.style.visibility = 'hidden'; updateControls('全背景遮罩不可用：安全关闭，不绘制正文。'); return;
    }
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    // Fixed root has only body/html zoom ancestors. Cache the measured layout
    // quantum; scroll, title text and pointer movement never need a width probe.
    const zoomKey = `${vw}:${vh}:${getComputedStyle(document.body).zoom}:${getComputedStyle(document.documentElement).zoom}`;
    if (node.__zoomKey !== zoomKey) {
      node.style.width = '1024px';
      node.__unit = node.getBoundingClientRect().width / 1024 || 1;
      node.__zoomKey = zoomKey;
    }
    const unit = node.__unit;
    const width = vw / unit, height = vh / unit;
    node.__renderer?.resize(width, height, unit);
    const bounds = { left: 0, top: 0 };
    // Protected rectangles are read below before any field-size/mask writes.
    const holes = protectedNodes().flatMap(n => {
      if (document.body.dataset.meshChromeGlass === 'true' && n.matches('.header, .sidebar, .footer')) return [];
      const style = getComputedStyle(n);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return [];
      const r = n.getBoundingClientRect();
      return [{ left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height, radius:(parseFloat(style.borderTopLeftRadius) || 0)*unit }];
    })
      .filter(r => r.width > 0 && r.height > 0 && r.right > -66 && r.left < vw + 66);
    // A closed sidebar occupies only the outer viewport's already-transparent
    // core. Extend that fixed edge exclusion across the retained buffer: its
    // vertical corners cannot affect visible pixels, and scroll no longer makes
    // it look like changing document geometry.
    for (const r of holes) if ((r.right <= 8 || r.left >= vw-8) && r.top <= 0 && r.bottom >= vh) {
      r.top = -vh; r.bottom = vh*2; r.height = vh*3; r.edge = true;
    }
    node.style.width = `${width}px`; node.style.height = `${height}px`;
    if (node.__renderer?.updateGeometry) {
      node.__renderer.updateGeometry(holes);
      node.__renderer.start();
      node.style.maskImage = node.style.webkitMaskImage = 'none';
      node.style.clipPath = 'none';
      node.style.visibility = node.__renderer.ready && !document.hidden && !blocked() ? 'visible' : 'hidden';
      updateControls(node.__renderer.state === 'failed' ? 'PixiJS GPU 失败：安全关闭，可选 Canvas2D 对照。' : 'PixiJS WebGL · 原生 DPR / GPU 形变与 Gaussian 联合遮罩。');
      return;
    }
    const scroll = window.scrollY;
    const signature = JSON.stringify([width, height, holes.map(r => ({ ...r, top: r.edge ? -vh : r.top + scroll, bottom: r.edge ? vh*2 : r.bottom + scroll }))]);
    const shifted = node.__maskAnchor != null ? scroll - node.__maskAnchor : Infinity;
    const rebuildMask = node.__maskGeometry !== signature || Math.abs(shifted) > vh * .75;
    const clipSignature = JSON.stringify([width, height, holes]);
    if (node.__clipGeometry !== clipSignature || rebuildMask) {
      // Only changed protected geometry regenerates the Gaussian mask. HUD text,
      // cursor movement and unrelated mutations cannot invalidate this cache.
      // Gaussian-convolved OUTSIDE exclusion, followed by exact core subtraction.
      // Blur the opaque UNION once, never separate holes (no overlap/XOR refill).
      // The 18px dilation puts the core into the Gaussian's near-zero plateau;
      // the final clip still guarantees zero core pixels before backdrop sampling.
      const shape = (r, pad) => `<rect x="${(r.left-bounds.left-pad)/unit}" y="${(r.top-bounds.top-pad)/unit}" width="${(r.width+pad*2)/unit}" height="${(r.height+pad*2)/unit}" rx="${(r.radius+pad)/unit}" fill="black"/>`;
      // Retain the exact sigma=12 Gaussian union in a 3-viewport scroll
      // buffer. Normal scrolling moves the mask instead of filtering/reencoding
      // another viewport image; layout/zoom changes still rebuild immediately.
      if (rebuildMask) {
        const svg = `<svg xmlns="http:&#47;&#47;www.w3.org/2000/svg" width="${width}" height="${height*3}" viewBox="0 ${-height} ${width} ${height*3}"><defs><filter id="feather" filterUnits="userSpaceOnUse" x="${-48/unit}" y="${-height-48/unit}" width="${width+96/unit}" height="${height*3+96/unit}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${12/unit}"/></filter><mask id="holes" maskUnits="userSpaceOnUse" x="0" y="${-height}" width="${width}" height="${height*3}"><rect y="${-height}" width="${width}" height="${height*3}" fill="white"/><g filter="url(#feather)">${holes.map(r => shape(r,18)).join('')}</g>${holes.map(r => shape(r,1.5)).join('')}</mask></defs><rect y="${-height}" width="${width}" height="${height*3}" fill="white" mask="url(#holes)"/></svg>`;
        const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}"), linear-gradient(to right, transparent 8px, black 48px, black calc(100% - 48px), transparent calc(100% - 8px)), linear-gradient(to bottom, transparent 8px, black 48px, black calc(100% - 48px), transparent calc(100% - 8px))`;
        if (node.__renderer) node.__renderer.mask(svg, width, height, unit);
        else { node.style.maskImage = mask; node.style.webkitMaskImage = mask; }
        node.style.maskSize = `${width}px ${height*3}px, 100% 100%, 100% 100%`;
        node.__maskGeometry = signature; node.__maskAnchor = scroll;
        node.dataset.maskUpdates = String(Number(node.dataset.maskUpdates || 0) + 1);
      }
      // Also clip the exact union complement before backdrop sampling. Chromium
      // may sample masked composited pixels through backdrop-filter unless the
      // layer's paint bounds are clipped as well; article styles remain untouched.
      const boxes = holes.map(r => [(r.left-bounds.left-1.5)/unit, (r.top-bounds.top-1.5)/unit, (r.right-bounds.left+1.5)/unit, (r.bottom-bounds.top+1.5)/unit, (r.radius+1.5)/unit]);
      // Conservative rounded-union complement, 1px bands only at corners.
      // Each strip excludes the widest section of the rounded core in that strip.
      const cuts = boxes.flatMap(b => {
        const radius = Math.min(b[4], (b[2]-b[0])/2, (b[3]-b[1])/2);
        b[4] = radius;
        return [b[1], b[3], ...Array.from({length:Math.ceil(radius)+1}, (_,i) => [b[1]+Math.min(i,radius),b[3]-Math.min(i,radius)]).flat()];
      });
      const ys = [...new Set([0, height, ...cuts.map(y => Math.max(0,Math.min(height,y)))])].sort((a,b) => a-b);
      let safePath = '';
      for (let i = 0; i < ys.length-1; i++) {
        const y = ys[i], bottom = ys[i+1], mid = (y+bottom)/2;
        const spans = boxes.filter(b => b[1] < mid && b[3] > mid).map(b => {
          const radius=b[4], nearest=Math.min(radius, bottom-b[1], b[3]-y);
          const inset=radius-Math.sqrt(Math.max(0,radius*radius-(radius-nearest)**2));
          return [Math.max(0,b[0]+inset),Math.min(width,b[2]-inset)];
        }).filter(b => b[1]>b[0]).sort((a,b) => a[0]-b[0]);
        let x = 0;
        for (const [left,right] of [...spans, [width,width]]) {
          if (left > x) safePath += `M${x},${y}H${left}V${bottom}H${x}Z`;
          x = Math.max(x,right);
        }
      }
      if (node.__renderer) node.__renderer.clip(safePath);
      else node.style.clipPath = safePath ? `path('${safePath}')` : 'inset(50%)';
      node.__clipGeometry = clipSignature;
    }
    node.__maskRasterOffset = -height - (scroll-node.__maskAnchor)/unit;
    if (node.__renderer) {
      node.__renderer.offset = -node.__maskRasterOffset;
      node.__renderer.start();
      node.style.visibility = node.__renderer.ready && !document.hidden && !blocked() ? 'visible' : 'hidden';
      updateControls(node.__renderer.state === 'failed' ? 'Canvas2D 资源失败：效果安全关闭；可关闭后重新开启。' : '全背景 · 缓存 Canvas2D 熔岩曲线 · 核心零绘制 / Gaussian 柔化边界。');
      return;
    }
    node.style.maskPosition = `0px ${node.__maskRasterOffset}px, 0px 0px, 0px 0px`;
    if (!getComputedStyle(node).maskImage.includes('data:image/svg+xml')) {
      node.style.visibility = 'hidden'; updateControls('全背景遮罩失效：安全关闭。'); return;
    }
    const size = `${width}:${height}`;
    for (const child of node.children) {
      if (child.__fullSize === size) continue;
      const path = child.__fullPath, paint = child.children[0];
      const old = child.getAnimations()[0], time = old?.currentTime;
      const oldY = paint.getAnimations()[0], timeY = oldY?.currentTime;
      old?.cancel(); oldY?.cancel();
      const frames = Array.from({ length: 97 }, (_, k) => {
        const theta = k / 96 * Math.PI * 2 * path.direction + path.phase;
        const x = .5 + .40 * Math.cos(theta) + path.warp * Math.sin(2 * theta + path.phase);
        return { offset: k / 96, transform: `translate(-50%, -50%) translateX(${(x-.5)*width}px)` };
      });
      const a = child.animate(frames, { duration: parseFloat(path.props['--lava-duration']) * 1000, delay: parseFloat(path.props['--lava-delay']) * 1000, iterations: Infinity, easing: 'linear' });
      // Separate transform owners: incommensurate horizontal/vertical
      // periods inspired by reilar/meta-balls (Apache-2.0), not four-waypoint
      // rise/return. Independent axes cannot fight for one transform property.
      const yFrames = Array.from({ length: 97 }, (_, k) => {
        const theta = k / 96 * Math.PI * 2 * -path.direction + path.phase * 1.31;
        const y = .38 * Math.sin(theta) + path.warp * Math.cos(3 * theta - path.phase);
        return { offset: k / 96, transform: `translateY(${y*height}px) rotate(${13*Math.sin(theta+path.phase)}deg) skewX(${9*Math.sin(2*theta-path.phase)}deg) scale(${.90+.10*Math.sin(2*theta)}, ${1+.16*Math.cos(theta)})` };
      });
      const ay = paint.animate(yFrames, { duration: parseFloat(path.props['--lava-duration']) * 1000 * Math.sqrt(5), delay: parseFloat(path.props['--lava-delay']) * 731, iterations: Infinity, easing: 'linear' });
      if (time != null) a.currentTime = time;
      if (timeY != null) ay.currentTime = timeY;
      if (document.hidden) { a.pause(); ay.pause(); }
      child.__fullSize = size;
    }
    node.style.visibility = 'visible';
    updateControls('全背景 · 熔岩曲线运动 · 核心零绘制 / Gaussian 柔化边界。');
  }
  // Full mode: native-DPR static soft-alpha sprites, one cached Gaussian union.
  // No moving masked DOM subtree, shader/pixel loop, layout reads or SVG encode
  // in the render loop. DOM renderer remains the explicit capability fallback.
  const fullPalette = ['rgba(126,38,46,.38)', 'rgba(83,76,74,.25)', 'rgba(80,91,103,.19)', 'rgba(109,32,41,.27)'];
  const alphaStops = [[0,1],[.10,.90],[.25,.69],[.43,.43],[.62,.20],[.78,.055],[.90,0],[1,0]];
  const spriteCache = new Map();
  function createCanvasRenderer(node) {
    const canvas = el('canvas', 'mesh-full-canvas');
    let ctx;
    try { ctx = canvas.getContext?.('2d'); }
    catch { canvas.width=canvas.height=0; return; }
    if (!ctx || typeof Path2D === 'undefined' || typeof Image === 'undefined') { canvas.width=canvas.height=0; return; }
    let width=0, height=0, ratio=1, unit=1, paths=[], sprites=[], clip, atlas, viewportMask, maskOffset;
    let raf=0, generation=0, disposed=false, elapsed=0, last, requested=false, state='pending', pendingImage;
    const created=new Set(), listening=new Set();
    const renderer = { canvas, offset:0, frames:0, maskLoads:0,
      get state() { return state; }, get ready() { return state==='ready'; },
      get paths() { return paths; }, get sprites() { return sprites; }, get cacheSize() { return spriteCache.size; },
      get time() { return elapsed; }, get active() { return !!raf; },
      // Explicit phase inspection redraws actual pixels; it creates no WAAPI.
      paint(time) { renderer.stop(); elapsed=time; if (renderer.ready && atlas && clip) attempt(draw); },
      sampleMask(x,y) { return attempt(() => viewportMask && context(viewportMask).getImageData(Math.round(x*ratio),Math.round(y*ratio),1,1).data[3]); },
      resize(w,h,u) {
        if (terminal()) return;
        const d=(window.devicePixelRatio || 1)*u;
        if (w===width && h===height && d===ratio) return;
        invalidate(); width=w; height=h; ratio=d; unit=u;
        attempt(() => {
          canvas.width=Math.ceil(w*d); canvas.height=Math.ceil(h*d);
          canvas.style.width=`${w}px`; canvas.style.height=`${h}px`;
          node.__maskGeometry=undefined; sprites=paths.map(sprite); prune();
        });
      },
      setPaths(items) { if (!terminal()) attempt(() => { paths=items; sprites=paths.map(sprite); prune(); }); },
      clip(path) { if (!terminal()) attempt(() => { clip=new Path2D(path); }); },
      mask(svg,w,h,u) {
        if (terminal()) return;
        invalidate(); const token=generation; renderer.maskSVG=svg;
        attempt(() => {
          const image=new Image(); pendingImage=image; renderer.maskLoads++;
          image.onload=() => {
            if (disposed || token!==generation || terminal() || !node.isConnected) return;
            attempt(() => {
              clearImage();
              const cached=buffer(); cached.width=Math.ceil(w*ratio); cached.height=Math.ceil(h*3*ratio);
              context(cached).drawImage(image,0,0,cached.width,cached.height);
              atlas=cached; maskOffset=undefined; state='ready';
              node.style.visibility=canRun()?'visible':'hidden';
              if (requested) resume();
            });
          };
          image.onerror=() => { if (!disposed && token===generation && !terminal()) fail(); };
          image.src=`data:image/svg+xml,${encodeURIComponent(svg)}`;
        });
      },
      start() { if (terminal()) return; requested=true; resume(); },
      stop() { requested=false; cancel(); },
      dispose() {
        if (disposed) return;
        disposed=true; state='retired'; requested=false; generation++; cancel(); clearImage();
        release(atlas); release(viewportMask); atlas=viewportMask=clip=undefined; sprites=[];
        canvas.width=canvas.height=0;
        for (const image of listening) unlisten(image);
        for (const image of [...created]) if (![...spriteCache.values()].some(value => value.image===image)) release(image);
        created.clear();
      }
    };
    function prune() {
      const retained=new Set([...spriteCache.values(), ...sprites].filter(Boolean).map(value => value.image));
      for (const image of [...created]) if (image!==atlas && image!==viewportMask && !retained.has(image)) release(image);
    }
    function terminal() { return state==='failed' || state==='retired'; }
    function canRun() { return renderer.ready && !disposed && node.isConnected && !document.hidden && !blocked(); }
    function resume() {
      // Media can flip while decoding, before its change handler is delivered.
      // Persistent OFF/media/page gates retire the root; layout transitions only pause it.
      if (requested && !document.hidden && blocked() && !transitions.size) { refresh(); return; }
      if (!raf && requested && canRun() && atlas && clip) { last=undefined; raf=requestAnimationFrame(tick); }
    }
    function cancel() { if (raf) cancelAnimationFrame(raf); raf=0; last=undefined; }
    function clearImage() { if (pendingImage) pendingImage.onload=pendingImage.onerror=null; pendingImage=undefined; }
    function unlisten(image) { image.removeEventListener('contextlost',lost); image.removeEventListener('contextrestored',restored); listening.delete(image); }
    function release(image) { if (image) { image.width=image.height=0; created.delete(image); unlisten(image); } }
    function invalidate() { generation++; cancel(); clearImage(); state='pending'; node.style.visibility='hidden'; release(atlas); release(viewportMask); atlas=viewportMask=undefined; maskOffset=undefined; }
    function fail() {
      if (terminal()) return;
      state='failed'; requested=false; generation++; cancel(); clearImage(); node.style.visibility='hidden';
      // Remove only this renderer's invalid resources, never leave a poisoned cache entry.
      for (const [key,value] of spriteCache) if (created.has(value.image) || sprites.includes(value)) { spriteCache.delete(key); release(value.image); }
      for (const image of [...created]) release(image);
      for (const image of [...listening]) unlisten(image);
      canvas.width=canvas.height=0; atlas=viewportMask=clip=undefined; sprites=[];
      node.__maskGeometry=node.__clipGeometry=undefined;
      updateControls('Canvas2D 资源失败：效果安全关闭；可关闭后重新开启。');
    }
    function attempt(fn) { if (terminal()) return; try { return fn(); } catch { fail(); } }
    function lost(event) { event.preventDefault(); fail(); }
    // A restored context cannot restore pixels/cache validity. Stay terminal until an explicit remount.
    function restored() { if (!terminal()) fail(); }
    function listen(image) { if (!listening.has(image)) { image.addEventListener('contextlost',lost); image.addEventListener('contextrestored',restored); listening.add(image); } }
    function buffer() { const image=document.createElement('canvas'); created.add(image); listen(image); return image; }
    function context(image) { const c=image.getContext('2d'); if (!c || c.isContextLost?.()) throw new Error('Canvas2D context unavailable'); return c; }
    listen(canvas);
    function sprite(path) {
      if (!width || !height) return;
      const w=width*path.width/100, h=height*path.height/100;
      const key=`${path.palette}:${w}:${h}:${ratio}`;
      if (spriteCache.has(key)) {
        const value=spriteCache.get(key);
        try { context(value.image); }
        catch (error) { spriteCache.delete(key); release(value.image); throw error; }
        listen(value.image); return value;
      }
      const image=buffer(); image.width=Math.ceil(w*ratio); image.height=Math.ceil(h*ratio);
      const c=context(image); c.scale(image.width/2,image.height/2); c.translate(1,1);
      // Cache the same static asymmetric CSS border-radius, not an oval-only
      // substitute. Elliptical arc corners are native Path2D rasterized once.
      c.beginPath(); c.moveTo(-1+1.12,-1); c.lineTo(1-.88,-1);
      c.ellipse(1-.88,-1+1.20,.88,1.20,0,-Math.PI/2,0);
      c.lineTo(1,1-.80); c.ellipse(1-1.24,1-.80,1.24,.80,0,0,Math.PI/2);
      c.lineTo(-1+.76,1); c.ellipse(-1+.76,1-1.12,.76,1.12,0,Math.PI/2,Math.PI);
      c.lineTo(-1,-1+.88); c.ellipse(-1+1.12,-1+.88,1.12,.88,0,Math.PI,Math.PI*1.5);
      c.closePath(); c.clip();
      const gradient=c.createRadialGradient(0,0,0,0,0,1);
      for (const [position,alpha] of alphaStops) gradient.addColorStop(position,`rgba(0,0,0,${alpha})`);
      c.fillStyle=gradient; c.fillRect(-1,-1,2,2);
      c.globalCompositeOperation='source-in'; c.fillStyle=fullPalette[path.palette]; c.fillRect(-1,-1,2,2);
      const value={image,w,h}; spriteCache.set(key,value);
      // Keep recent native size generations; never retain unbounded zoom buffers.
      while (spriteCache.size>48) spriteCache.delete(spriteCache.keys().next().value);
      return value;
    }
    function tick(t) {
      raf=0;
      if (!requested || terminal() || disposed || document.hidden || !node.isConnected) { last=undefined; return; }
      // Enforce cleanup even if the engine misses a live media change event.
      // blocked() reads cached MediaQueryList state, not DOM geometry.
      if (blocked()) { last=undefined; refresh(); return; }
      if (!renderer.ready || !atlas || !clip) { last=undefined; return; }
      // Scalar native DPR check: no rectangle/style/layout probe. Some native
      // resolution changes (including CDP) emit neither resize nor MQ change.
      if (ratio !== (window.devicePixelRatio || 1)*unit) { geometry(); return; }
      if (last!==undefined) elapsed+=t-last;
      last=t;
      attempt(draw);
      if (requested && blocked()) { refresh(); return; }
      if (requested && canRun()) raf=requestAnimationFrame(tick);
    }
    function draw() {
      ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,width,height);
      ctx.save(); ctx.clip(clip);
      for (let i=0;i<paths.length;i++) {
        const path=paths[i], tex=sprites[i]; if (!tex) continue;
        const duration=parseFloat(path.props['--lava-duration'])*1000;
        const delay=parseFloat(path.props['--lava-delay'])*1000;
        const xTheta=(elapsed-delay)/duration*2*Math.PI*path.direction+path.phase;
        const yTheta=(elapsed-delay*.731)/(duration*Math.sqrt(5))*2*Math.PI*-path.direction+path.phase*1.31;
        const x=(.5+.40*Math.cos(xTheta)+path.warp*Math.sin(2*xTheta+path.phase))*width;
        const y=(.5+.38*Math.sin(yTheta)+path.warp*Math.cos(3*yTheta-path.phase))*height;
        ctx.save(); ctx.translate(x,y); ctx.rotate(13*Math.sin(yTheta+path.phase)*Math.PI/180);
        ctx.transform(1,0,Math.tan(9*Math.sin(2*yTheta-path.phase)*Math.PI/180),1,0,0);
        ctx.scale(.90+.10*Math.sin(2*yTheta),1+.16*Math.cos(yTheta));
        ctx.drawImage(tex.image,-tex.w/2,-tex.h/2,tex.w,tex.h); ctx.restore();
      }
      ctx.restore();
      if (maskOffset!==renderer.offset) cacheViewportMask();
      ctx.globalCompositeOperation='destination-in';
      ctx.drawImage(viewportMask,0,0,width,height);
      ctx.globalCompositeOperation='source-over'; renderer.frames++;
    }
    function cacheViewportMask() {
      viewportMask ||= buffer();
      viewportMask.width=canvas.width; viewportMask.height=canvas.height;
      const ctx=context(viewportMask); ctx.scale(ratio,ratio);
      ctx.drawImage(atlas,0,renderer.offset*ratio,atlas.width,height*ratio,0,0,width,height);
      ctx.globalCompositeOperation='destination-in';
      const horizontal=ctx.createLinearGradient(0,0,width,0);
      horizontal.addColorStop(0,'transparent'); horizontal.addColorStop(Math.min(.5,8/unit/width),'transparent'); horizontal.addColorStop(Math.min(.5,48/unit/width),'black'); horizontal.addColorStop(Math.max(.5,1-48/unit/width),'black'); horizontal.addColorStop(Math.max(.5,1-8/unit/width),'transparent'); horizontal.addColorStop(1,'transparent');
      ctx.fillStyle=horizontal; ctx.fillRect(0,0,width,height);
      const vertical=ctx.createLinearGradient(0,0,0,height);
      vertical.addColorStop(0,'transparent'); vertical.addColorStop(Math.min(.5,8/unit/height),'transparent'); vertical.addColorStop(Math.min(.5,48/unit/height),'black'); vertical.addColorStop(Math.max(.5,1-48/unit/height),'black'); vertical.addColorStop(Math.max(.5,1-8/unit/height),'transparent'); vertical.addColorStop(1,'transparent');
      ctx.fillStyle=vertical; ctx.fillRect(0,0,width,height);
      maskOffset=renderer.offset;
    }
    return renderer;
  }
  function mountFull() {
    const glass = window.CSS?.supports('backdrop-filter', 'blur(4px)') || window.CSS?.supports('-webkit-backdrop-filter', 'blur(4px)');
    const node = el('div', 'effect-full');
    node.dataset.mesh = 'full-background'; node.dataset.preset = preset;
    node.dataset.motion = 'dynamic'; node.dataset.flow = 'lava'; node.dataset.travel = 'full';
    node.style.opacity = String(intensity / 100); node.style.visibility = 'hidden';
    node.setAttribute('aria-hidden', 'true');
    nodes = [node]; document.body.append(node);
    node.__renderer = rendererChoice === 'pixi' && window.createMeshPixiRenderer
      ? window.createMeshPixiRenderer(node, { blocked, geometry, status: updateControls }) : undefined;
    if (!node.__renderer) node.__renderer = createCanvasRenderer(node);
    if (node.__renderer && glass && !reducedTransparency.matches) document.body.dataset.meshChromeGlass = 'true';
    if (node.__renderer && !node.__renderer.updateGeometry) node.dataset.renderer = 'canvas2d';
    else node.dataset.renderer = 'dom';
    populateFull(node);
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
    }
    let watched = new Set(), ancestors = new Set();
    const sameOwners = (a, b) => a.size === b.size && [...a].every(n => b.has(n));
    const watchOwners = () => {
      // Hidden owners still need subscriptions before they become visible.
      const next = new Set([host, ...protectedNodes()].filter(Boolean));
      const parents = new Set();
      for (const n of next) for (let p=n.parentElement; p && p!==document.body; p=p.parentElement) {
        if (!next.has(p)) parents.add(p);
      }
      if (sameOwners(watched, next) && sameOwners(ancestors, parents)) return;
      if (!sameOwners(watched, next)) {
        observer?.disconnect();
        for (const n of next) observer?.observe(n);
      }
      // Reparenting changes ancestor subscriptions even if owners stay identical.
      fullObserver?.disconnect();
      // Global structural discovery finds nested popups in unrelated containers.
      // No global subtree attributes: animated HUD/cursor styles stay unobserved.
      fullObserver?.observe(document.body, { subtree: true, childList: true });
      const attributes = { attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'hidden', 'open'] };
      for (const n of next) fullObserver?.observe(n, { ...attributes, subtree: true, childList: true });
      // Sibling insertions in protected ancestors can move a rect without RO.
      for (const p of parents) fullObserver?.observe(p, { ...attributes, childList: true });
      watched = next; ancestors = parents;
    };
    fullObserver = new MutationObserver(records => {
      if (records.some(affectsLayout)) {
        watchOwners(); geometry();
      }
    });
    watchOwners();
  }
  function refresh() {
    clearField();
    if (!pageActive) return;
    if (!mount()) return;
    const message = blocked();
    updateControls(message);
    if (message) return;
    if (isFull()) { mountFull(); return; }
    nodes = ['left', 'right'].map((side, i) => {
      const node = el('div', `effect-mesh effect-mesh-${side}`);
      node.dataset.mesh = 'margin-only'; node.dataset.preset = preset;
      node.setAttribute('aria-hidden', 'true');
      node.style.opacity = String(intensity / 100);
      node.style.width = '0px';
      populateLava(node, i);
      document.body.append(node);
      return node;
    });
    syncMotion();
    geometry();
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      for (const node of [host, ...host.querySelectorAll('.content-wrap, .post-block')]) observer.observe(node);
    }
  }
  document.addEventListener('pjax:send', () => {
    navigating = true; transitions.clear(); clearField(); updateControls(blocked());
  });
  for (const name of ['pjax:success', 'pjax:error']) document.addEventListener(name, () => {
    navigating = false; transitions.clear(); refresh();
  });
  document.addEventListener('visibilitychange', () => { syncMotion(); geometry(); });
  window.addEventListener('hexo-blog-decrypt', refresh);
  for (const query of [reduced, desktop, contrast, print, reducedTransparency]) query.addEventListener('change', refresh);
  window.addEventListener('beforeprint', clearField);
  window.addEventListener('afterprint', refresh);
  window.addEventListener('scroll', () => { if (isFull()) geometry(); }, { passive: true, capture: true });
  window.addEventListener('resize', () => { geometry(); if (!isFull()) schedule(); });
  window.visualViewport?.addEventListener('resize', () => { geometry(); schedule(); });
  window.visualViewport?.addEventListener('scroll', () => { geometry(); if (!isFull()) schedule(); });
  // Transform transitions do not notify RO. Suppress fields for their duration
  // rather than sampling perpetually or letting them pass behind moving text.
  const visualOnly = target => target?.closest?.('#cursor-container, #bg-title-projection, .hud-grid, canvas, [data-mesh]');
  const classGeometry = value => (value || '').split(/\s+/).filter(c => c && !/^(?:custom-cursor-active|lenis(?:-.+)?)$/.test(c)).sort().join(' ');
  const layoutOwners = () => [host, ...protectedNodes()].filter(Boolean);
  const movesContent = target => !visualOnly(target) && host && layoutOwners().some(n => target === n || target.contains?.(n) || n.contains(target));
  const affectsLayout = record => {
    const target = record.target;
    if (visualOnly(target)) return false;
    if (record.attributeName === 'class' && (target === document.body || target === document.documentElement) && classGeometry(record.oldValue) === classGeometry(target.className)) return false;
    if (record.type === 'childList') {
      const changed = [...record.addedNodes, ...record.removedNodes];
      // Runtime labels/status replace text every geometry pass. They are not
      // structural discovery; RO still owns the controls' actual dimensions.
      if (panel?.contains(target) && target.matches?.('.effect-toggle, .effect-motion, .effect-intensity-output, .effect-state') && changed.every(n => n.nodeType === 3)) return false;
      const structural = changed.filter(n => !visualOnly(n));
      if (!structural.length) return false;
      if (structural.some(n => n.matches?.(protectedSelector) || n.querySelector?.(protectedSelector))) return true;
      // Including ancestors (and body) catches nonprotected sibling layout
      // changes. Unrelated nested mutations need no geometry measurement.
      return movesContent(target);
    }
    return movesContent(target);
  };
  const changesGeometry = property => /^(?:transform|translate|scale|rotate|perspective|zoom|(?:min-|max-)?(?:width|height|inline-size|block-size)|(?:margin|padding|inset)(?:-.+)?|top|right|bottom|left|border(?:-.+)?-width|flex(?:-.+)?|grid(?:-.+)?|(?:column-|row-)?gap|font-size|font-weight|letter-spacing|word-spacing|line-height)$/.test(property);
  document.addEventListener('transitionrun', event => {
    if (!movesContent(event.target) || !changesGeometry(event.propertyName)) return;
    const properties = transitions.get(event.target) || new Set();
    properties.add(event.propertyName);
    transitions.set(event.target, properties);
    if (isFull()) nodes.forEach(n => { n.style.visibility = 'hidden'; n.__renderer?.stop(); });
    else clearField();
    updateControls(blocked());
  });
  for (const name of ['transitionend', 'transitioncancel']) document.addEventListener(name, event => {
    const properties = transitions.get(event.target);
    if (!properties?.delete(event.propertyName)) return;
    if (!properties.size) transitions.delete(event.target);
    if (!transitions.size) { if (isFull() && nodes.length) geometry(); else refresh(); }
  });
  const layoutChanges = new MutationObserver(records => {
    if (records.some(affectsLayout)) { geometry(); if (!isFull()) schedule(); }
  });
  function start() {
    pageActive = true;
    layoutChanges.observe(document.body, { attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style'] });
    layoutChanges.observe(document.documentElement, { attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style'] });
    refresh();
  }
  window.addEventListener('pagehide', () => { pageActive = false; clearField(); layoutChanges.disconnect(); transitions.clear(); });
  window.addEventListener('pageshow', start);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
