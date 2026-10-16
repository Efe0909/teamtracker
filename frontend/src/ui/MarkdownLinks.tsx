// Markdown yalniz arayuzu bilir; arama, veri ve yuzun rotasi features/surfaces'tan gelir.
import { createContext, type ComponentType, type ReactNode } from "react";

export interface WikiLinkProps { title: string; className: string | undefined; children: ReactNode }
export interface WikiPickerProps { query: string; onPick: (title: string) => void; onClose: () => void }

export const MarkdownLinksContext = createContext<{
  Link: ComponentType<WikiLinkProps>;
  Picker: ComponentType<WikiPickerProps>;
  hrefOf: (title: string) => string;
} | null>(null);
