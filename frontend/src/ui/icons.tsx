// Satir ici SVG ikon seti — emoji yok (spec/16 P2 #10). currentColor + 1.8
// cizgi: karsilama ekranindaki ikonlarla ayni dil. Ad birligi tipli.

const PATHS = {
  home: "M4 11 12 4l8 7M6 9.5V20h12V9.5",
  tasks: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  teams: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.6a3 3 0 0 1 0 5.8",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4",
  bolt: "M13 3 5 13.5h6L10 21l8-10.5h-6z",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
  plus: "M12 5v14M5 12h14",
  back: "M15 5l-7 7 7 7",
  chevron: "M9 5l7 7-7 7",
  chat: "M5 18.5V6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9z",
  x: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9h-13z",
  logout: "M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 16l-4-4 4-4M6 12h10",
  reply: "M10 8 5 12.5l5 4.5M5.5 12.5H14a5 5 0 0 1 5 5V19",
  pin: "M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6",
  monitor: "M3.5 5h17v11h-17zM8 20h8M12 16v4",
  phone: "M7.5 2.5h9v19h-9zM11 18.5h2",
  calendar: "M4.5 6h15v14h-15zM4.5 10h15M8.5 3.5v4M15.5 3.5v4",
  alert: "M12 4 3 19.5h18zM12 10v4.5M12 17.5h.01",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M5 20a7 7 0 0 1 14 0",
  tree: "M6 4.5v15M6 9h6M6 16.5h6M14.5 7h5v4h-5zM14.5 14.5h5v4h-5z",
  filter: "M4 6h16M7 12h10M10 18h4",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  off: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M5.6 5.6l12.8 12.8",
  restore: "M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label === undefined ? undefined : "img"}
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
