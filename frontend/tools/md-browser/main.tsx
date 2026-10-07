import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import "@fontsource-variable/inter";
import "../../src/tokens.css";
import "../../src/base.css";
import { LookupProvider } from "../../src/lib/lookup";
import { MarkdownField, MarkdownText } from "../../src/ui/MarkdownField";
import { Dialog } from "../../src/ui/ui";

const meta: any = { me: { id: "me", is_admin: false, scopes: [], team_ids: [], profile_complete: true, favorite_nodes: [] },
  users: [{ id: "selin", name: "Selin", color: null, is_admin: false, roles: [] }], teams: [], pillars: [], nodes: [] };
const params = new URLSearchParams(location.search);
(window as any).__view = () => EditorView.findFromDOM(document.querySelector(".cm-content") as HTMLElement);
function App() {
  const [v, setV] = useState(params.get("value") ?? "");
  if (params.get("dialog") === "1") return <LookupProvider meta={meta}><Dialog open onClose={() => {}} title="Kaydı kapat">
    <MarkdownField value={v} onChange={setV} label="Kapanış notu" rows={5} placeholder="Ne oldu, nerede, ne zaman?" />
  </Dialog></LookupProvider>;
  return <LookupProvider meta={meta}>
    <MarkdownField value={v} onChange={setV} label="Açıklama" rows={8} placeholder="Ne oldu, nerede, ne zaman?" />
    <div id="ro" style={{ marginTop: 16 }}><MarkdownText value={v} /></div>
    <output id="src" style={{ display: "none" }}>{v}</output>
  </LookupProvider>;
}
createRoot(document.getElementById("root")!).render(<App />);
