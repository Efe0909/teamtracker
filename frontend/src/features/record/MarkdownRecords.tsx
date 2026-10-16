// [[Baslik]] baglantilarinin verisi burada; Markdown cizicisi API ve rota bilmez.
import { Command } from "cmdk";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { errorText } from "../../api/client";
import { useRecords } from "../../api/hooks";
import { useLookup } from "../../lib/lookup";
import { MarkdownLinksContext, type WikiLinkProps, type WikiPickerProps } from "../../ui/MarkdownLinks";
import { Icon } from "../../ui/icons";
import { Dialog, KindTag, Link, ui } from "../../ui/ui";

type Routes = { recordHref: (id: string) => string; searchHref: (title: string) => string };

export function RecordMarkdownProvider({ children, recordHref, searchHref }: Routes & { children: ReactNode }) {
  const value = useMemo(() => ({
    Link: (props: WikiLinkProps) => <RecordWikiLink {...props} recordHref={recordHref} searchHref={searchHref} />,
    Picker: RecordWikiPicker,
    hrefOf: searchHref,
  }), [recordHref, searchHref]);
  return <MarkdownLinksContext value={value}>{children}</MarkdownLinksContext>;
}

const titleKey = (title: string) => title.normalize("NFC").trim().toLocaleLowerCase("tr-TR");

function RecordWikiLink({ title, className, children, recordHref, searchHref }: WikiLinkProps & Routes) {
  const query = useRecords({ search: title });
  const matches = (query.data ?? []).filter((record) => titleKey(record.title) === titleKey(title));
  const record = matches.length === 1 ? matches[0] : undefined;
  // Ayni baslikli kayitlarda rastgele birini acma; arama ikisini de gosterir.
  return <Link href={record === undefined ? searchHref(title) : recordHref(record.id)} className={className ?? ""}
    title={matches.length > 1 ? "Aynı başlıkta birden fazla kayıt var; seçmek için aç" : title}>{children}</Link>;
}

function RecordWikiPicker({ query: initial, onPick, onClose }: WikiPickerProps) {
  const L = useLookup();
  const [text, setText] = useState(initial);
  const [query, setQuery] = useState(initial.trim());
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 180);
    return () => clearTimeout(timer);
  }, [text]);
  const records = useRecords(query === "" ? {} : { search: query });
  return <Dialog open onClose={onClose} title="Görev bağla" onCloseAutoFocus={(event) => { event.preventDefault(); onClose(); }}>
    <Command label="Görev ara" shouldFilter={false} loop>
      <Command.Input className={ui.popSearch} value={text} onValueChange={setText} placeholder="Görev ara…" aria-label="Görev ara" autoFocus />
      <Command.List className={ui.popList} aria-label="Görevler" aria-busy={records.isFetching}>
        {records.error !== null ? <p role="alert" className={ui.popEmpty}>{errorText(records.error)}</p>
          : records.isFetching && (records.data === undefined || records.isPlaceholderData) ? <p role="status" className={ui.popEmpty}>Aranıyor…</p>
          : <>
            <Command.Empty className={ui.popEmpty}>Kayıt bulunamadı.</Command.Empty>
            {(records.data ?? []).slice(0, 50).map((record) => <Command.Item key={record.id} value={record.id}
              className={ui.popItem} onSelect={() => onPick(record.title)}>
              <Icon name="tasks" size={16} />
              <span className={ui.popBody}><span className={ui.popLabel}>{record.title}</span>
                <span className={ui.popDesc}>{L.path(record.unit_id).join(" › ")}</span></span>
              <KindTag kind={record.kind} />
            </Command.Item>)}
          </>}
      </Command.List>
    </Command>
  </Dialog>;
}
