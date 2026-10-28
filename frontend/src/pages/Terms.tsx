import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type TermsSection = {
  id: string;
  eyebrow: string;
  title: string;
  body: ReactNode;
};

type SummaryCard = {
  label: string;
  title: string;
  text: string;
};

const effectiveDate = "May 25, 2026";

const navItems = [
  { id: "overview", label: "Overview" },
  { id: "free", label: "Free Service" },
  { id: "accounts", label: "Accounts" },
  { id: "acceptable-use", label: "Use Rules" },
  { id: "content", label: "Shared Content" },
  { id: "api", label: "API" },
  { id: "availability", label: "Availability" },
  { id: "warranty", label: "No Warranty" },
  { id: "esi", label: "EVE SSO" },
  { id: "ip", label: "IP" },
  { id: "changes", label: "Changes" },
  { id: "contact", label: "Contact" },
];

const summaryCards: SummaryCard[] = [
  {
    label: "Cost",
    title: "Free to use",
    text: "Triff.Tools is provided for free, out of pocket, for the EVE community.",
  },
  {
    label: "Reliability",
    title: "Best effort",
    text: "No uptime, data freshness, support, or continued-service promise is made.",
  },
  {
    label: "Use",
    title: "Do not abuse it",
    text: "Do not attack, overload, scrape abusively, or use public links for harmful content.",
  },
];

const sections: TermsSection[] = [
  {
    id: "overview",
    eyebrow: "Scope",
    title: "What these terms cover",
    body: (
      <>
        <p>
          These Terms of Use apply to Triff.Tools, including the website, account
          workspace, TriffFits, calculators, appraisals, battle reports,
          public fitting links, public APIs, and any native or installable app
          surfaces that use Triff.Tools systems.
        </p>
        <p>
          By using Triff.Tools, you agree to use it responsibly and accept that it is
          a free, best-effort EVE Online utility suite. If you do not agree with
          these terms, do not use the service.
        </p>
      </>
    ),
  },
  {
    id: "free",
    eyebrow: "Free Service",
    title: "Free, hobby-operated service",
    body: (
      <>
        <p>
          Triff.Tools is provided for free and is operated out of pocket. There are
          no paid subscriptions, service-level agreements, guaranteed response times,
          guaranteed feature timelines, or promises that any feature will remain
          available forever.
        </p>
        <p>
          Features may be changed, rate-limited, paused, removed, or discontinued at
          any time, especially when needed for security, cost control, reliability,
          game data changes, third-party API changes, or ordinary maintenance.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    eyebrow: "Accounts",
    title: "Accounts and workspace data",
    body: (
      <>
        <p>
          You are responsible for your account credentials and for activity under
          your account. Do not share passwords, attempt to access another user's
          account, or use automated login attempts against the service.
        </p>
        <p>
          Account features exist to save workspace state, fittings, tool settings,
          generated links, ESI-linked characters, and related EVE planning data. You
          can delete your account from the account page or from the TriffFits app
          account flow.
        </p>
        <p>
          Data handling, retention, ESI tokens, and account deletion are explained
          in the{" "}
          <Link to="/privacy" className="text-[#53b6ff] underline hover:text-[#7fc5ff]">
            Privacy Policy
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    eyebrow: "Acceptable Use",
    title: "Rules for using Triff.Tools",
    body: (
      <>
        <p>Do not use Triff.Tools to:</p>
        <ul className="space-y-1 text-slate-300">
          <li>Attack, probe, overload, disrupt, or attempt to bypass service limits.</li>
          <li>Access accounts, private data, generated links, APIs, or systems you are not allowed to access.</li>
          <li>Upload, submit, or link malware, phishing content, credential theft, or harmful automation.</li>
          <li>Harass people, publish private personal information, or use generated pages for abusive content.</li>
          <li>Misrepresent Triff.Tools as affiliated with CCP Games, EVE Online, or any third party.</li>
          <li>Use the service in a way that creates unreasonable hosting, database, bandwidth, or support burden.</li>
        </ul>
        <p>
          Access may be blocked, limited, or removed for abuse, security risk,
          excessive automated traffic, or behavior that threatens the service for
          everyone else.
        </p>
      </>
    ),
  },
  {
    id: "content",
    eyebrow: "Generated Links",
    title: "Public and shared content",
    body: (
      <>
        <p>
          Some tools create shareable outputs, including appraisals, battle reports,
          combat log reports, fitting links, notes, bookmarks, or other generated
          pages. If you create or share a public link, anyone with that link may be
          able to view it.
        </p>
        <p>
          You are responsible for content you create, import, paste, save, or share.
          By creating a generated or public link, you give Triff.Tools permission to
          host, display, cache, format, and serve that content as needed to operate
          the feature.
        </p>
        <p>
          Public generated links may be removed, hidden, detached from an account, or
          limited when needed for abuse prevention, privacy, maintenance, or service
          integrity.
        </p>
      </>
    ),
  },
  {
    id: "api",
    eyebrow: "API",
    title: "API and automated access",
    body: (
      <>
        <p>
          Public API endpoints are provided for convenience and community tooling.
          You may use documented endpoints in a reasonable way, including to build
          links into Triff.Tools or retrieve public tool data.
        </p>
        <p>
          Do not bypass rate limits, hammer endpoints, scrape private account data,
          cache-bust aggressively, impersonate other users, or depend on undocumented
          behavior as if it were guaranteed. API shapes, limits, and availability may
          change without notice.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    eyebrow: "Availability",
    title: "No expectation of continued service",
    body: (
      <>
        <p>
          Triff.Tools may be unavailable, slow, stale, inaccurate, broken, restarted,
          migrated, or taken offline. Market data, ESI data, SDE data, zKillboard
          data, fitting imports, saved workspaces, generated links, and app behavior
          can fail or become outdated.
        </p>
        <p>
          You should not rely on Triff.Tools as your only copy of important data.
          Export or back up anything you cannot afford to lose.
        </p>
      </>
    ),
  },
  {
    id: "warranty",
    eyebrow: "Disclaimer",
    title: "No warranty",
    body: (
      <>
        <p>
          Triff.Tools is provided "as is" and "as available" without warranties of
          any kind. This includes no warranty that the service will be accurate,
          uninterrupted, secure, error-free, compatible with your device, or fit for
          a particular purpose.
        </p>
        <p>
          Calculations, prices, fits, appraisals, battle reports, wormhole data,
          industry estimates, and other outputs are informational tools for a video
          game. You are responsible for checking results before acting on them.
        </p>
        <p>
          To the fullest extent allowed by law, Triff.Tools and its operator are not
          liable for lost data, lost profits, lost game assets, account issues,
          downtime, third-party API failures, indirect damages, or reliance on tool
          outputs.
        </p>
      </>
    ),
  },
  {
    id: "esi",
    eyebrow: "EVE SSO",
    title: "EVE Online, ESI, and third-party data",
    body: (
      <>
        <p>
          EVE SSO and ESI access are provided by CCP Games. Triff.Tools can only use
          ESI scopes that you authorize, and CCP systems may be unavailable, changed,
          rate-limited, or revoked independently of Triff.Tools.
        </p>
        <p>
          Triff.Tools is not affiliated with or endorsed by CCP Games. EVE Online,
          EVE SSO, ESI, EVE names, EVE marks, EVE images, and related game assets
          belong to CCP hf and their respective owners.
        </p>
      </>
    ),
  },
  {
    id: "ip",
    eyebrow: "Licenses",
    title: "Ownership, licenses, and notices",
    body: (
      <>
        <p>
          Triff.Tools original source code is licensed separately under the project
          license. Third-party notices, CCP asset notices, Pyfa/eos notes, and
          other dependency notices are maintained in the repository and
          service documentation.
        </p>
        <p>
          These terms do not transfer ownership of your original content to
          Triff.Tools. They grant only the permission needed to store, process,
          display, share, and operate the content or links you choose to use with the
          service.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    eyebrow: "Updates",
    title: "Changes to these terms",
    body: (
      <>
        <p>
          These terms may be updated when features, account flows, public sharing,
          APIs, app store requirements, data handling, or operating needs change. The
          effective date at the top of this page will be updated when material
          changes are made.
        </p>
        <p>
          Continued use of Triff.Tools after changes means you accept the updated
          terms.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    eyebrow: "Contact",
    title: "Questions and reports",
    body: (
      <>
        <p>
          For terms questions, abuse reports, public-link takedown requests, account
          issues, privacy questions, or ESI concerns, use the{" "}
          <Link to="/contact" className="text-[#53b6ff] underline hover:text-[#7fc5ff]">
            contact page
          </Link>
          .
        </p>
      </>
    ),
  },
];

function TermsPanel({ section, index }: { section: TermsSection; index: number }) {
  return (
    <section id={section.id} className="tt2-panel scroll-mt-20 overflow-hidden">
      <div className="tt2-panel-head">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 bg-[#53b6ff]" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-300">
            {section.eyebrow}
          </span>
        </div>
        <span className="font-mono text-[10px] text-slate-500">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <div className="space-y-3 px-4 py-4 text-[13px] leading-6 text-slate-400 sm:px-5">
        <h2 className="text-[17px] font-semibold uppercase tracking-widest text-slate-100">
          {section.title}
        </h2>
        {section.body}
      </div>
    </section>
  );
}

export default function TermsOfUse() {
  return (
    <div className="tt-tool-v2 min-h-screen leading-snug text-slate-100">
      <div className="tt2-frame tt2-frame--centered">
        <div className="tt2-window">
          <div className="tt2-titlebar">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
              <span className="text-[10px] uppercase tracking-widest text-slate-300">
                Triff.Tools &gt; Terms of Use
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-slate-400">
              <span className="border border-[#303236] bg-[#0b0d11] px-1 py-0.5">
                Effective {effectiveDate}
              </span>
              <span className="text-[#53b6ff]">Triff.Tools</span>
              <span className="flex gap-1">
                <span className="h-2 w-2 bg-[#53b6ff]" />
                <span className="h-2 w-2 bg-[#3bbf5a]" />
                <span className="h-2 w-2 bg-[#bf3b3b]" />
              </span>
            </div>
          </div>

          <div className="tt2-contextbar flex-col items-start text-[11px] text-slate-400 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-3">
              <span className="uppercase tracking-widest text-slate-300">
                Legal &gt; Acceptable Use
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                <span>Website, APIs, and TriffFits app</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/privacy" className="text-[#53b6ff] underline hover:text-[#7fc5ff]">
                Privacy
              </Link>
              <Link to="/contact" className="text-[#53b6ff] underline hover:text-[#7fc5ff]">
                Contact
              </Link>
            </div>
          </div>

          <div className="tt2-workspace space-y-4">
            <div className="grid gap-3 lg:grid-cols-[1.6fr_0.8fr]">
              <section className="tt2-notice px-4 py-4">
                <p className="mb-2 text-[13px] text-slate-300">
                  Triff.Tools is a free EVE Online tool suite provided as a
                  best-effort community service.
                </p>
                <p className="text-[12px] leading-relaxed text-slate-400">
                  These terms set expectations for accounts, generated links, public
                  APIs, acceptable use, third-party data, availability, and the lack
                  of warranty or guaranteed continued service.
                </p>
              </section>

              <aside className="tt2-panel">
                <div className="tt2-panel-head tt2-panel-title">
                  Quick nav
                </div>
                <div className="grid grid-cols-2 gap-1 p-2">
                  {navItems.map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className="tt2-button tt2-button--ghost tt2-button--sm justify-start"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              </aside>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {summaryCards.map((card) => (
                <div key={card.label} className="tt2-panel px-4 py-3">
                  <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
                    {card.label}
                  </div>
                  <div className="text-[13px] font-semibold text-slate-100">{card.title}</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    {card.text}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {sections.map((section, index) => (
                <TermsPanel key={section.id} section={section} index={index} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
