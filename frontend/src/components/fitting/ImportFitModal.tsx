import { ClipboardPaste, Copy, Link2, Loader2, X } from "lucide-react";

type Props = {
  open: boolean;
  mode: "import" | "export";
  text: string;
  busy?: boolean;
  shareBusy?: boolean;
  shareLink?: string | null;
  shareError?: string | null;
  onTextChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onShareLink?: () => void;
  onCopyShareLink?: () => void;
};

const buttonBase =
  "inline-flex items-center justify-center gap-1 border border-[#303236] bg-[#05070b] px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101219] disabled:cursor-not-allowed disabled:opacity-50";

export default function ImportFitModal({
  open,
  mode,
  text,
  busy = false,
  shareBusy = false,
  shareLink = null,
  shareError = null,
  onTextChange,
  onClose,
  onSubmit,
  onShareLink,
  onCopyShareLink,
}: Props) {
  if (!open) return null;

  const isImport = mode === "import";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-3">
      <div className="w-full max-w-3xl border border-[#3a3c40] bg-[#05070b] shadow-[0_0_24px_rgba(0,0,0,0.9)]">
        <div className="flex h-9 items-center justify-between border-b border-[#3a3c40] bg-[#101219] px-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-300">
            {isImport ? "Import EFT / Pyfa" : "Share / Export EFT"}
          </div>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-300 hover:border-red-400/70 hover:text-red-200"
            onClick={onClose}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="p-3">
          <textarea
            value={text}
            readOnly={!isImport}
            onChange={(event) => onTextChange(event.target.value)}
            className="h-[360px] w-full resize-none border border-[#303236] bg-[#030509] p-2 font-mono text-[11px] leading-5 text-slate-100 outline-none focus:border-[#53b6ff]"
            spellCheck={false}
          />
          {!isImport && shareLink && (
            <div className="mt-2 flex flex-col gap-2 border border-[#1d76ad]/60 bg-[#07111a] px-2 py-1.5 text-[11px] text-[#9fddff] sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 break-all font-mono">{shareLink}</span>
              {onCopyShareLink && (
                <button type="button" className={`${buttonBase} shrink-0 px-2 py-1`} onClick={onCopyShareLink}>
                  <Copy size={13} />
                  Copy
                </button>
              )}
            </div>
          )}
          {!isImport && shareError && (
            <div className="mt-2 border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[11px] text-[#ffaaaa]">
              {shareError}
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className={buttonBase} onClick={onClose}>
              Close
            </button>
            {!isImport && onShareLink && (
              <button type="button" className={buttonBase} onClick={onShareLink} disabled={busy || shareBusy || !text.trim()}>
                {shareBusy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                Share link
              </button>
            )}
            <button type="button" className={buttonBase} onClick={onSubmit} disabled={busy}>
              {isImport ? <ClipboardPaste size={14} /> : <Copy size={14} />}
              {isImport ? "Import" : "Copy to clipboard"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
