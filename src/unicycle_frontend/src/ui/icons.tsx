// Minimal single-path line icons + the unicycle wheel mark.
// Direct port of design_files/icons.jsx (stroke = currentColor).
import type { CSSProperties } from 'react';

const P = {
  overview: 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z',
  canisters: 'M4 7l8-4 8 4-8 4-8-4zM4 7v10l8 4 8-4V7M12 11v10',
  wallet: 'M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM3 7l2.5-3h11L19 7M16 13h.01',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  admin: 'M5 6h14M5 6v0a2 2 0 1 0 4 0M9 6h10M5 12h6M11 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0M15 12h4M5 18h2M7 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0M11 18h8',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M19 12l-7 7-7-7',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H20a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  chevronR: 'M9 6l6 6-6 6',
  chevronD: 'M6 9l6 6 6-6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  menu: 'M3 6h18M3 12h18M3 18h18',
  copy: 'M11 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  grid: 'M3 3h8v8H3zM13 3h8v8h-8zM13 13h8v8h-8zM3 13h8v8H3z',
  layout: 'M3 3h18v18H3zM3 9h18M9 9v12',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  gauge: 'M12 21a9 9 0 1 0-9-9M12 12l4-4M3 12h2M19 12h2M12 3v2',
  ext: 'M15 3h6v6M10 14L21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  play: 'M6 4l14 8-14 8z',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  upload: 'M12 21V9M7 14l5-5 5 5M5 3h14',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  flame: 'M12 2s5 4 5 9a5 5 0 0 1-10 0c0-1.5.5-3 1.5-4 .2 1 .8 2 1.5 2 0-2.5 2-5 2-7z',
  shield: 'M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  link: 'M9 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M15 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5',
} as const;

export type IconName = keyof typeof P | 'wheel';

export interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 16, stroke = 2, className = '', style }: IconProps) {
  if (name === 'wheel') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={className}
        style={style}
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2M18.4 5.6l-4.2 4.2M9.8 14.2l-4.2 4.2" />
      </svg>
    );
  }
  const filled = name === 'bolt' || name === 'play' || name === 'flame';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={P[name] || ''} />
    </svg>
  );
}
