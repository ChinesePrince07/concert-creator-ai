import { backToLibrary } from '../../state/actions';
import type { AppState } from '../../state/store';
import { el } from '../dom';

export function processingScreen(state: AppState): {
  el: HTMLElement;
  update(s: AppState): void;
  dispose(): void;
} {
  const list = el('div', {});
  const errBox = el('div', { class: 'err hidden' });
  const root = el('div', { class: 'screen processing' }, [
    el('div', { class: 'slate' }, [
      el('div', { class: 'overline', text: 'Generating performance' }),
      el('h2', { text: state.processing?.pieceName ?? '' }),
      list,
      errBox,
    ]),
  ]);

  function render(s: AppState): void {
    const p = s.processing;
    if (!p) return;
    list.innerHTML = '';
    p.stages.forEach((st, i) => {
      const status =
        st.status === 'active'
          ? st.progress !== undefined
            ? `${Math.round(st.progress * 100)}%`
            : '· · ·'
          : st.status === 'done'
            ? `${st.detail ? `${st.detail} — ` : ''}${(st.ms! / 1000).toFixed(2)}s`
            : st.status === 'error'
              ? 'FAILED'
              : '';
      list.append(
        el('div', { class: `stage-row ${st.status}` }, [
          el('span', { class: 'idx', text: String(i + 1).padStart(2, '0') }),
          el('span', { text: st.label }),
          el('span', { class: 'status', text: status }),
        ]),
      );
    });
    if (p.error) {
      errBox.classList.remove('hidden');
      errBox.innerHTML = '';
      errBox.append(
        el('span', { text: p.error }),
        el('button', { text: '← BACK TO LIBRARY', onclick: () => backToLibrary() }),
      );
    }
  }

  render(state);
  return { el: root, update: render, dispose() {} };
}
