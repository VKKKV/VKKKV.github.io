/* global LocalSearch */
'use strict';

// Loaded after the vendor and before NexT's local-search initializer. Protect
// both raw Pandoc TeX and already-typeset math on initial load and PJAX visits.
(() => {
  if (typeof LocalSearch === 'undefined') return;
  const prototype = LocalSearch.prototype;
  const previous = prototype.highlightText;
  if (typeof previous !== 'function' || previous.mathSafeHighlight) return;
  const protectedAncestor = '.math, mjx-container, math, .katex, .mermaid, button, select, textarea, mark.search-keyword';
  function highlightText(node, ...args) {
    if (node.parentElement?.closest(protectedAncestor)) return;
    return previous.call(this, node, ...args);
  }
  highlightText.mathSafeHighlight = true;
  prototype.highlightText = highlightText;
})();
