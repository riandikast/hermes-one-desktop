/**
 * The element-inspector script injected into the web preview.
 *
 * Kept in its own module (rather than inline in the panel) because it is a
 * self-contained browser-side program: it attaches click/hover listeners,
 * highlights the element under the cursor, and reports the picked node back
 * over console messages that the panel parses.
 *
 * It defines window.__hermesCleanupInspector so the panel can tear the
 * listeners down without reloading the page.
 */
export const INSPECTOR_SCRIPT = `
(function() {
  if (window.__hermesCleanupInspector) {
    window.__hermesCleanupInspector();
  }

  const overlay = document.createElement('div');
  overlay.id = '__hermes_inspector_overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '999999',
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
    border: '2px solid rgba(59, 130, 246, 0.85)',
    borderRadius: '4px',
    boxSizing: 'border-box',
    transition: 'all 0.05s ease-out',
    display: 'none'
  });

  const label = document.createElement('div');
  label.id = '__hermes_inspector_label';
  Object.assign(label.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '1000000',
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    color: '#ffffff',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'none'
  });

  document.body.appendChild(overlay);
  document.body.appendChild(label);

  let hoveredElement = null;

  function onMouseMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === label || el === document.body || el === document.documentElement) {
      overlay.style.display = 'none';
      label.style.display = 'none';
      hoveredElement = null;
      return;
    }

    if (hoveredElement !== el) {
      hoveredElement = el;
      const rect = el.getBoundingClientRect();
      
      overlay.style.left = rect.left + 'px';
      overlay.style.top = rect.top + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
      overlay.style.display = 'block';

      let labelText = el.tagName.toLowerCase();
      if (el.id) labelText += '#' + el.id;
      
      const classAttr = el.getAttribute('class');
      if (classAttr && typeof classAttr === 'string') {
        const classes = classAttr.split(/\\s+/).filter(c => c && !c.startsWith('__hermes')).join('.');
        if (classes) labelText += '.' + classes;
      }
      
      if (labelText.length > 50) labelText = labelText.substring(0, 47) + '...';
      label.textContent = labelText;
      label.style.display = 'block';

      const labelRect = label.getBoundingClientRect();
      let labelTop = rect.top - labelRect.height - 4;
      if (labelTop < 0) {
        labelTop = rect.bottom + 4;
      }
      let labelLeft = rect.left;
      if (labelLeft + labelRect.width > window.innerWidth) {
        labelLeft = window.innerWidth - labelRect.width - 8;
      }
      label.style.top = labelTop + 'px';
      label.style.left = Math.max(8, labelLeft) + 'px';
    }
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();

    if (hoveredElement) {
      const payload = {
        tagName: hoveredElement.tagName.toLowerCase(),
        id: hoveredElement.id || '',
        className: hoveredElement.getAttribute('class') || '',
        outerHTML: hoveredElement.outerHTML
      };
      console.log('__HERMES_INSPECT_RESULT__:' + JSON.stringify(payload));
    } else {
      console.log('__HERMES_INSPECT_CANCELLED__');
    }
    cleanup();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      console.log('__HERMES_INSPECT_CANCELLED__');
      cleanup();
    }
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    
    const currentOverlay = document.getElementById('__hermes_inspector_overlay');
    const currentLabel = document.getElementById('__hermes_inspector_label');
    if (currentOverlay && currentOverlay.parentNode) currentOverlay.parentNode.removeChild(currentOverlay);
    if (currentLabel && currentLabel.parentNode) currentLabel.parentNode.removeChild(currentLabel);
    
    window.__hermesCleanupInspector = null;
  }

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  window.__hermesCleanupInspector = cleanup;
})();
`;

/** Injected when inspection stops, to remove the listeners it added. */
export const INSPECTOR_CLEANUP_SCRIPT =
  "if (window.__hermesCleanupInspector) window.__hermesCleanupInspector();";

/** Prefix the in-page script uses to return a picked element. */
export const INSPECT_RESULT_PREFIX = "__HERMES_INSPECT_RESULT__:";
/** Sent when the user presses Escape in inspect mode. */
export const INSPECT_CANCELLED = "__HERMES_INSPECT_CANCELLED__";
