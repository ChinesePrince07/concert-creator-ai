type Props = Record<string, unknown> & {
  class?: string;
  text?: string;
  html?: string;
  onclick?: (e: MouseEvent) => void;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: (HTMLElement | SVGElement | string | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') node.className = v as string;
    else if (k === 'text') node.textContent = v as string;
    else if (k === 'html') node.innerHTML = v as string;
    else if (k.startsWith('on')) (node as unknown as Record<string, unknown>)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function svgIcon(path: string, viewBox = '0 0 24 24'): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('fill', 'none');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.6');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

export const ICONS = {
  camera: 'M3 8h3l2-3h8l2 3h3v11H3zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  pianist: 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5',
  visuals: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  animation: 'M4 17V7l6 5-6 5zM13 7h7M13 12h7M13 17h7',
  render: 'M5 4h14v16H5zM5 8h14M8 4v4M16 4v4M9 13l3 2.5L9 18v-5z',
  play: 'M7 5v14l12-7z',
  pause: 'M7 5h4v14H7zM14 5h4v14h-4z',
  back: 'M15 5l-7 7 7 7',
};

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, ms = 2600): void {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast', text: msg });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}
