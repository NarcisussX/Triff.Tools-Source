import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type PolicySection = {
  id: string;
  eyebrow: string;
  title: string;
  body: ReactNode;
};

type DataRow = {
  label: string;
  text: ReactNode;
};

const effectiveDate = "May 25, 2026";

const navItems = [
  { id: "overview", label: "Overview" },
  { id: "data", label: "Data" },
  { id: "use", label: "Use" },
  { id: "analytics", label: "Analytics" },
  { id: "esi", label: "EVE SSO" },
  { id: "sharing", label: "Sharing" },
  { id: "retention", label: "Retention" },
  { id: "choices", label: "Choices" },
  { id: "security", label: "Security" },
  { id: "contact", label: "Contact" },
];

const dataRows: DataRow[] = [
  {
    label: "Account data",
    text: (
      <>
        Username, password hash, account IDs, sign-in timestamps, session records,
        native app authentication tokens, and basic account state used to keep your
        Triff.Tools workspace available across browsers and app installs.
      </>
    ),
  },
  {
    label: "Saved workspace",
    text: (
      <>
        Saved fitting data, calculator inputs, saved fleets, preferences, generated
        appraisal, battle report, and combat log report ownership links, quick
        settings, and other tool state that you choose to save or sync.
      </>
    ),
  },
  {
    label: "EVE SSO / ESI",
    text: (
      <>
        Character IDs, character names, EVE SSO owner hashes, granted scopes,
        encrypted access and refresh tokens, skill data, skill queue data, clone and
        implant data, sync timestamps, and token health/error state.
      </>
    ),
  },
  {
    label: "Generated content",
    text: (
      <>
        Appraisal pages, battle reports, combat log reports, fitting exports, and
        other generated outputs may contain item names, ship fits, ISK values,
        killmail-derived data, combat-log-derived summaries, pilot names,
        corporation/alliance names, and links you create or share.
      </>
    ),
  },
  {
    label: "Device and logs",
    text: (
      <>
        IP address, user agent, browser or app version, requested URLs, response
        status, timestamps, security events, diagnostics, and crash/error details
        needed to operate and debug the service.
      </>
    ),
  },
  {
    label: "Local storage",
    text: (
      <>
        Browser storage, cookies, IndexedDB data, service worker cache, and native app
        storage may hold session state, unsaved fitting workspace state, preferences,
        cached assets, and temporary tool data on your device.
      </>
    ),
  },
];

const sections: PolicySection[] = [
  {
    id: "overview",
    eyebrow: "Scope",
    title: "What this policy covers",
    body: (
      <>
        <p>
          This Privacy Policy explains how Triff.Tools handles data for the website,
          account workspace, TriffFits, calculators, appraisals, battle
          reports, APIs, and the TriffFits iOS app. The iOS app uses the same
          Triff.Tools account and backend systems as the website.
        </p>
        <p>
          Triff.Tools is an EVE Online utility suite. It is not operated by or
          affiliated with CCP Games. EVE SSO and ESI data come from CCP's systems
          only after you choose to authorize access.
        </p>
      </>
    ),
  },
  {
    id: "data",
    eyebrow: "Collection",
    title: "Information Triff.Tools may collect",
    body: (
      <>
        <p>
          Triff.Tools collects the data needed to run the tools, save your workspace,
          authenticate your account, call EVE ESI on your behalf, prevent abuse, and
          diagnose failures. The main categories are listed below.
        </p>
        <DataTable rows={dataRows} />
        <p>
          Triff.Tools does not intentionally collect payment card data, health data,
          contacts, photos, precise physical location, or advertising identifiers.
        </p>
      </>
    ),
  },
  {
    id: "use",
    eyebrow: "Purpose",
    title: "How the data is used",
    body: (
      <>
        <p>
          Data is used to authenticate you, keep your workspace persistent, load
          saved fits and characters, calculate tool outputs, refresh ESI data, sync
          app state, show account-specific pages, secure the service, fix bugs, and
          improve reliability.
        </p>
        <p>
          Account and ESI data are not used to build advertising profiles. Triff.Tools
          does not sell your personal information.
        </p>
      </>
    ),
  },
  {
    id: "analytics",
    eyebrow: "Measurement",
    title: "Google Analytics",
    body: (
      <>
        <p>
          Triff.Tools uses Google Analytics on browser pages to understand site
          traffic, popular tools, page views, referrers, device/browser context,
          and general usage patterns. This helps identify what is being used and
          where the site needs maintenance.
        </p>
        <p>
          Analytics is optional. When the analytics notice appears, you can allow
          or decline it. If you decline, Triff.Tools does not intentionally load
          Google Analytics for that browser. If you allow analytics or close the
          notice, your choice is saved in browser local storage as{" "}
          <code className="text-[#9dd8ff]">tt-analytics-consent</code>.
        </p>
        <p>
          Google may process analytics data according to its own Google Analytics
          terms and privacy practices. Google explains how Analytics collects and
          protects data on its{" "}
          <a
            href="https://support.google.com/analytics/answer/6004245"
            target="_blank"
            rel="noreferrer"
            className="text-[#53b6ff] underline hover:text-[#7fc5ff]"
          >
            Google Analytics data privacy page
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "esi",
    eyebrow: "EVE SSO",
    title: "EVE Online authentication and ESI",
    body: (
      <>
        <p>
          When you add an EVE character, Triff.Tools sends you to EVE Online SSO.
          CCP's login page asks you to approve scopes before Triff.Tools receives an
          authorization callback. Triff.Tools currently uses these scopes when needed:
        </p>
        <ul className="space-y-1 text-slate-300">
          <li>
            <code className="text-[#9dd8ff]">publicData</code>
          </li>
          <li>
            <code className="text-[#9dd8ff]">esi-skills.read_skills.v1</code>
          </li>
        </ul>
        <p>
          Access and refresh tokens are stored encrypted at rest and are used to
          refresh your character data until you unlink the character, delete your
          account, revoke access through CCP, or the token becomes invalid.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    eyebrow: "Disclosure",
    title: "When information is shared",
    body: (
      <>
        <p>
          Triff.Tools shares data only as needed to run the service, use third-party
          infrastructure, comply with law, investigate abuse, or display content that
          you intentionally publish or share.
        </p>
        <p>
          Generated appraisal and battle report links may be viewable by anyone who
          has the link. Some generated pages can remain available after account
          deletion because other people may already have those URLs, but the account
          ownership link is removed during deletion.
        </p>
        <p>
          EVE SSO and ESI requests are exchanged with CCP's systems. Hosting,
          logging, security, database, and build/deployment providers may process
          operational data on behalf of Triff.Tools. Triff.Tools does not sell data to
          data brokers or ad networks.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    eyebrow: "Retention",
    title: "How long information is kept",
    body: (
      <>
        <p>
          Account data, saved workspace data, and ESI links are kept while your
          account exists or while they are needed to provide the tool behavior you
          requested. Operational logs are kept for service health, security,
          debugging, and abuse prevention, then removed or rotated when no longer
          needed.
        </p>
        <p>
          Deleting your account removes your account, saved workspace records, saved
          fitting data, ESI tokens, and account associations to
          generated content. Locally cached browser or app data may remain on your
          own device until you clear it or reinstall the app.
        </p>
      </>
    ),
  },
  {
    id: "choices",
    eyebrow: "Control",
    title: "Your choices",
    body: (
      <>
        <p>
          You can use some Triff.Tools pages without an account. Sign-in is required
          for synced workspace state, saved fitting data, account-owned generated
          links, and ESI-backed character features.
        </p>
        <ul className="space-y-1 text-slate-300">
          <li>Use the account page to review workspace data and delete your account.</li>
          <li>Use the TriffFits app account sheet to sign out or delete the account.</li>
          <li>Unlink EVE characters from TriffFits when you no longer want ESI sync.</li>
          <li>Clear browser site data or reinstall the app to remove local cache from your device.</li>
        </ul>
      </>
    ),
  },
  {
    id: "security",
    eyebrow: "Protection",
    title: "Security practices",
    body: (
      <>
        <p>
          Triff.Tools uses HTTPS, hashed passwords, session controls, encrypted ESI
          tokens, and server-side access checks to protect account and character
          data. No internet service can promise perfect security, but the intent is
          to keep private workspace and ESI data private unless you explicitly share
          generated links.
        </p>
      </>
    ),
  },
  {
    id: "children",
    eyebrow: "Limits",
    title: "Children and international users",
    body: (
      <>
        <p>
          Triff.Tools is not directed to children under 13. If you believe a child
          has provided personal information, contact Triff.Tools so it can be
          reviewed and removed where appropriate.
        </p>
        <p>
          Triff.Tools is operated from the United States. If you use it from another
          country, your information may be processed in the United States or wherever
          service infrastructure is located.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    eyebrow: "Updates",
    title: "Changes and contact",
    body: (
      <>
        <p>
          This policy may be updated when Triff.Tools adds features, changes data
          handling, or needs clearer language. The effective date at the top of this
          page will be updated when material changes are made.
        </p>
        <p>
          For privacy questions, account deletion issues, or ESI concerns, use the{" "}
          <Link to="/contact" className="text-[#53b6ff] underline hover:text-[#7fc5ff]">
            contact page
          </Link>
          .
        </p>
      </>
    ),
  },
];

function DataTable({ rows }: { rows: DataRow[] }) {
  return (
    <div className="tt2-panel overflow-hidden">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid border-b border-[#20242c] last:border-b-0 sm:grid-cols-[190px_1fr]"
        >
          <dt className="border-b border-[#20242c] bg-[#101219] px-3 py-3 text-[11px] font-semibold uppercase tracking-widest text-slate-300 sm:border-b-0 sm:border-r">
            {row.label}
          </dt>
          <dd className="px-3 py-3 text-[13px] leading-6 text-slate-400">
            {row.text}
          </dd>
        </div>
      ))}
    </div>
  );
}

function PolicyPanel({ section, index }: { section: PolicySection; index: number }) {
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

export default function PrivacyPolicy() {
  return (
    <div className="tt-tool-v2 min-h-screen leading-snug text-slate-100">
      <div className="tt2-frame tt2-frame--centered">
        <div className="tt2-window">
          <div className="tt2-titlebar">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
              <span className="text-[10px] uppercase tracking-widest text-slate-300">
                Triff.Tools &gt; Privacy Policy
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-slate-400">
              <span className="border border-[#303236] bg-[#0b0d11] px-1 py-0.5">
                Effective {effectiveDate}
              </span>
              <span className="text-[#53b6ff]">TriffFits</span>
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
                Legal &gt; Account Workspace
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                <span>Website and iOS app</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/terms" className="text-[#53b6ff] underline hover:text-[#7fc5ff]">
                Terms
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
                  Triff.Tools uses accounts, saved workspaces, and EVE ESI-linked
                  characters to make its tools persistent across browsers and the
                  TriffFits app.
                </p>
                <p className="text-[12px] leading-relaxed text-slate-400">
                  This page explains what is stored, why it is stored, how it is
                  shared, and how you can delete or disconnect it. It is written to be
                  readable by actual humans and detailed enough for app privacy review.
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
              <div className="tt2-panel px-4 py-3">
                <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
                  Ads
                </div>
                <div className="text-[13px] font-semibold text-slate-100">No ad profiling</div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  Data is not sold to ad networks or data brokers.
                </p>
              </div>
              <div className="tt2-panel px-4 py-3">
                <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
                  ESI
                </div>
                <div className="text-[13px] font-semibold text-slate-100">
                  Character data by consent
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  Triff.Tools only receives EVE data after SSO authorization.
                </p>
              </div>
              <div className="tt2-panel px-4 py-3">
                <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
                  Deletion
                </div>
                <div className="text-[13px] font-semibold text-slate-100">
                  Account deletion available
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  Delete your account from the account page or TriffFits account sheet.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {sections.map((section, index) => (
                <PolicyPanel key={section.id} section={section} index={index} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
