import { useState } from "react";
import { attachmentUrl } from "../../api/hooks";
import type { Attachment } from "../../api/types";
import { Icon } from "../../ui/icons";
import { formatBytes } from "../media/Media";
import { PdfThumbnail } from "../media/PdfThumbnail";
import s from "./finance.module.css";

export function InvoiceAttachments({ files, onRemove }: { files: Attachment[]; onRemove?: (id: string) => void }) {
  return <section className={s.previews} aria-label="Fatura önizlemeleri">
    {files.length === 0 ? <div className={s.previewEmpty}><Icon name="image" size={28} />
      <span>PDF ve fotoğraf eklediğinde önizlemesi burada görünür.</span></div>
      : files.map((file) => <AttachmentPreview key={file.id} file={file}
        {...(onRemove !== undefined ? { onRemove: () => onRemove(file.id) } : {})} />)}
  </section>;
}

function AttachmentPreview({ file, onRemove }: { file: Attachment; onRemove?: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const name = file.original_name ?? "dosya";
  const image = file.kind === "image";
  const pdf = file.mime === "application/pdf";
  return <figure className={s.previewCard}>
    {(image || pdf) && !file.deleted && <a className={s.previewStage} href={attachmentUrl(file.id)}
      target="_blank" rel="noopener noreferrer" aria-label={`${name} dosyasını aç`}>
      {image ? imageFailed ? <span className={s.dim}>Önizleme yüklenemedi</span>
        : <img src={attachmentUrl(file.id, true)} alt={name} onError={() => setImageFailed(true)} />
        : <PdfThumbnail url={attachmentUrl(file.id)} name={name} />}
    </a>}
    <figcaption className={s.previewCaption}>
      <a href={attachmentUrl(file.id)} download={name} className={s.fileName} title={name}>
        <Icon name="file" size={14} /><span>{name}</span>
      </a>
      {onRemove !== undefined && <button type="button" className={s.x} aria-label={`${name} çıkar`} onClick={onRemove}><Icon name="x" size={14} /></button>}
      <span className={s.dim}>{file.deleted ? "Dosya silindi" : `${formatBytes(file.byte_size)}${pdf ? " · PDF, ilk sayfa" : ""}`}</span>
    </figcaption>
  </figure>;
}
