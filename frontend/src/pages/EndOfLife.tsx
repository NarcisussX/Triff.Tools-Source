import type { ReactNode } from "react";
import { Link } from "react-router-dom";

const sections: { id: string; label: string; title: string; body: ReactNode }[] = [
  {
    id: "shutdown",
    label: "Shutdown",
    title: "What happens on October 30",
    body: <>
      <p>I’m shutting down the server that runs Triff.Tools on October 30, 2026. The site’s tools, accounts, saved fits, calculations, and APIs will no longer be available. TriffFits uses the same server, so it will stop working too, and I’ll be removing it from the App Store.</p>
      <p>Saved fits are attached to your account. They are NOT saved locally on your phone. Keeping the app installed will not let you access them after the server is gone. Please export anything you want to keep as EFT before October 30 and save a copy yourself.</p>
      <Link to="/fitting" className="tt2-button tt2-button--primary">Open fitting tool</Link>
    </>,
  },
  {
    id: "why",
    label: "Reason",
    title: "Why I’m shutting it down",
    body: <>
      <p>After 6,000 hours across the last 3 years, 18 accounts, 3 corps and countless wormholes, I no longer play EVE.</p>
      <p>The server costs me $90 a month. At the end of the day, I don’t want to keep paying for and maintaining a service for a game I’m no longer playing. This was a free service I provided out of pocket, and was happy to do, but my ability to guarantee accuracy and stay on top of changes is greatly reduced. The recent changes to low class wormhole combat sites is an excellent example, and just the first of many I expect to fall behind on in the future. I am unwilling to accept donations or host ads for a myriad of reasons, and offsetting the costs doesn't remove the root of the problem at the end of the day.</p>
    </>,
  },
  {
    id: "maintenance",
    label: "Maintenance",
    title: "Why I’m not handing it over",
    body: <>
      <p>There is a ridiculous amount going on behind this site. It’s a website, sure, but it's also a mobile app, a backend API, a <em>monsterous</em> database that handles everything from your accounts to the kills in the BR's you've generated, market workers, game-data imports, and a separate Python fitting service running Pyfa/eos. Then there’s EVE SSO, ESI, character tokens, caching, and the external services all of this relies on.</p>
      <p>All of those parts have to work together. A change to EVE, an API, or a dependency can break something so far up the chain that a new maintainer will never find it. I didn't document <em>shit</em>. Someone would have to understand the setup, deal with updates, fix failures, and be responsible for the accounts and data stored on it.</p>
      <p>I don’t want to turn shutting this down into another project where I’m teaching someone the whole architecture and still getting pulled in when something breaks. I’m trying to stop maintaining it.</p>
      <p>It’s also my site with my name on it. If I hand it over and it’s badly maintained, or something goes wrong with people’s data, my reputation is still attached to it. I’m not comfortable putting that in someone else’s hands while people still know it as my service. So I won’t be handing over maintenance of Triff.Tools or TriffFits.</p>
    </>,
  },
  {
    id: "triffview",
    label: "TriffView",
    title: "TriffView will still be available",
    body: <>
      <p>This shutdown does not include TriffView. It will still be fully available and open source on GitHub. The releases and source code will remain there after this site is gone, so bookmark the GitHub page if you use it.</p>
      <div className="flex flex-wrap gap-2">
        <a className="tt2-button tt2-button--primary" href="https://github.com/NarcisussX/TriffView/releases" target="_blank" rel="noopener noreferrer">TriffView releases</a>
        <a className="tt2-button tt2-button--secondary" href="https://github.com/NarcisussX/TriffView" target="_blank" rel="noopener noreferrer">Source code</a>
      </div>
    </>,
  },
  {
    id: "thanks",
    label: "Community",
    title: "Thank you",
    body: <>
      <p>To everyone who used the site or TriffFits, thank you. I put a lot of work into these tools, and it meant a lot that other people found them useful. No matter how much or how little you used it, I’m glad it helped.</p>
      <p>Thank you to everyone who reported bugs and gave me suggestions/requests for new features. There are so many edge cases in EVE that I was never going to catch all of them myself. People testing things and coming back with more details made this hobby so much more enjoyable, and arguably, possible. I appreciate the patience when a fix took longer than expected or I took too long to respond to an email/implement a request.</p>
      <p>And thank you to everyone who shared the site with their friends, corps, or alliances. You didn’t have to recommend it or help someone else figure out how to use it, but you did. For a personal project, having people use your work and then go out of their way to pass it along means a lot.</p>
      <p>I also want to thank the people behind the libraries, data sources, and other EVE tools this project used, especially Pyfa/eos. A lot of work goes into maintaining those projects, and this site depended on it.</p>
      <p>I’m done running the service, but I’m glad I built it and that people got use out of it. Thanks for the feedback, the support, and the time you spent with it.</p>
      <p className="text-slate-200">o7<br />Triff</p>
    </>,
  },
];

export default function EndOfLife() {
  return (
    <div className="tt-tool-v2 min-h-screen leading-snug text-slate-100">
      <div className="tt2-frame tt2-frame--centered">
        <div className="tt2-window">
          <div className="tt2-titlebar">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
              <span className="text-[10px] uppercase tracking-widest text-slate-300">Triff.Tools &gt; End of service</span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-slate-400">
              <span className="border border-[#303236] bg-[#0b0d11] px-1 py-0.5">October 30, 2026</span>
              <span className="hidden gap-1 sm:flex" aria-hidden="true">
                <span className="h-2 w-2 bg-[#53b6ff]" />
                <span className="h-2 w-2 bg-[#3bbf5a]" />
                <span className="h-2 w-2 bg-[#bf3b3b]" />
              </span>
            </div>
          </div>
          <div className="tt2-contextbar">
            <span className="uppercase tracking-widest">Website, APIs, and TriffFits app</span>
            <Link to="/" className="text-[#53b6ff] underline hover:text-[#7fc5ff]">Home</Link>
          </div>
          <div className="tt2-workspace space-y-3">
            <section className="tt2-notice space-y-3 px-4 py-4 text-[13px] leading-6 text-slate-400">
              <h1 className="text-[17px] font-semibold uppercase tracking-widest text-slate-100">Triff.Tools and TriffFits are shutting down October 30</h1>
              <p>On October 30, 2026, I’m shutting down the infrastructure that powers Triff.Tools and TriffFits.</p>
              <p><strong className="text-slate-100">Please export any fits you want to keep before October 30.</strong> Fits are NOT saved locally and will be inaccessible via the browser or app after this date.</p>
            </section>
            {sections.map((section, index) => (
              <section key={section.id} id={section.id} className="tt2-panel scroll-mt-20 overflow-hidden">
                <div className="tt2-panel-head">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 bg-[#53b6ff]" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-300">{section.label}</span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-500">{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className="space-y-3 px-4 py-4 text-[13px] leading-6 text-slate-400 sm:px-5">
                  <h2 className="text-[17px] font-semibold uppercase tracking-widest text-slate-100">{section.title}</h2>
                  {section.body}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
