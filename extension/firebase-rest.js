// firebase-rest.js — SSE + REST Firebase client (Production: auth token support)

class FirebaseREST {
  constructor(dbUrl, path, getToken) {
    this.base          = dbUrl.replace(/\/$/, '') + '/' + path;
    this._getToken     = getToken || (() => Promise.resolve(null));
    this._sse          = null;
    this._onValue      = null;
    this._reconnectTimer = null;
    this._retryDelay   = 2000;
    this._cache        = null;
    this._pendingOverrides = {};
  }

  on(callback) {
    this._onValue = callback;
    this._connect();
  }

  _notify() {
    if (!this._onValue || !this._cache) return;
    const view = {};
    for (const [id, item] of Object.entries(this._cache)) {
      view[id] = this._pendingOverrides[id]
        ? Object.assign({}, item, this._pendingOverrides[id])
        : item;
    }
    this._onValue(view);
  }

  _checkOverrideResolved(id) {
    if (!this._pendingOverrides[id] || !this._cache[id]) return;
    const override = this._pendingOverrides[id];
    const item     = this._cache[id];
    const allMatch = Object.keys(override).every(k =>
      override[k] === (item[k] !== undefined ? item[k] : false)
    );
    if (allMatch) delete this._pendingOverrides[id];
  }

  async _connect() {
    if (this._sse) this._sse.close();
    const token = await this._getToken();
    const url   = this.base + '.json' + (token ? `?auth=${token}` : '');
    const sse   = new EventSource(url);
    this._sse   = sse;

    sse.addEventListener('put', e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.path === '/') {
          this._cache = msg.data || {};
          for (const id of Object.keys(this._pendingOverrides)) this._checkOverrideResolved(id);
        } else {
          if (!this._cache) this._cache = {};
          const parts = msg.path.replace(/^\//, '').split('/');
          if (parts.length === 1) {
            const key = parts[0];
            if (msg.data === null) { delete this._cache[key]; delete this._pendingOverrides[key]; }
            else { this._cache[key] = msg.data; this._checkOverrideResolved(key); }
          } else {
            const [id, field] = parts;
            if (!this._cache[id]) this._cache[id] = {};
            if (msg.data === null) {
              delete this._cache[id][field];
              if (this._pendingOverrides[id]) {
                delete this._pendingOverrides[id][field];
                if (!Object.keys(this._pendingOverrides[id]).length) delete this._pendingOverrides[id];
              }
            } else {
              this._cache[id][field] = msg.data;
              this._checkOverrideResolved(id);
            }
          }
        }
        this._retryDelay = 2000;
        this._notify();
      } catch(err) { console.warn('[FirebaseREST] SSE put error', err); }
    });

    sse.addEventListener('patch', e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.data && typeof msg.data === 'object') {
          if (!this._cache) this._cache = {};
          for (const [key, val] of Object.entries(msg.data)) {
            if (val && typeof val === 'object' && this._cache[key] && typeof this._cache[key] === 'object') {
              this._cache[key] = Object.assign({}, this._cache[key], val);
            } else { this._cache[key] = val; }
            this._checkOverrideResolved(key);
          }
          this._notify();
        }
      } catch(err) { console.warn('[FirebaseREST] SSE patch error', err); }
    });

    sse.onerror = () => {
      sse.close(); this._sse = null;
      // Reconnect with a fresh token (handles token expiry after 1h)
      this._reconnectTimer = setTimeout(() => this._connect(), this._retryDelay);
      this._retryDelay = Math.min(this._retryDelay * 1.5, 30000);
    };
  }

  async _authUrl(suffix = '') {
    const token = await this._getToken();
    return this.base + suffix + '.json' + (token ? `?auth=${token}` : '');
  }

  async push(data) {
    const res = await fetch(await this._authUrl(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Push failed: HTTP ' + res.status);
    return res.json();
  }

  async patch(key, data) {
    if (!this._pendingOverrides[key]) this._pendingOverrides[key] = {};
    Object.assign(this._pendingOverrides[key], data);
    this._notify();
    const res = await fetch(await this._authUrl('/' + key), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    if (!res.ok) {
      if (this._pendingOverrides[key]) {
        for (const k of Object.keys(data)) delete this._pendingOverrides[key][k];
        if (!Object.keys(this._pendingOverrides[key]).length) delete this._pendingOverrides[key];
      }
      throw new Error('Patch failed: HTTP ' + res.status);
    }
    if (this._cache && this._cache[key]) Object.assign(this._cache[key], data);
    this._checkOverrideResolved(key);
    return res.json();
  }

  async remove(key) {
    const res = await fetch(await this._authUrl('/' + key), { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed: HTTP ' + res.status);
    delete this._pendingOverrides[key];
  }

  destroy() {
    if (this._sse) { this._sse.close(); this._sse = null; }
    clearTimeout(this._reconnectTimer);
  }
}
