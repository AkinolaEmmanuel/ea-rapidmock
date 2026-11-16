const paths = {
  identity: 'M13 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M23 21v-2a4 4 0 0 0-3-3.87M11 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  inbox: 'M4 4h16v16H4zM4 13h5l2 3h2l2-3h5',
  json: 'M8 3H6a2 2 0 0 0-2 2v4a3 3 0 0 1-2 3 3 3 0 0 1 2 3v4a2 2 0 0 0 2 2h2M16 3h2a2 2 0 0 1 2 2v4a3 3 0 0 0 2 3 3 3 0 0 0-2 3v4a2 2 0 0 1-2 2h-2',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 2h6l1 4 4 1 2 5-2 5-4 1-1 4H9l-1-4-4-1-2-5 2-5 4-1z',
  copy: 'M9 9h12v12H9zM15 5V3H3v12h2',
  refresh: 'M20 7a9 9 0 1 0 1 9M20 2v6h-6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  check: 'M5 12l4 4L19 6',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18',
  shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6',
};
export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
