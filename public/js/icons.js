export const icons = {
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/>',
  library:
    '<rect x="3" y="4" width="4" height="16" rx="1"/><rect x="9" y="4" width="4" height="16" rx="1"/><path d="m15 5 4-1 4 15-4 1Z"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4Z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
  sliders:
    '<path d="M4 7h8m5 0h3M4 17h3m5 0h8"/><circle cx="14.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/>',
  flower:
    '<path d="M12 15v7m0-3 5-3M12 8c-5-9-10 1-4 3-8 4 1 10 4 4 3 6 12 0 4-4 6-2 1-12-4-3Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  book: '<path d="M12 5v16M12 5C8 2 4 3 2 4v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-2-1-6-2-10 1Z"/>',
};
export const icon = (n) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n] || icons.book}</svg>`;
