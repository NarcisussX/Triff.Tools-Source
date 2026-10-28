import { useCallback, useEffect, useMemo, useState } from "react";
import {
  requestSiteAuthModal,
  SITE_AUTH_CHANGED_EVENT,
  type SiteAuthChangeDetail,
} from "../auth/siteAuthEvents";
import type { AuthUser } from "../components/fitting/types";

export type ItemBookmark = {
  type_id: number;
  name: string;
  description: string | null;
  published: boolean;
  group: { group_id: number; name: string | null } | null;
  category: { category_id: number; name: string | null } | null;
  market_group: { market_group_id: number; name: string | null } | null;
  icon_url: string | null;
  createdAt?: string;
  updatedAt?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  }
  return data as T;
}

export function useItemBookmarks() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [bookmarks, setBookmarks] = useState<ItemBookmark[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  const [bookmarkError, setBookmarkError] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadAuth() {
      try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        const payload = await readJson<{ ok: boolean; authenticated: boolean; user: AuthUser | null }>(response);
        if (alive) setAuthUser(payload.authenticated ? payload.user : null);
      } catch {
        if (alive) setAuthUser(null);
      } finally {
        if (alive) setAuthChecked(true);
      }
    }

    function handleAuthChanged(event: Event) {
      const detail = (event as CustomEvent<SiteAuthChangeDetail>).detail;
      if (detail && "user" in detail) {
        setAuthUser(detail.user);
        setAuthChecked(true);
      } else {
        void loadAuth();
      }
    }

    void loadAuth();
    window.addEventListener(SITE_AUTH_CHANGED_EVENT, handleAuthChanged);
    return () => {
      alive = false;
      window.removeEventListener(SITE_AUTH_CHANGED_EVENT, handleAuthChanged);
    };
  }, []);

  const refreshBookmarks = useCallback(async () => {
    if (!authUser) return;
    try {
      setBookmarksLoading(true);
      const response = await fetch("/api/items/bookmarks", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await readJson<{ ok: boolean; bookmarks: ItemBookmark[] }>(response);
      setBookmarks(payload.bookmarks || []);
      setBookmarkError("");
    } catch (error: any) {
      setBookmarks([]);
      setBookmarkError(error?.message || "Failed to load item bookmarks.");
    } finally {
      setBookmarksLoading(false);
    }
  }, [authUser]);

  useEffect(() => {
    if (!authUser) {
      setBookmarks([]);
      setBookmarkError("");
      setBookmarksLoading(false);
      return;
    }
    void refreshBookmarks();
  }, [authUser, refreshBookmarks]);

  const bookmarkedTypeIds = useMemo(() => {
    return new Set(bookmarks.map((bookmark) => Number(bookmark.type_id)));
  }, [bookmarks]);

  const addBookmark = useCallback(
    async (typeId: number) => {
      if (!authUser) {
        requestSiteAuthModal("login");
        return null;
      }
      try {
        const response = await fetch(`/api/items/bookmarks/${encodeURIComponent(String(typeId))}`, {
          method: "PUT",
          credentials: "include",
        });
        const payload = await readJson<{ ok: boolean; bookmark: ItemBookmark }>(response);
        setBookmarks((prev) => {
          const without = prev.filter((bookmark) => Number(bookmark.type_id) !== Number(typeId));
          return [payload.bookmark, ...without];
        });
        setBookmarkError("");
        return payload.bookmark;
      } catch (error: any) {
        setBookmarkError(error?.message || "Failed to bookmark item.");
        return null;
      }
    },
    [authUser]
  );

  const removeBookmark = useCallback(
    async (typeId: number) => {
      if (!authUser) {
        requestSiteAuthModal("login");
        return false;
      }
      try {
        const response = await fetch(`/api/items/bookmarks/${encodeURIComponent(String(typeId))}`, {
          method: "DELETE",
          credentials: "include",
        });
        await readJson<{ ok: boolean }>(response);
        setBookmarks((prev) => prev.filter((bookmark) => Number(bookmark.type_id) !== Number(typeId)));
        setBookmarkError("");
        return true;
      } catch (error: any) {
        setBookmarkError(error?.message || "Failed to remove item bookmark.");
        return false;
      }
    },
    [authUser]
  );

  const toggleBookmark = useCallback(
    async (typeId: number) => {
      if (bookmarkedTypeIds.has(Number(typeId))) {
        return removeBookmark(typeId);
      }
      return addBookmark(typeId);
    },
    [addBookmark, bookmarkedTypeIds, removeBookmark]
  );

  return {
    authUser,
    authChecked,
    bookmarks,
    bookmarkedTypeIds,
    bookmarksLoading,
    bookmarkError,
    refreshBookmarks,
    addBookmark,
    removeBookmark,
    toggleBookmark,
  };
}
