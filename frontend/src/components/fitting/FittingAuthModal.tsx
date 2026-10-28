import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import loginImage from "../../assets/login.png";
import type { AuthUser } from "./types";

type Mode = "login" | "register";

type Props = {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onLogin: (username: string, password: string) => Promise<AuthUser | null>;
  onRegister: (username: string, password: string) => Promise<AuthUser | null>;
  initialMode?: Mode;
};

const inputClass =
  "w-full border border-[#303236] bg-[#05070b] px-2 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#53b6ff]";
const buttonClass =
  "inline-flex h-7 items-center justify-center gap-1 border border-[#303236] bg-[#05070b] px-2.5 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101219] disabled:cursor-not-allowed disabled:opacity-50";
const primaryClass =
  "inline-flex h-7 items-center justify-center gap-1 border border-[#46b2ff]/70 bg-gradient-to-b from-[#1b8cc8] to-[#14608a] px-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-50 shadow-[0_0_10px_rgba(70,178,255,0.35)] hover:from-[#27a0df] hover:to-[#1672a4] disabled:cursor-not-allowed disabled:opacity-60";

const syncHighlights = [
  "Saved fleets, fits, production chains, and POS layouts",
  "Wormhole bookmarks, notes, tags, and item bookmarks",
  "Market quickbar plus remembered calculator preferences",
];

export default function FittingAuthModal({ open, busy = false, error, onClose, onLogin, onRegister, initialMode = "login" }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setLocalError(null);
  }, [open, initialMode]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    if (mode === "register" && password !== confirmPassword) {
      setLocalError("Passwords do not match.");
      return;
    }
    const user = mode === "register" ? await onRegister(username, password) : await onLogin(username, password);
    if (user) {
      setPassword("");
      setConfirmPassword("");
    }
  }

  return createPortal(
    <div
      className="fitting-auth-modal fixed inset-0 z-[10000] overflow-y-auto overscroll-contain bg-black/70 px-3 py-3"
      style={{
        paddingTop: "calc(0.75rem + env(safe-area-inset-top))",
        paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))",
      }}
    >
      <div className="flex min-h-full items-center justify-center">
        <div
          className="relative flex max-h-[calc(100vh-24px)] w-[min(920px,calc(100vw-24px))] flex-col overflow-hidden border border-[#34404c] bg-[#070910] text-slate-100 shadow-2xl shadow-black/70"
          style={{ maxHeight: "calc(100dvh - 1.5rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))" }}
        >
          <div className="absolute right-2 top-2 z-20">
            <button type="button" className="text-slate-500 hover:text-slate-100" onClick={onClose} aria-label="Close">
              <X size={15} />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 overflow-y-auto lg:h-[560px] lg:grid-cols-[minmax(0,1.18fr)_390px] lg:overflow-hidden">
            <section
              className="relative min-h-[220px] overflow-hidden border-b border-[#34404c] bg-cover bg-center sm:min-h-[280px] lg:min-h-full lg:border-b-0 lg:border-r"
              style={{
                backgroundImage: `linear-gradient(90deg, rgba(3,6,11,0.92) 0%, rgba(3,6,11,0.72) 38%, rgba(3,6,11,0.14) 100%), url(${loginImage})`,
              }}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-[#53b6ff]/60" />
              <div className="flex h-full min-h-[220px] flex-col justify-between p-4 sm:min-h-[280px] sm:p-5">
                <div className="max-w-[360px]">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-[#8bd3ff]">
                    Triff.Tools Account
                  </div>
                  <h2 className="mt-3 text-[25px] font-semibold uppercase leading-tight tracking-[0.12em] text-slate-50 sm:text-[30px]">
                    Give Your Tools A Memory
                  </h2>
                  <p className="mt-3 text-[12px] leading-6 text-slate-300">
                    Stop rebuilding the same fits, fleets, and calculator inputs every time you change browsers or reload
                    the tab. Your account turns Triff.Tools into a persistent workspace.
                  </p>
                </div>

                <div className="hidden max-w-[430px] space-y-2 sm:block">
                  <div className="border-l-2 border-[#53b6ff] bg-black/45 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Your Account Unlocks</div>
                    <div className="mt-1 text-[13px] font-semibold text-slate-100">
                      A synced experience across different browsers, devices and sessions. Make the planning stage less
                      painful, today!
                    </div>
                  </div>
                  <div className="grid gap-1.5 text-[11px]">
                    {syncHighlights.map((item) => (
                      <div key={item} className="grid grid-cols-[20px,1fr] items-start gap-2 bg-black/35 px-2.5 py-1.5">
                        <span className="mt-1 h-1.5 w-1.5 bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.8)]" />
                        <span className="text-slate-300">{item}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    No email required. ESI optional. Private to your account.
                  </div>
                </div>
              </div>
            </section>

            <form className="flex min-h-0 flex-col bg-[#070910]" onSubmit={submit}>
              <div className="min-h-0 flex-1 lg:overflow-y-auto">
                <div className="border-b border-[#20242c] bg-[#101219] px-4 py-3 pr-8">
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-200">
                    {mode === "register" ? "Create Account" : "Sign In"}
                  </div>
                  <div className="mt-1 text-[10px] leading-4 text-slate-500">
                    {mode === "register"
                      ? "Start syncing your saved tool workspace."
                      : "Bring your saved workspace back online."}
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  <div className="grid grid-cols-2 border border-[#303236] bg-[#05070b]">
                    {(["login", "register"] as Mode[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        className={`h-8 text-[10px] uppercase tracking-widest ${
                          mode === key ? "bg-[#16202a] text-[#8bd3ff]" : "text-slate-500 hover:text-slate-200"
                        }`}
                        onClick={() => {
                          setMode(key);
                          setLocalError(null);
                        }}
                      >
                        {key === "login" ? "Sign in" : "Create"}
                      </button>
                    ))}
                  </div>

                  <div className="border border-[#20242c] bg-[#05070b] px-2.5 py-2 text-[11px] leading-5 text-slate-400">
                    {mode === "register"
                      ? "Create one lightweight account and the tools can finally remember the setup work you already did."
                      : "Sign in once and your saved setups and preferences come with you, anywhere."}
                  </div>

                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Username</span>
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      className={inputClass}
                      autoComplete="username"
                      maxLength={32}
                      placeholder="Your Triff.Tools username"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Password</span>
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className={inputClass}
                      type="password"
                      autoComplete={mode === "register" ? "new-password" : "current-password"}
                      placeholder={mode === "register" ? "Choose a unique password" : "Your password"}
                    />
                  </label>

                  {mode === "register" && (
                    <>
                      <label className="block">
                        <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Confirm Password</span>
                        <input
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          className={inputClass}
                          type="password"
                          autoComplete="new-password"
                          placeholder="Type it again"
                        />
                      </label>
                      <div className="border border-[#60472c] bg-[#130f08] px-2 py-2 text-[11px] leading-relaxed text-[#ffdca8]">
                        Use a unique password for triff.tools. Do not reuse a password from EVE, Discord, email, banking, or any other site.
                      </div>
                    </>
                  )}

                  {(localError || error) && (
                    <div className="border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[11px] text-[#ffaaaa]">{localError || error}</div>
                  )}
                </div>
              </div>

              <div className="sticky bottom-0 z-10 shrink-0 border-t border-[#20242c] bg-[#05070b] p-4">
                <div className="flex justify-end gap-2">
                  <button type="button" className={buttonClass} onClick={onClose}>
                    Cancel
                  </button>
                  <button type="submit" className={primaryClass} disabled={busy}>
                    {busy && <Loader2 size={13} className="animate-spin" />}
                    {mode === "register" ? "Create account" : "Sign in and sync"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
