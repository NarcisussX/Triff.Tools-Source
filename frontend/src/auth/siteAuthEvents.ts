import type { AuthUser } from "../components/fitting/types";

export const SITE_AUTH_CHANGED_EVENT = "triff:site-auth-changed";
export const SITE_AUTH_OPEN_EVENT = "triff:site-auth-open";

export type SiteAuthMode = "login" | "register";

export type SiteAuthChangeDetail = {
  user: AuthUser | null;
};

export type SiteAuthOpenDetail = {
  mode?: SiteAuthMode;
};

export function notifySiteAuthChanged(user: AuthUser | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SiteAuthChangeDetail>(SITE_AUTH_CHANGED_EVENT, {
      detail: { user },
    })
  );
}

export function requestSiteAuthModal(mode: SiteAuthMode = "login") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SiteAuthOpenDetail>(SITE_AUTH_OPEN_EVENT, {
      detail: { mode },
    })
  );
}
