import { el, onTap } from './dom';

/** Fatal error screen (no WebGL, init failure) with a copy-log button so phone bugs are reportable. */
export function showErrorScreen(
  container: HTMLElement,
  title: string,
  detail: string,
  copyLog: () => Promise<boolean>,
): void {
  const root = el('div', 'screen error-screen');
  root.dataset['testid'] = 'error-screen';
  const box = el('div', 'panel');
  const copy = el('div', 'btn btn-primary', 'Copy debug log');
  copy.setAttribute('role', 'button');
  const result = el('p', 'panel-note', '');
  onTap(copy, () => {
    copyLog()
      .then((ok) => {
        result.textContent = ok ? 'Copied. Paste it into your bug report.' : 'Copy failed.';
      })
      .catch(() => {
        result.textContent = 'Copy failed.';
      });
  });
  const reload = el('div', 'btn', 'Reload');
  reload.setAttribute('role', 'button');
  onTap(reload, () => window.location.reload());
  box.append(el('h2', 'panel-title', title), el('p', 'panel-body', detail), copy, reload, result);
  root.append(box);
  container.append(root);
}
