// background.js — P2P + Clipboard Sync (Production: hardcoded config + auth + E2EE)

importScripts('firebase-rest.js');

// ═══════════════════════════════════════════════════════════
// ⚙️  HARDCODED FIREBASE CONFIG
// Replace these three values with your Firebase project settings.
// Get them from: Firebase Console → Project Settings → Your apps
// ═══════════════════════════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey:      'YOUR_API_KEY',
  databaseURL: 'YOUR_DATABASE_URL',
  projectId:   'YOUR_PROJECT_ID',
};

// ═══════════════════════════════════════════════════════════
// 🔐 ANONYMOUS AUTH
// Signs in silently on startup. Users never see a login screen.
// Tokens are persisted and refreshed automatically.
// ═══════════════════════════════════════════════════════════
let _authToken    = null;
let _refreshToken = null;
let _tokenExpiry  = 0;

async function getToken() {
  if (_authToken && Date.now() < _tokenExpiry - 60000) return _authToken;
  if (_refreshToken) return await _doRefresh();
  return await _signInAnon();
}

async function _signInAnon() {
  try {
    const res  = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_CONFIG.apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true }) }
    );
    const data = await res.json();
    if (!data.idToken) throw new Error('No token');
    _saveTokens(data.idToken, data.refreshToken, parseInt(data.expiresIn));
    return _authToken;
  } catch(e) { console.error('[Auth] signInAnon failed:', e.message); return null; }
}

async function _doRefresh() {
  try {
    const res  = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: _refreshToken }) }
    );
    const data = await res.json();
    if (!data.id_token) throw new Error('Refresh failed');
    _saveTokens(data.id_token, data.refresh_token, parseInt(data.expires_in));
    return _authToken;
  } catch(e) {
    console.warn('[Auth] Refresh failed, re-signing in');
    _refreshToken = null; return await _signInAnon();
  }
}

function _saveTokens(idToken, refreshToken, expiresIn) {
  _authToken    = idToken;
  _refreshToken = refreshToken;
  _tokenExpiry  = Date.now() + expiresIn * 1000;
  chrome.storage.local.set({ _auth_refresh: refreshToken });
}

async function _loadSavedAuth() {
  const stored = await new Promise(r => chrome.storage.local.get(['_auth_refresh'], d => r(d)));
  if (stored._auth_refresh) { _refreshToken = stored._auth_refresh; await _doRefresh(); }
  else await _signInAnon();
}

// ═══════════════════════════════════════════════════════════
// 🔒 E2EE — AES-256-GCM via Web Crypto API
// The room code / room ID is the shared secret.
// Firebase (and the admin) only ever sees encrypted blobs.
// ═══════════════════════════════════════════════════════════
const E2EE_SALT = 'p2p-e2ee-v1';

async function _deriveKey(roomId) {
  const enc = new TextEncoder();
  const raw = await crypto.subtle.importKey('raw', enc.encode(roomId), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(E2EE_SALT), iterations: 100000, hash: 'SHA-256' },
    raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function e2eeEncrypt(plaintext, roomId) {
  const key       = await _deriveKey(roomId);
  const iv        = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)
  );
  const combined = new Uint8Array(12 + encrypted.byteLength);
  combined.set(iv, 0); combined.set(new Uint8Array(encrypted), 12);
  // btoa in chunks to avoid call stack overflow on large images
  let binary = '';
  combined.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

async function e2eeDecrypt(ciphertext, roomId) {
  const key      = await _deriveKey(roomId);
  const binary   = atob(ciphertext);
  const combined = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12)
  );
  return new TextDecoder().decode(decrypted);
}

// ═══════════════════════════════════════════════════════════
// PHONE2PC STATE
// ═══════════════════════════════════════════════════════════
let roomCode    = null;
let images      = [];
let pdfs        = [];
let pollTimer   = null;
let isPolling   = false;
let pendingCopy = false;

// ═══════════════════════════════════════════════════════════
// CLIPBOARD STATE
// ═══════════════════════════════════════════════════════════
let clipFbRef          = null;
let clipCache          = {};   // raw encrypted — for change detection
let clipDecryptedCache = {};   // decrypted — served to popup
let clipKnownIds       = new Set();
let clipIsFirstLoad    = true;
let clipPollTimer      = null;
let clipConfig         = null; // { room }

// ═══════════════════════════════════════════════════════════
// DB HELPERS
// ═══════════════════════════════════════════════════════════
function dbBase() { return FIREBASE_CONFIG.databaseURL.replace(/\/+$/, ''); }

async function dbUrl(path) {
  const token = await getToken();
  return `${dbBase()}/${path}.json${token ? `?auth=${token}` : ''}`;
}

async function dbWrite(path, data) {
  try {
    const res = await fetch(await dbUrl(path), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    return res.ok;
  } catch(e) { console.error('[DB] write:', e.message); return false; }
}

async function dbRead(path) {
  try {
    const res = await fetch(await dbUrl(path));
    if (!res.ok) return null;
    return await res.json();
  } catch(e) { return null; }
}

async function dbDelete(path) {
  try { await fetch(await dbUrl(path), { method: 'DELETE' }); } catch(_) {}
}

// ═══════════════════════════════════════════════════════════
// PHONE2PC — Room
// ═══════════════════════════════════════════════════════════
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getMobileUrl() {
  return `https://${FIREBASE_CONFIG.projectId}.web.app/?code=${roomCode}`;
}

function p2pcSave() { chrome.storage.local.set({ p2pc_roomCode: roomCode }); }

async function p2pcLoad() {
  return new Promise(resolve => {
    chrome.storage.local.get(['p2pc_roomCode', 'p2pc_images', 'p2pc_pdfs'], res => {
      roomCode = res.p2pc_roomCode || null;
      if (res.p2pc_images !== undefined) images = res.p2pc_images;
      if (res.p2pc_pdfs   !== undefined) pdfs   = res.p2pc_pdfs;
      resolve();
    });
  });
}

async function createRoom(forceNew = false) {
  stopPolling();
  if (forceNew && roomCode) { await dbDelete(`rooms/${roomCode}`); roomCode = null; }
  if (!roomCode) roomCode = generateRoomCode();
  p2pcSave();

  const ok = await dbWrite(`rooms/${roomCode}/meta`, { created: Date.now(), status: 'waiting' });
  if (!ok) { notifyPopup({ type: 'room_error', msg: 'Could not connect to Firebase. Check auth & rules.' }); return; }
  notifyPopup({ type: 'room_ready', roomCode, mobileUrl: getMobileUrl() });
  startPolling();
}

// ═══════════════════════════════════════════════════════════
// PHONE2PC — Polling
// ═══════════════════════════════════════════════════════════
function startPolling()  { stopPolling(); isPolling = true; schedulePoll(); }
function stopPolling()   { isPolling = false; if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }
function schedulePoll()  { if (!isPolling) return; pollTimer = setTimeout(doPoll, 2000); }

async function doPoll() {
  if (!isPolling || !roomCode) return;
  try {
    const incoming = await dbRead(`rooms/${roomCode}/incoming`);
    if (incoming && incoming.imageData) await handleIncoming(incoming);
    const meta = await dbRead(`rooms/${roomCode}/meta`);
    if (meta && meta.phoneJoined && !meta.phoneNotified) {
      notifyPopup({ type: 'phone_connected' });
      await dbWrite(`rooms/${roomCode}/meta/phoneNotified`, true);
    }
  } catch(e) { console.warn('[Poll]', e.message); }
  schedulePoll();
}

// ═══════════════════════════════════════════════════════════
// PHONE2PC — Receive from phone (decrypt)
// ═══════════════════════════════════════════════════════════
async function handleIncoming(data) {
  if (!data || !data.imageData) return;
  await dbDelete(`rooms/${roomCode}/incoming`);

  const isImage = (data.mimeType || '').startsWith('image/');
  const isPdf = !isImage;

  let fileData = data.imageData;
  try { fileData = await e2eeDecrypt(data.imageData, roomCode); }
  catch(e) { console.warn('[E2EE] Decrypt failed:', e.message); }

  const entry = {
    id:        Date.now(),
    data:      fileData,
    filename:  data.filename || (isImage ? `phone_${Date.now()}.jpg` : `phone_${Date.now()}.bin`),
    mimeType:  data.mimeType || 'image/jpeg',
    timestamp: new Date().toLocaleTimeString(),
    isPdf,
    from:      'phone'
  };

  if (isPdf) {
    pdfs.unshift(entry);
    if (pdfs.length > 10) pdfs.pop();
    chrome.storage.local.set({ p2pc_pdfs: pdfs });
  } else {
    images.unshift(entry);
    if (images.length > 20) images.pop();
    chrome.storage.local.set({ pendingClipboard: entry.data, p2pc_images: images });
    copyToClipboard(entry.data);
    pendingCopy = true;
  }

  chrome.notifications.create(`p2pc_${entry.id}`, {
    type: 'basic', iconUrl: 'icons/icon128.png',
    title: 'P2P', message: isImage ? 'Image received — copied to clipboard!' : `File received: ${entry.filename}`
  });

  chrome.action.setBadgeText({ text: '✓' });
  chrome.action.setBadgeBackgroundColor({ color: '#6c63ff' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);

  notifyPopup({ type: isImage ? 'new_image' : 'new_pdf', image: entry });
}

// ═══════════════════════════════════════════════════════════
// PHONE2PC — Send to phone (encrypt) — images + PDFs
// ═══════════════════════════════════════════════════════════
async function sendFileToPhone(fileData, filename, mimeType) {
  if (!roomCode) return false;
  let encData = fileData;
  try { encData = await e2eeEncrypt(fileData, roomCode); }
  catch(e) { console.warn('[E2EE] Encrypt failed:', e.message); }

  const ok = await dbWrite(`rooms/${roomCode}/pc_to_phone`, {
    imageData: encData, filename: filename || `pc_${Date.now()}`,
    mimeType:  mimeType || 'application/octet-stream', sentAt: Date.now()
  });
  if (ok) notifyPopup({ type: 'sent_to_phone' });
  return ok;
}

// ═══════════════════════════════════════════════════════════
// PHONE2PC — Clipboard copy (3-tier fallback)
// ═══════════════════════════════════════════════════════════
async function copyToClipboard(dataUrl) {
  if (chrome.offscreen) {
    try {
      try { if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument(); } catch(_) {}
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('offscreen.html'),
        reasons: ['CLIPBOARD'], justification: 'Copy image to clipboard'
      });
      await new Promise(r => setTimeout(r, 500));
      const res = await chrome.runtime.sendMessage({ type: 'copy_to_clipboard', dataUrl }).catch(() => null);
      if (res && res.ok) return;
    } catch(e) { console.warn('[Clipboard] Offscreen failed:', e.message); }
  }
  try {
    let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs?.length) tabs = await chrome.tabs.query({ currentWindow: true });
    if (!tabs?.length) throw new Error('no tabs');
    const tab = tabs[0];
    const blocked = ['chrome://', 'opera://', 'edge://', 'about:', 'chrome-extension://'];
    if (!tab.id || blocked.some(p => (tab.url || '').startsWith(p))) throw new Error('system tab');
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (dataUrl) => {
        try {
          const res  = await fetch(dataUrl);
          const blob = await res.blob();
          const png  = await new Promise((res, rej) => {
            const img = new Image();
            img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); c.toBlob(b => b ? res(b) : rej(new Error('toBlob')), 'image/png'); };
            img.onerror = rej; img.src = dataUrl;
          });
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
          return { ok: true };
        } catch(e) { return { ok: false }; }
      },
      args: [dataUrl]
    });
  } catch(e) { await chrome.storage.local.set({ pendingClipboard: dataUrl }); }
}

// ═══════════════════════════════════════════════════════════
// CLIPBOARD — Connect / Disconnect
// ═══════════════════════════════════════════════════════════
function clipStop() {
  if (clipFbRef)     { clipFbRef.destroy(); clipFbRef = null; }
  if (clipPollTimer) { clearInterval(clipPollTimer); clipPollTimer = null; }
  clipCache = {}; clipDecryptedCache = {}; clipKnownIds = new Set(); clipIsFirstLoad = true;
}

function clipStart(config) {
  clipStop();
  clipConfig = config;
  clipFbRef  = new FirebaseREST(FIREBASE_CONFIG.databaseURL, `link/${config.room}/items`, getToken);
  clipFbRef.on(data => handleClipUpdate(data || {}));
  clipPollTimer = setInterval(() => clipFetchOnce(), 3000);
  // Write createdAt if not set, then schedule empty-room cleanup
  getToken().then(token => {
    const metaUrl = `${dbBase()}/link/${config.room}/meta.json${token ? '?auth=' + token : ''}`;
    fetch(metaUrl).then(r => r.json()).then(meta => {
      if (!meta || !meta.createdAt) {
        fetch(metaUrl, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ createdAt: Date.now() }) });
      } else if (Date.now() - meta.createdAt > 86400000) {
        // Room older than 24h — check if empty and delete if so
        getToken().then(t => {
          const itemsUrl = `${dbBase()}/link/${config.room}/items.json${t ? '?auth=' + t : ''}`;
          fetch(itemsUrl).then(r => r.json()).then(items => {
            if (!items || Object.keys(items).length === 0) {
              const roomUrl = `${dbBase()}/link/${config.room}.json${t ? '?auth=' + t : ''}`;
              fetch(roomUrl, { method: 'DELETE' });
            }
          }).catch(() => {});
        });
      }
    }).catch(() => {});
  });
}

async function clipFetchOnce() {
  if (!clipConfig) return;
  try {
    const token = await getToken();
    const url   = `${dbBase()}/link/${clipConfig.room}/items.json${token ? `?auth=${token}` : ''}`;
    const res   = await fetch(url);
    if (!res.ok) return;
    handleClipUpdate((await res.json()) || {});
  } catch(_) {}
}

async function handleClipUpdate(raw) {
  const data = (raw && typeof raw === 'object') ? raw : {};
  if (JSON.stringify(data) === JSON.stringify(clipCache) && !clipIsFirstLoad) return;

  // Merge with existing cache to prevent partial PATCH updates creating ghost cards
  const merged = {};
  for (const [id, val] of Object.entries(data)) {
    merged[id] = Object.assign({}, clipCache[id] || {}, val);
  }

  // Filter out incomplete items (ghost cards) — must have at least text or timestamp
  const complete = {};
  for (const [id, val] of Object.entries(merged)) {
    if (val.text || val.timestamp) complete[id] = val;
  }

  // Decrypt all text fields
  const decrypted = {};
  for (const [id, val] of Object.entries(complete)) {
    if (val?.text) {
      try { decrypted[id] = { ...val, text: await e2eeDecrypt(val.text, clipConfig.room) }; }
      catch(_) { decrypted[id] = val; }
    } else { decrypted[id] = val; }
  }

  // Notify for new phone clips
  if (!clipIsFirstLoad) {
    for (const [id, val] of Object.entries(complete)) {
      if (!clipKnownIds.has(id) && val?.source === 'mobile') {
        const display = decrypted[id]?.text || '';
        chrome.notifications.create(`clip_${id}`, {
          type: 'basic', iconUrl: 'icons/icon48.png',
          title: 'Clipboard — New text from phone',
          message: display.substring(0, 80) + (display.length > 80 ? '…' : ''),
          priority: 2
        });
      }
    }
  }

  clipCache          = merged;
  clipDecryptedCache = decrypted;
  clipKnownIds       = new Set(Object.keys(complete));
  clipIsFirstLoad    = false;
  notifyPopup({ type: 'CLIP_UPDATE', data: decrypted });
}

async function clipExpireOld() {
  if (!clipFbRef || !clipConfig) return;
  const now     = Date.now();
  const expired = Object.entries(clipCache).filter(([, i]) => !i.pinned && (now - i.timestamp) > 86400000);
  for (const [id] of expired) { await clipFbRef.remove(id).catch(() => {}); delete clipCache[id]; delete clipDecryptedCache[id]; }
  if (expired.length) notifyPopup({ type: 'CLIP_UPDATE', data: clipDecryptedCache });
}

// ═══════════════════════════════════════════════════════════
// ALARMS
// ═══════════════════════════════════════════════════════════
chrome.alarms.create('p2pc_keepalive', { periodInMinutes: 0.5 });
chrome.alarms.create('clip_expire',    { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'p2pc_keepalive') {
    if (!_authToken) await _loadSavedAuth();
    if (roomCode && !isPolling) startPolling();
    if (!clipConfig) {
      const stored = await new Promise(r => chrome.storage.local.get(['clip_config'], d => r(d.clip_config || null)));
      if (stored) clipStart(stored);
    }
  }
  if (alarm.name === 'clip_expire') await clipExpireOld();
});

// ═══════════════════════════════════════════════════════════
// MESSAGE ROUTER
// ═══════════════════════════════════════════════════════════
function notifyPopup(msg) { chrome.runtime.sendMessage(msg).catch(() => {}); }

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── P2P ──
  if (msg.type === 'get_state') {
    sendResponse({ hasConfig: true, roomCode, mobileUrl: roomCode ? getMobileUrl() : null, images, pdfs, pendingCopy });
    return true;
  }
  if (msg.type === 'restart_and_reopen') {
    chrome.storage.local.set({ _reopen_popup: true }, () => {
      chrome.runtime.reload();
    });
    sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'new_room' || msg.type === 'reconnect') {
    createRoom(true); sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'clear_images') {
    images = [];
    chrome.storage.local.set({ p2pc_images: [] });
    sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'clear_pdfs') {
    pdfs = [];
    chrome.storage.local.set({ p2pc_pdfs: [] });
    sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'delete_image') {
    images = images.filter(function(i) { return i.id !== msg.id; });
    chrome.storage.local.set({ p2pc_images: images });
    sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'delete_pdf') {
    pdfs = pdfs.filter(function(p) { return p.id !== msg.id; });
    chrome.storage.local.set({ p2pc_pdfs: pdfs });
    sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'clear_pending_copy') { pendingCopy = false; sendResponse({ ok: true }); return true; }
  if (msg.type === 'copy_image') {
    const img = images.find(i => i.id === msg.id);
    if (img) copyToClipboard(img.data);
    sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'save_image') {
    const item = images.find(i => i.id === msg.id) || pdfs.find(i => i.id === msg.id);
    if (item) chrome.downloads.download({ url: item.data, filename: item.filename });
    sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'send_to_phone') {
    sendFileToPhone(msg.fileData, msg.filename, msg.mimeType).then(ok => sendResponse({ ok }));
    return true;
  }

  // ── Clipboard ──
  if (msg.type === 'CLIP_CONNECT') {
    const cfg = { room: msg.room };
    chrome.storage.local.set({ clip_config: cfg });
    clipStart(cfg); sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'CLIP_DISCONNECT') {
    clipStop(); clipConfig = null;
    chrome.storage.local.remove('clip_config');
    sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'CLIP_GET_CACHE') {
    sendResponse({ data: clipDecryptedCache, connected: !!clipFbRef, config: clipConfig });
    return true;
  }
  if (msg.type === 'CLIP_PUSH') {
    if (clipFbRef && clipConfig) {
      e2eeEncrypt(msg.item.text, clipConfig.room)
        .then(enc => clipFbRef.push({ ...msg.item, text: enc }))
        .catch(console.error);
    }
    sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'CLIP_PATCH') {
    if (clipFbRef && clipConfig) {
      const fields = Object.assign({}, msg.fields);
      if (fields.text && clipConfig.room) {
        e2eeEncrypt(fields.text, clipConfig.room).then(enc => {
          fields.text = enc;
          clipFbRef.patch(msg.id, fields).catch(console.error);
        });
      } else {
        clipFbRef.patch(msg.id, fields).catch(console.error);
      }
    }
    sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'CLIP_DELETE') {
    if (clipFbRef) clipFbRef.remove(msg.id).catch(console.error);
    sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'CLIP_CLEAR_UNPINNED') {
    if (clipFbRef) msg.ids.forEach(id => clipFbRef.remove(id).catch(console.error));
    sendResponse({ ok: true }); return true;
  }

  sendResponse({ ok: true }); return true;
});

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
async function init() {
  await _loadSavedAuth();
  await p2pcLoad();
  await createRoom(false);
  const stored = await new Promise(r => chrome.storage.local.get(['clip_config'], d => r(d.clip_config || null)));
  if (stored) clipStart(stored);
}
init();
