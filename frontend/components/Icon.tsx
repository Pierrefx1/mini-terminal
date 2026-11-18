/** Icônes au trait (16 px), dessinées pour le terminal : aucune dépendance, couleur héritée. */
const P: Record<string, React.ReactNode> = {
  globe: <><circle cx="8" cy="8" r="6.5" /><path d="M1.5 8h13M8 1.5c2 2 2.8 4.2 2.8 6.5S10 12.5 8 14.5M8 1.5C6 3.5 5.2 5.7 5.2 8S6 12.5 8 14.5" /></>,
  home: <path d="M2 7.5 8 2.5l6 5M3.5 6.5v7h3.5V10h2v3.5h3.5v-7" />,
  windows: <><rect x="1.5" y="2" width="8" height="6" /><rect x="6.5" y="6" width="8" height="8" /></>,
  candles: <><path d="M4 2v12M8 4v10M12 1.5v10" /><rect x="2.5" y="5" width="3" height="5" /><rect x="6.5" y="7" width="3" height="4" /><rect x="10.5" y="3.5" width="3" height="5" /></>,
  card: <><rect x="1.5" y="3" width="13" height="10" /><path d="M4 6.5h4M4 9.5h8" /></>,
  report: <><path d="M3 1.5h7l3 3v10H3z" /><path d="M5.5 11.5v-2M8 11.5V7M10.5 11.5V8.5" /></>,
  calc: <><rect x="3" y="1.5" width="10" height="13" /><path d="M5 4.5h6M5.5 8h1M9.5 8h1M5.5 11h1M9.5 11h1" /></>,
  filter: <path d="M1.5 2.5h13L9.5 8.5v5l-3-1.5V8.5z" />,
  percent: <><path d="M13 3 3 13" /><circle cx="4.5" cy="4.5" r="1.8" /><circle cx="11.5" cy="11.5" r="1.8" /></>,
  fx: <path d="M2 5h10.5l-2.5-2.5M14 11H3.5L6 13.5" />,
  pulse: <path d="M1 8.5h3l2-5 3 9 2-5.5h4" />,
  barrel: <><ellipse cx="8" cy="3.5" rx="5" ry="1.8" /><path d="M3 3.5v9c0 1 2.2 1.8 5 1.8s5-.8 5-1.8v-9M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8" /></>,
  users: <><circle cx="5.5" cy="5" r="2.3" /><circle cx="11.5" cy="5.5" r="1.8" /><path d="M1.5 13.5c0-2.4 1.8-4 4-4s4 1.6 4 4M10 9.5c2.4 0 4.5 1.4 4.5 4" /></>,
  tank: <><rect x="2" y="3" width="12" height="11" /><path d="M2 8.5h12M5 6h2" /></>,
  flame: <path d="M8 14.5c-3 0-4.8-2-4.8-4.6C3.2 6.5 6.5 5 6.5 1.5c2 1.2 3 3 2.6 5 1-.4 1.7-1.3 1.8-2.3 1.4 1.4 2 3.4 2 5.3 0 2.8-2 5-4.9 5z" />,
  layers: <path d="m8 1.5 6.5 3.5L8 8.5 1.5 5zM1.5 8 8 11.5 14.5 8M1.5 11 8 14.5l6.5-3.5" />,
  sigma: <path d="M12.5 3V1.5h-9L8 8l-4.5 6.5h9V13" />,
  bank: <path d="M1.5 6 8 2l6.5 4zM3 7v5.5M6.3 7v5.5M9.7 7v5.5M13 7v5.5M1.5 14.5h13" />,
  calendar: <><rect x="1.5" y="3" width="13" height="11.5" /><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3M4.5 9.5h2M9.5 9.5h2M4.5 12h2" /></>,
  trend: <path d="M1.5 12.5 6 8l3 3 5.5-6.5M10.5 4.5h4v4" />,
  flag: <path d="M3 14.5v-13M3 2h9.5L11 5l1.5 3H3" />,
  news: <><rect x="1.5" y="2.5" width="11" height="11" /><path d="M12.5 5.5h2v6.5a1.5 1.5 0 0 1-3 0M4 5.5h6M4 8h6M4 10.5h4" /></>,
  book: <path d="M8 3.5C6.5 2.3 4.2 2 1.5 2.3v11c2.7-.3 5 0 6.5 1.2 1.5-1.2 3.8-1.5 6.5-1.2v-11c-2.7-.3-5 0-6.5 1.2zM8 3.5v11" />,
  swap: <path d="M2 5.5h11M10 2.5l3 3-3 3M14 10.5H3M6 7.5l-3 3 3 3" />,
  pie: <><path d="M8 1.5A6.5 6.5 0 1 0 14.5 8H8z" /><path d="M10 1.8V6h4.2A6.5 6.5 0 0 0 10 1.8z" /></>,
  shield: <path d="M8 1.5 2.5 3.5v4.2c0 3.2 2.3 5.6 5.5 6.8 3.2-1.2 5.5-3.6 5.5-6.8V3.5z" />,
  bell: <path d="M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14h3" />,
  chat: <path d="M1.5 2.5h13v8.5H6L2.5 14v-3h-1z" />,
  help: <><circle cx="8" cy="8" r="6.5" /><path d="M6 6a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.3v.4M8 11.5v.5" /></>,
  menu: <path d="M2 4h12M2 8h12M2 12h12" />,
  collapse: <path d="M10 3.5 5.5 8l4.5 4.5" />,
  expand: <path d="M6 3.5 10.5 8 6 12.5" />,
};

export default function Icon({ name, size = 16, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      {P[name] ?? P.help}
    </svg>
  );
}
