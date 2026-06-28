// public/js/api.js
// Thin wrapper around fetch that attaches the login token and
// throws a readable error message on failure.
const API = (() => {
  function token() {
    return localStorage.getItem("klyo_token");
  }

  async function request(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;

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

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    patch: (path, body) => request("PATCH", path, body),
    del: (path) => request("DELETE", path),
    token,
    setToken(t) {
      localStorage.setItem("klyo_token", t);
    },
    clearToken() {
      localStorage.removeItem("klyo_token");
      localStorage.removeItem("klyo_user");
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
