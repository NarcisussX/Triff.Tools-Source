/*
 * React page for /contact.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React, { useState } from "react";

export default function ContactPage() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [topic, setTopic] = useState("General");
    const [message, setMessage] = useState("");
    const [honeypot, setHoneypot] = useState("");
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<null | { ok: boolean; msg: string }>(null);

    function ContactOptions() {
        const discordProfileUrl = "https://discord.com/users/167048708649648128";

        const ign = "bait not tackle";
        const [copied, setCopied] = React.useState(false);

        async function copyIGN() {
            try {
                await navigator.clipboard.writeText(ign);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            } catch {
                setCopied(false);
            }
        }

        return (
            <div className="flex flex-col gap-3 text-[12px] leading-snug md:flex-row md:items-center md:justify-between">
                <a
                    href={discordProfileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tt2-button tt2-button--secondary"
                >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="mr-2 h-4 w-4">
                        <path
                            fill="currentColor"
                            d="M20 0H4C1.79 0 0 1.79 0 4v16c0 2.21 1.79 4 4 4h13.45l-.64-2.23 1.55 1.44 1.47 1.36L24 24V4c0-2.21-1.79-4-4-4z"
                        />
                    </svg>
                    Message me on Discord
                </a>

                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] uppercase tracking-widest text-slate-400">
                        In-game (EVE):
                    </span>
                    <code className="px-2 py-1 border border-[#2c2f36] bg-[#05070b] text-[11px] text-slate-100">
                        {ign}
                    </code>
                    <button
                        type="button"
                        onClick={copyIGN}
                        className="tt2-button tt2-button--secondary tt2-button--sm"
                    >
                        {copied ? "Copied" : "Copy"}
                    </button>
                </div>
            </div>
        );
    }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setStatus(null);

        if (!name.trim() || !email.trim() || !message.trim()) {
            setStatus({ ok: false, msg: "Please fill out name, email, and message." });
            return;
        }
        if (honeypot) {

            setStatus({ ok: true, msg: "Thanks! We’ll be in touch." });
            return;
        }

        setLoading(true);
        try {
            const res = await fetch("/api/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, email, topic, message }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setStatus({ ok: true, msg: "Message sent. I’ll get back to you soon." });
                setName("");
                setEmail("");
                setTopic("General");
                setMessage("");
            } else {
                setStatus({ ok: false, msg: data?.error || "Something went wrong." });
            }
        } catch (err) {
            setStatus({ ok: false, msg: "Network error. Try again." });
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="tt-tool-v2 min-h-screen text-slate-100 leading-snug">
            <div className="tt2-frame tt2-frame--centered">
                { }
                <div className="tt2-window">
                    { }
                    <div className="tt2-titlebar">
                        <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
                            <span className="uppercase tracking-widest text-[10px] text-slate-300">
                                Triff.Tools ▸ Contact
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-[9px] text-slate-400">
                            <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                                Connected
                            </span>
                            <span className="text-[#53b6ff]">Triff.Tools</span>
                            <span className="flex gap-1">
                                <span className="h-2 w-2 bg-[#53b6ff]" />
                                <span className="h-2 w-2 bg-[#3bbf5a]" />
                                <span className="h-2 w-2 bg-[#bf3b3b]" />
                            </span>
                        </div>
                    </div>

                    { }
                    <div className="tt2-contextbar text-[11px] text-slate-400">
                        <div className="flex items-center gap-3">
                            <span className="uppercase tracking-widest text-slate-300">
                                Overview ▸ Contact Form
                            </span>
                            <span className="flex items-center gap-1">
                                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                                <span>Message relay online</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2" />
                    </div>

                    { }
                    <div className="tt2-workspace space-y-4">
                        { }
                        <div className="tt2-notice">
                            <p className="text-[12px] text-slate-300 mb-1">
                                Questions, bugs, ideas, or partnership? Use this panel to send a
                                direct message to the Triff.Tools hangar.
                            </p>
                            <p className="text-[12px] text-slate-400">
                                Fill in your contact details and message below. You can also
                                reach me via Discord or in-game using the channels at the
                                bottom of this window.
                            </p>
                        </div>

                        { }
                        <form onSubmit={onSubmit} className="space-y-3">
                            { }
                            <div className="hidden">
                                <label className="text-[10px]">
                                    Company
                                    <input
                                        value={honeypot}
                                        onChange={(e) => setHoneypot(e.target.value)}
                                    />
                                </label>
                            </div>

                            <fieldset className="tt2-panel">
                                <div className="tt2-panel-head tt2-panel-title">
                                    Sender
                                </div>
                                <div className="tt2-panel-body grid gap-3 md:grid-cols-2">
                                    <div className="flex flex-col gap-0.5">
                                        <label
                                            className="tt2-field-label"
                                            htmlFor="name"
                                        >
                                            Name
                                        </label>
                                        <input
                                            id="name"
                                            className="w-full bg-[#05070b] border border-[#303236] px-3 py-2 text-[13px] outline-none focus:border-[#53b6ff] focus:ring-0"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="In-game name works too"
                                            required
                                        />
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <label
                                            className="tt2-field-label"
                                            htmlFor="email"
                                        >
                                            Email / Discord
                                        </label>
                                        <input
                                            id="email"
                                            className="w-full bg-[#05070b] border border-[#303236] px-3 py-2 text-[13px] outline-none focus:border-[#53b6ff] focus:ring-0"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="Your Email or Discord"
                                            inputMode="email"
                                        />
                                    </div>
                                </div>
                            </fieldset>

                            <fieldset className="tt2-panel">
                                <div className="tt2-panel-head tt2-panel-title">
                                    Message
                                </div>
                                <div className="tt2-panel-body space-y-3">
                                    <div className="flex flex-col gap-0.5">
                                        <label
                                            className="tt2-field-label"
                                            htmlFor="topic"
                                        >
                                            Topic
                                        </label>
                                        <select
                                            id="topic"
                                            className="w-full bg-[#05070b] border border-[#303236] px-3 py-2 text-[13px] outline-none focus:border-[#53b6ff] focus:ring-0"
                                            value={topic}
                                            onChange={(e) => setTopic(e.target.value)}
                                        >
                                            <option>General</option>
                                            <option>Bug report</option>
                                            <option>Feature request</option>
                                            <option>Business / sponsorship</option>
                                        </select>
                                    </div>

                                    <div className="flex flex-col gap-0.5">
                                        <label
                                            className="tt2-field-label"
                                            htmlFor="message"
                                        >
                                            Message Body
                                        </label>
                                        <textarea
                                            id="message"
                                            className="w-full min-h-[160px] bg-[#05070b] border border-[#303236] px-3 py-2 text-[13px] outline-none focus:border-[#53b6ff] focus:ring-0"
                                            value={message}
                                            onChange={(e) => setMessage(e.target.value)}
                                            placeholder="What's up?"
                                            required
                                        />
                                    </div>
                                </div>
                            </fieldset>

                            { }
                            <div className="flex items-center justify-between pt-2 border-t border-[#262933]">
                                <div className="text-[10px] text-slate-500">
                                    Messages are relayed via /api/contact.
                                </div>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="tt2-button tt2-button--primary min-w-[160px]"
                                >
                                    {loading ? "Sending…" : "Send Message"}
                                </button>
                            </div>

                            {status && (
                                <div
                                    className={`tt2-notice mt-2 ${
                                        status.ok
                                            ? "tt2-notice--success"
                                            : "tt2-notice--danger"
                                    }`}
                                >
                                    {status.msg}
                                </div>
                            )}
                        </form>

                        { }
                        <div className="tt2-panel">
                            <div className="tt2-panel-head tt2-panel-title">
                                Other Ways To Reach Me
                            </div>
                            <div className="tt2-panel-body">
                                <ContactOptions />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
