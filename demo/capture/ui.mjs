// Ortak yer belirleyiciler: arayuzun erisilebilir adlarina dayanir (CSS sinif adi degil).

export const nav = (p, name) => p.getByRole("navigation", { name: "Ana gezinme" }).getByRole("link", { name, exact: true });
/** Filtre cipi / secici tetigi: erisilebilir ad "Etiket: deger". */
export const chip = (p, label) => p.getByRole("button", { name: new RegExp(`^${label}:`) });
export const opt = (p, name) => p.getByRole("option", { name });
/** Acik Radix popover/menu yuzeyi. */
export const pop = (p) => p.locator("[data-radix-popper-content-wrapper]").last();
export const dlg = (p, name) => (name === undefined ? p.getByRole("dialog").last() : p.getByRole("dialog", { name }).last());
export const tab = (p, name) => p.getByRole("tab", { name });
export const cls = (p, part) => p.locator(`[class*="${part}"]`);
export const btn = (p, name) => p.getByRole("button", { name });
export const menuItem = (p, name) => p.getByRole("menuitem", { name });
