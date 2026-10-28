/*
 * Public Item Browser search page.
 * Compact wiki-style lookup for EVE types backed by local SDE data.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Bookmark, Package, Search, X } from "lucide-react";
import { requestSiteAuthModal } from "../auth/siteAuthEvents";
import { ToolChrome } from "../components/tool-ui";
import { type ItemBookmark, useItemBookmarks } from "../items/itemBookmarks";

type SearchResult = {
  type_id: number;
  name: string;
  description: string | null;
  published: boolean;
  group: { group_id: number; name: string | null } | null;
  category: { category_id: number; name: string | null } | null;
  market_group: { market_group_id: number; name: string | null } | null;
  icon_url: string | null;
};

type SearchPayload = {
  ok: boolean;
  results: SearchResult[];
  error?: string;
};

type ItemOpenHandler = (typeId: number) => void;

const panel = "tt2-panel overflow-hidden";
const panelHeader =
  "tt2-panel-head tt2-panel-title";

function metaLine(item: {
  type_id: number;
  group: SearchResult["group"];
  market_group: SearchResult["market_group"];
  category: SearchResult["category"];
}) {
  return [
    `typeID ${item.type_id}`,
    item.group?.name,
    item.market_group?.name,
    item.category?.name,
  ]
    .filter(Boolean)
    .join(" - ");
}

function isImmediateNumeric(value: string) {
  return /^\d+$/.test(value.trim());
}

function TypeIcon({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed || !src) {
    return (
      <div className="flex h-10 w-10 items-center justify-center border border-[#252b35] bg-[#05070b] text-slate-600">
        <Package size={16} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className="h-10 w-10 border border-[#252b35] bg-[#05070b]"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function SavedBookmarkRow({
  item,
  onRemove,
  onOpenItem,
}: {
  item: ItemBookmark;
  onRemove: (typeId: number) => void;
  onOpenItem?: ItemOpenHandler;
}) {
  const content = (
    <>
      <TypeIcon src={item.icon_url} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Bookmark size={12} fill="currentColor" className="shrink-0 text-[#53b6ff]" />
          <span className="truncate text-[13px] font-medium text-slate-100 group-hover:text-white">
            {item.name}
          </span>
          {!item.published && (
            <span className="border border-[#5b4a2e] bg-[#1b1308] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#f1c26d]">
              Unpublished
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
          {metaLine(item)}
        </div>
      </div>
    </>
  );

  return (
    <div className="group grid min-h-[58px] grid-cols-[42px,1fr,36px] gap-2 border border-transparent px-2 py-2 transition-colors hover:border-[#53b6ff]/45 hover:bg-[#101621]">
      {onOpenItem ? (
        <button type="button" onClick={() => onOpenItem(item.type_id)} className="contents text-left">
          {content}
        </button>
      ) : (
        <Link to={`/items/${item.type_id}`} className="contents">
          {content}
        </Link>
      )}
      <button
        type="button"
        title="Remove bookmark"
        onClick={() => onRemove(item.type_id)}
        className="flex items-center justify-center text-slate-700 hover:text-[#ffaaaa]"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function SavedBookmarksPanel({
  authChecked,
  signedIn,
  bookmarks,
  loading,
  error,
  onRemove,
  onOpenItem,
}: {
  authChecked: boolean;
  signedIn: boolean;
  bookmarks: ItemBookmark[];
  loading: boolean;
  error: string;
  onRemove: (typeId: number) => void;
  onOpenItem?: ItemOpenHandler;
}) {
  return (
    <div className="tt2-panel text-left">
      <div className="tt2-panel-head">
        <div className="tt2-panel-title inline-flex items-center gap-1.5">
          <Bookmark size={12} />
          Bookmarked Items
        </div>
        {signedIn ? <span className="font-mono text-[9px] text-slate-600">{bookmarks.length}</span> : null}
      </div>

      {!authChecked ? (
        <div className="px-3 py-3 text-[12px] text-slate-500">Checking account...</div>
      ) : !signedIn ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-[12px] text-slate-500">
          <span>Sign in to bookmark items and keep them available across devices.</span>
          <button
            type="button"
            onClick={() => requestSiteAuthModal("login")}
            className="tt2-button tt2-button--primary tt2-button--sm"
          >
            Sign In
          </button>
        </div>
      ) : loading ? (
        <div className="px-3 py-3 text-[12px] text-slate-500">Loading bookmarked items...</div>
      ) : error ? (
        <div className="border-y border-[#52343a] bg-[#170a0e] px-3 py-3 text-[12px] text-[#ffb4b4]">
          {error}
        </div>
      ) : bookmarks.length ? (
        <div className="divide-y divide-[#20242d]">
          {bookmarks.map((item) => (
            <SavedBookmarkRow key={item.type_id} item={item} onRemove={onRemove} onOpenItem={onOpenItem} />
          ))}
        </div>
      ) : (
        <div className="px-3 py-3 text-[12px] text-slate-500">
          No bookmarked items yet.
        </div>
      )}
    </div>
  );
}

type ItemBrowserProps = {
  onOpenItem?: ItemOpenHandler;
};

export default function ItemBrowser({ onOpenItem }: ItemBrowserProps = {}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const {
    authUser,
    authChecked,
    bookmarks,
    bookmarksLoading,
    bookmarkError,
    removeBookmark,
  } = useItemBookmarks();

  const canSearch = useMemo(() => {
    const q = query.trim();
    return q.length >= 2 || isImmediateNumeric(q);
  }, [query]);

  const openItem = (typeId: number) => {
    if (onOpenItem) {
      onOpenItem(typeId);
      return;
    }
    navigate(`/items/${typeId}`);
  };

  useEffect(() => {
    const q = query.trim();
    if (!canSearch) {
      setResults([]);
      setError("");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const delay = isImmediateNumeric(q) ? 0 : 220;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetch(`/api/items/search?q=${encodeURIComponent(q)}&limit=50`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<SearchPayload>;
        })
        .then((payload) => {
          if (!payload.ok) throw new Error(payload.error || "Search failed");
          setResults(payload.results || []);
        })
        .catch((err: unknown) => {
          if ((err as Error).name === "AbortError") return;
          setError("Search failed. Local SDE data may still be loading.");
          setResults([]);
        })
        .finally(() => setLoading(false));
    }, delay);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, canSearch]);

  return (
    <div className="tt-tool-v2 min-h-screen text-slate-100">
      <div className="tt2-frame tt2-frame--centered">
        <div className="tt2-window">
          {onOpenItem ? (
            <div className="tt2-titlebar">
              <div>
                <div className="tt2-title">Reference / Item Browser</div>
                <div className="tt2-subtitle">Search the local EVE static data export</div>
              </div>
              <span className="hidden font-mono text-[11px] text-slate-500 sm:inline">SDE lookup</span>
            </div>
          ) : (
            <ToolChrome
              section="Reference"
              title="Item Browser"
              badge="SDE lookup"
              context="Search the local EVE static data export"
            />
          )}
          <div className="tt2-workspace space-y-4">
        <section className={panel}>
          <div className={panelHeader}>Reference / Item Browser</div>
          <div className="grid gap-4 p-4 md:grid-cols-[1fr,240px] md:items-end">
            <div>
              <h1 className="text-[24px] font-semibold uppercase tracking-[0.12em] text-slate-50">
                Item Browser
              </h1>
              <p className="mt-1 max-w-2xl text-[12px] leading-5 text-slate-400">
                Search local EVE SDE types by name or typeID, then inspect market, dogma, and industry links.
              </p>
            </div>
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const exact = results.find((row) => String(row.type_id) === query.trim());
                if (exact) openItem(exact.type_id);
              }}
            >
              <button
                type="submit"
                className="tt2-button tt2-button--secondary ml-auto w-full md:w-auto"
                disabled={!results.some((row) => String(row.type_id) === query.trim())}
              >
                Open TypeID
              </button>
            </form>
          </div>
        </section>

        <section className={panel}>
          <div className="flex border-b border-[#2c2f36] bg-[#030509] focus-within:border-[#53b6ff] focus-within:shadow-[inset_0_-1px_0_#53b6ff]">
            <div className="flex w-10 items-center justify-center text-slate-500">
              <Search size={16} />
            </div>
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search item name or typeID..."
              className="min-w-0 flex-1 border-0 bg-transparent px-2 py-3 text-[14px] text-slate-100 outline-none placeholder:text-slate-600"
            />
          </div>

          <div className="divide-y divide-[#252832]">
            {!canSearch && (
              <div className="space-y-4 px-3 py-8 text-center text-[12px] text-slate-500">
                <div>Enter at least 2 characters, or paste a numeric typeID.</div>
                {!query.trim() ? (
                  <SavedBookmarksPanel
                    authChecked={authChecked}
                    signedIn={Boolean(authUser)}
                    bookmarks={bookmarks}
                    loading={bookmarksLoading}
                    error={bookmarkError}
                    onRemove={(typeId) => void removeBookmark(typeId)}
                    onOpenItem={onOpenItem}
                  />
                ) : null}
              </div>
            )}

            {loading && (
              <div className="tt2-notice m-3 flex items-center gap-2"><span className="h-2 w-2 animate-pulse bg-[#53b6ff]" /> Searching local SDE...</div>
            )}

            {error && (
              <div className="tt2-notice tt2-notice--danger m-3">
                {error}
              </div>
            )}

            {canSearch && !loading && !error && results.length === 0 && (
              <div className="tt2-empty m-3">
                <div className="tt2-empty-title">No matching item types.</div>
              </div>
            )}

            {results.map((item) => {
              const rowClass =
                "group grid min-h-[62px] cursor-pointer grid-cols-[42px,1fr,30px] gap-3 border border-transparent px-3 py-2.5 transition-colors hover:border-[#53b6ff]/45 hover:bg-[#101621] focus:border-[#53b6ff]/60 focus:bg-[#101621] focus:outline-none";
              const content = (
                <>
                  <TypeIcon src={item.icon_url} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-slate-100 group-hover:text-white">
                        {item.name}
                      </span>
                      {!item.published && (
                        <span className="border border-[#5b4a2e] bg-[#1b1308] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#f1c26d]">
                          Unpublished
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                      {metaLine(item)}
                    </div>
                    {item.description && (
                      <p className="mt-1 line-clamp-1 text-[11px] text-slate-500">
                        {item.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-center text-slate-700 group-hover:text-[#53b6ff]">
                    <ArrowUpRight size={14} />
                  </div>
                </>
              );

              return onOpenItem ? (
                <button
                  type="button"
                  key={item.type_id}
                  onClick={() => openItem(item.type_id)}
                  className={`${rowClass} w-full text-left`}
                >
                  {content}
                </button>
              ) : (
                <Link key={item.type_id} to={`/items/${item.type_id}`} className={rowClass}>
                  {content}
                </Link>
              );
            })}
          </div>
        </section>
          </div>
        </div>
      </div>
    </div>
  );
}
