// Ikon seti: lucide (tek cizgi dili, currentColor). Ad birligi TIPLI — ekranda
// yalniz bu tablodaki adlar; yeni ikon = tabloya bir satir. Emoji yok
// (spec/16 P2 #10).

import {
  ArrowUpRight,
  Ban,
  Bell,
  BellOff,
  Cake,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Command,
  Ellipsis,
  FolderTree,
  House,
  Image,
  Inbox,
  Laptop,
  ListFilter,
  ListTodo,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  Pencil,
  Pin,
  Plus,
  Reply,
  RotateCcw,
  Search,
  ShieldCheck,
  SignalHigh,
  SignalLow,
  SignalMedium,
  SlidersHorizontal,
  Smartphone,
  Star,
  Sun,
  Trash2,
  TriangleAlert,
  User,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

const ICONS = {
  home: House,
  tasks: ListTodo,
  teams: Users,
  search: Search,
  bolt: Zap,
  bell: Bell,
  bellOff: BellOff,
  plus: Plus,
  back: ChevronLeft,
  chevron: ChevronRight,
  down: ChevronDown,
  updown: ChevronsUpDown,
  chat: MessageSquare,
  x: X,
  check: Check,
  lock: ShieldCheck,
  logout: LogOut,
  reply: Reply,
  pin: Pin,
  monitor: Monitor,
  phone: Smartphone,
  calendar: Calendar,
  alert: TriangleAlert,
  user: User,
  tree: FolderTree,
  filter: ListFilter,
  sliders: SlidersHorizontal,
  edit: Pencil,
  cake: Cake,
  camera: Camera,
  star: Star,
  off: Ban,
  restore: RotateCcw,
  image: Image,
  trash: Trash2,
  inbox: Inbox,
  more: Ellipsis,
  command: Command,
  external: ArrowUpRight,
  sun: Sun,
  moon: Moon,
  system: Laptop,
  // durum simgeleri (renk tek basina anlam tasimasin)
  stOpen: CircleDashed,
  stProgress: CircleDot,
  stPending: CircleSlash,
  stDone: CircleCheck,
  prLow: SignalLow,
  prMedium: SignalMedium,
  prHigh: SignalHigh,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  const C = ICONS[name];
  return (
    <C
      size={size}
      strokeWidth={1.75}
      role={label === undefined ? undefined : "img"}
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      focusable="false"
    />
  );
}
