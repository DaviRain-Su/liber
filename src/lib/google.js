// "Sign in with Google" — the browser half. Loads Google Identity Services on
// demand, renders Google's compliant button, and exchanges the returned ID token
// for a Liber session via /api/auth/google. Imperative + dynamically imported, so
// the GIS script never touches first paint.
import { api, setToken } from "./api.js";

const GIS_SRC = "https://accounts.google.com/gsi/client";
let gisLoading = null;

function loadGis() {
  if (typeof window !== "undefined" && window.google?.accounts?.id) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisLoading = null;
        reject(new Error("无法加载 Google 登录"));
      };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

// Whether Google login is configured on the backend (GOOGLE_CLIENT_ID set).
export async function googleConfigured() {
  try {
    return !!(await api.auth.googleConfig())?.clientId;
  } catch {
    return false;
  }
}

// Render Google's button into `el`. onSuccess({user, token}) fires after a
// successful sign-in; onError(err) on failure. Returns true if mounted (i.e.
// configured), false if Google login is off (caller hides its container).
export async function mountGoogleButton(el, { onSuccess, onError } = {}) {
  try {
    const clientId = (await api.auth.googleConfig())?.clientId;
    if (!clientId || !el) return false;
    await loadGis();
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (resp) => {
        try {
          if (!resp?.credential) throw new Error("Google 未返回凭证");
          const res = await api.auth.google(resp.credential);
          if (res?.token) setToken(res.token);
          onSuccess && onSuccess({ user: res?.user, token: res?.token });
        } catch (e) {
          onError && onError(e);
        }
      },
    });
    el.innerHTML = "";
    window.google.accounts.id.renderButton(el, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "pill",
      logo_alignment: "center",
      width: 400,
    });
    return true;
  } catch (e) {
    onError && onError(e);
    return false;
  }
}
