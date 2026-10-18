/** Copies text to the clipboard; falls back to a hidden textarea + execCommand on older WebViews. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('[debug] clipboard API failed, trying fallback', err);
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  area.style.left = '-9999px';
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok: boolean;
  try {
    // execCommand is deprecated but remains the only fallback on some Android WebViews.
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
