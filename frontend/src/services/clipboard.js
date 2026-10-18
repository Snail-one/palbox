export function createClipboard({ navigator, document }) {
  function fallback(text) {
    const focused = document.activeElement;
    const input = document.createElement('textarea');
    input.value = text;
    input.readOnly = true;
    Object.assign(input.style, { position: 'fixed', left: '-9999px', top: '0', opacity: '0' });
    document.body.append(input);
    try {
      input.focus();
      input.select();
      if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
    } finally {
      input.remove();
      focused?.focus({ preventScroll: true });
    }
  }

  return {
    async write(text) {
      if (!navigator.clipboard?.writeText) return fallback(text);
      try { await navigator.clipboard.writeText(text); }
      catch { fallback(text); }
    }
  };
}
