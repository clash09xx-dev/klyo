// public/js/api.js
// Thin wrapper around fetch that attaches the login token and
// throws a readable error message on failure.
const API = (() => {
  function token() {
    return localStorage.getItem("klyo_token");
  }

  async function request(method, path, body) {
    const headers = authHeaders({ "Content-Type": "application/json" });

    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      /* no body */
    }

    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      if (data.code) err.code = data.code;
      throw err;
    }
    return data;
  }

  function scope() {
    return localStorage.getItem("klyo_scope") === "personal"
      ? "personal"
      : "team";
  }
  function authHeaders(extra = {}) {
    return {
      ...extra,
      ...(token() ? { Authorization: "Bearer " + token() } : {}),
      "X-Klyo-Scope": scope(),
      "X-Klyo-Timezone":
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };
  }
  return {
    headers: authHeaders,
    scope,
    setScope(value) {
      localStorage.setItem(
        "klyo_scope",
        value === "personal" ? "personal" : "team",
      );
    },
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    patch: (path, body) => request("PATCH", path, body),
    del: (path) => request("DELETE", path),
    token,
    setToken(t) {
      localStorage.setItem("klyo_token", t);
      localStorage.setItem("klyo_scope", "team");
    },
    clearToken() {
      localStorage.removeItem("klyo_token");
      localStorage.removeItem("klyo_user");
      localStorage.removeItem("klyo_scope");
    },
    getUser() {
      const raw = localStorage.getItem("klyo_user");
      return raw ? JSON.parse(raw) : null;
    },
    setUser(u) {
      localStorage.setItem("klyo_user", JSON.stringify(u));
    },
  };
})();
