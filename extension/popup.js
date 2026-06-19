// popup.js — P2P + Clipboard Sync (Production)

// ═══════════════════════════════════════════════════════
// PHONE2PC STATE
// ═══════════════════════════════════════════════════════
let p2pcState   = { hasConfig: true, roomCode: null, mobileUrl: null, images: [], pdfs: [] };
let settOpen    = false;
let newImgIds   = new Set();

// ═══════════════════════════════════════════════════════
// CLIPBOARD STATE
// ═══════════════════════════════════════════════════════
let clipItems     = [];
let clipActiveTab = 'all';
let clipConnected = false;
let clipConfig    = null;

// ═══════════════════════════════════════════════════════
// SHARED — Toast
// ═══════════════════════════════════════════════════════
function toast(msg, type, dur) {
  dur = dur || 2200;
  var t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show ' + (type || '');
  setTimeout(function() { t.className = ''; }, dur);
}

// ═══════════════════════════════════════════════════════
// PHONE2PC — Status
// ═══════════════════════════════════════════════════════
function setStatus(hasRoom) {
  var pill = document.getElementById('statusPill');
  var txt  = document.getElementById('statusTxt');
  if (!hasRoom) { pill.className = 'pill'; txt.textContent = 'Connecting…'; }
  else          { pill.className = 'pill live'; txt.textContent = 'Live'; }
}

// ═══════════════════════════════════════════════════════
// PHONE2PC — Settings
// ═══════════════════════════════════════════════════════
function toggleSettings() {
  settOpen = !settOpen;
  document.getElementById('settPanel').classList.toggle('open', settOpen);
  document.getElementById('settBtn').classList.toggle('on', settOpen);
}

function newRoom() {
  if (settOpen) toggleSettings();
  chrome.runtime.sendMessage({ type: 'new_room' });
  p2pcState.roomCode = null; p2pcState.mobileUrl = null;
  renderRoom(); toast('Generating new room…');
}

function clearAllData() {
  if (settOpen) toggleSettings();
  chrome.runtime.sendMessage({ type: 'clear_images' });
  chrome.runtime.sendMessage({ type: 'clear_pdfs' });
  chrome.runtime.sendMessage({ type: 'CLIP_DISCONNECT' });
  chrome.storage.local.remove(['clip_config']);
  p2pcState.images = [];
  p2pcState.pdfs = [];
  newImgIds.clear();
  renderImages();
  renderPdfs();
  clipConfig = null; clipConnected = false; clipItems = [];
  document.getElementById('clipRoom').value = '';
  showClipSetup();
  toast('Data cleared');
}

// ═══════════════════════════════════════════════════════
// PHONE2PC — QR code
// ═══════════════════════════════════════════════════════
function renderQR(url) {
  var wrap = document.getElementById('qrWrap');
  if (!url) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block'; wrap.innerHTML = '';
  var img = document.createElement('img');
  img.width = 112; img.height = 112; img.style.display = 'block';
  img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=112x112&margin=2&data=' + encodeURIComponent(url);
  wrap.appendChild(img);
}

// ═══════════════════════════════════════════════════════
// PHONE2PC — Room display
// ═══════════════════════════════════════════════════════
function renderRoom() {
  var codeEl  = document.getElementById('codeDisplay');
  var hintEl  = document.getElementById('roomHint');
  var linkBtn = document.getElementById('linkBtn');
  if (!p2pcState.roomCode) {
    codeEl.textContent = '——————'; hintEl.textContent = 'Connecting to Firebase…';
    linkBtn.style.display = 'none'; document.getElementById('qrWrap').style.display = 'none';
    return;
  }
  codeEl.textContent = p2pcState.roomCode;
  hintEl.innerHTML = 'Scan QR or share link — works from <strong style="color:var(--text)">anywhere</strong> 🌍';
  linkBtn.style.display = 'inline-flex';
  renderQR(p2pcState.mobileUrl);
}

function copyPhoneLink() {
  if (!p2pcState.mobileUrl) return;
  navigator.clipboard.writeText(p2pcState.mobileUrl)
    .then(function() { toast('Phone link copied!', 'ok'); })
    .catch(function() { toast('Could not copy link'); });
}

// ═══════════════════════════════════════════════════════
// PHONE2PC — PC → Phone send
// ═══════════════════════════════════════════════════════
var selectedFile = null;

function initSendPanel() {
  var dropzone  = document.getElementById('pcDropzone');
  var fileInput = document.getElementById('pcFileInput');
  dropzone.addEventListener('click', function(e) { if (e.target !== fileInput) fileInput.click(); });
  dropzone.addEventListener('dragover', function(e) { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', function() { dropzone.classList.remove('drag'); });
  dropzone.addEventListener('drop', function(e) {
    e.preventDefault(); dropzone.classList.remove('drag');
    var file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFileSelect(file);
  });
  fileInput.addEventListener('change', function(e) { if (e.target.files[0]) handleFileSelect(e.target.files[0]); });
  document.addEventListener('paste', function(e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        var file = items[i].getAsFile();
        if (file) { switchTab('send'); handleFileSelect(file); } break;
      }
    }
  });
}

function handleFileSelect(file) {
  selectedFile = file;
  var isImage = file.type.startsWith('image/');
  if (isImage) {
    var reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('pcPreviewWrap').innerHTML = '<img id="pcPreview" src="" alt="preview" style="width:100%;border-radius:10px;max-height:160px;object-fit:contain;border:1px solid var(--border);display:block;background:var(--card);">';
      document.getElementById('pcPreview').src = e.target.result;
      document.getElementById('pcPreviewWrap').style.display = 'block';
      document.getElementById('pcSendRow').style.display = 'flex';
      document.getElementById('pcDropzone').style.display = 'none';
    };
    reader.readAsDataURL(file);
  } else {
    var sizeKb = (file.size / 1024).toFixed(1);
    var icon = file.type === 'application/pdf' ? '📄' : '📁';
    document.getElementById('pcPreviewWrap').innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--card);border:1px solid var(--border2);border-radius:10px;">' +
        '<span style="font-size:28px;flex-shrink:0;">' + icon + '</span>' +
        '<div style="min-width:0;">' +
          '<div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(file.name) + '</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-top:3px;">' + sizeKb + ' KB</div>' +
        '</div>' +
      '</div>';
    document.getElementById('pcPreviewWrap').style.display = 'block';
    document.getElementById('pcSendRow').style.display = 'flex';
    document.getElementById('pcDropzone').style.display = 'none';
  }
}

function clearPcSend() {
  selectedFile = null;
  document.getElementById('pcPreviewWrap').innerHTML = '<img id="pcPreview" src="" alt="preview">';
  document.getElementById('pcPreviewWrap').style.display = 'none';
  document.getElementById('pcSendRow').style.display = 'none';
  document.getElementById('pcDropzone').style.display = 'flex';
  document.getElementById('pcFileInput').value = '';
}

function sendToPhone() {
  if (!selectedFile) return;
  if (!p2pcState.roomCode) { toast('Not connected — wait for room code', ''); return; }
  var MAX_RAW = 6.5 * 1024 * 1024;
  if (selectedFile.size > MAX_RAW) { toast('File too large — max 6.5MB', ''); return; }
  var btn = document.getElementById('pcSendBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  var reader = new FileReader();
  reader.onload = function(e) {
    var fileData = e.target.result;
    var isImage = selectedFile.type.startsWith('image/');
    if (isImage && fileData.length > 1500000) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var MAX = 1400, w = img.width, h = img.height;
        if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        doSendToPhone(canvas.toDataURL('image/jpeg', 0.82), btn);
      };
      img.src = fileData;
    } else { doSendToPhone(fileData, btn); }
  };
  reader.readAsDataURL(selectedFile);
}

function doSendToPhone(fileData, btn) {
  chrome.runtime.sendMessage({
    type: 'send_to_phone', fileData,
    filename: selectedFile ? selectedFile.name : 'pc_file',
    mimeType:  selectedFile ? selectedFile.type : 'application/octet-stream'
  }, function(res) {
    void chrome.runtime.lastError;
    btn.disabled = false; btn.textContent = 'Send to Phone';
    if (res && res.ok) { toast('Sent to phone!', 'ok'); clearPcSend(); }
    else { toast('Send failed — is phone connected?', ''); }
  });
}

// ═══════════════════════════════════════════════════════
// PHONE2PC — Images grid
// ═══════════════════════════════════════════════════════
function updateReceivedLayout() {
  var hasImages = p2pcState.images && p2pcState.images.length > 0;
  var hasPdfs   = p2pcState.pdfs && p2pcState.pdfs.length > 0;
  var grid      = document.getElementById('imgsGrid');
  var sec       = document.getElementById('pdfsSection');
  var hdr       = document.getElementById('imgsHdr');
  var divider   = document.getElementById('pdfsDivider');
  var pdfHdr    = document.getElementById('pdfsSectionHdr');

  if (hasImages && !hasPdfs) {
    // Images only — full window for images, no PDF section
    grid.style.display = ''; grid.style.height = ''; grid.style.flex = '1'; grid.style.maxHeight = '';
    if (hdr) hdr.style.display = 'flex';
    if (divider) divider.style.display = 'none';
    if (pdfHdr) pdfHdr.style.display = 'none';
    sec.style.display = 'none'; sec.style.flex = ''; sec.style.maxHeight = '';
  } else if (!hasImages && hasPdfs) {
    // PDFs only — hide image section entirely, PDFs fill full area
    grid.style.display = 'none'; grid.style.height = '0'; grid.style.flex = '0'; grid.style.padding = '0';
    if (hdr) hdr.style.display = 'none';
    if (divider) divider.style.display = 'none';
    if (pdfHdr) pdfHdr.style.display = 'block';
    sec.style.display = 'block'; sec.style.flex = '1'; sec.style.maxHeight = 'none'; sec.style.overflow = 'auto';
  } else if (hasImages && hasPdfs) {
    // Both — 1 row for images, remaining space for PDFs
    grid.style.display = ''; grid.style.height = '115px'; grid.style.flex = ''; grid.style.maxHeight = '115px'; grid.style.padding = '';
    if (hdr) hdr.style.display = 'flex';
    if (divider) divider.style.display = 'block';
    if (pdfHdr) pdfHdr.style.display = 'block';
    sec.style.display = 'block'; sec.style.flex = '1'; sec.style.maxHeight = '';
  } else {
    // Nothing — empty state
    grid.style.display = ''; grid.style.height = ''; grid.style.flex = '1'; grid.style.maxHeight = '';
    if (hdr) hdr.style.display = 'flex';
    if (divider) divider.style.display = 'none';
    if (pdfHdr) pdfHdr.style.display = 'none';
    sec.style.display = 'none'; sec.style.flex = ''; sec.style.maxHeight = '';
  }
}

function renderImages() {
  var grid   = document.getElementById('imgsGrid');
  var cnt    = document.getElementById('imgCount');
  var lbl    = document.getElementById('imgsLbl');
  var clrBtn = document.getElementById('clrBtn');
  var hasImgs = p2pcState.images.length > 0;
  clrBtn.style.display = hasImgs ? 'block' : 'none';
  if (lbl) lbl.innerHTML = hasImgs
    ? 'Images (<span id="imgCount">' + p2pcState.images.length + '</span>)'
    : 'Files (<span id="imgCount">0</span>)';
  if (!p2pcState.images.length) {
    grid.innerHTML = '<div class="empty"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>No files yet.<br>Send one from your phone!</div>';
    updateReceivedLayout(); return;
  }
  grid.innerHTML = p2pcState.images.map(function(img) {
    return '<div class="img-card">' +
      '<img src="' + img.data + '" alt="" loading="lazy">' +
      '<button class="img-del-btn" data-del="' + img.id + '" title="Remove">✕</button>' +
      (newImgIds.has(img.id) ? '<span class="new-badge">NEW</span>' : '') +
      '<div class="img-ov">' +
      '<button data-copy="' + img.id + '" title="Copy"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
      '<button data-save="' + img.id + '" title="Save"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>' +
      '</div></div>';
  }).join('');
  updateReceivedLayout();
}

function clearImages() {
  p2pcState.images = []; newImgIds.clear();
  chrome.runtime.sendMessage({ type: 'clear_images' });
  renderImages();
}

function clearPdfs() {
  p2pcState.pdfs = [];
  chrome.runtime.sendMessage({ type: 'clear_pdfs' });
  renderPdfs();
}

// ═══════════════════════════════════════════════════════
// PHONE2PC — PDFs
// ═══════════════════════════════════════════════════════
function formatSize(dataUrl) {
  // estimate bytes from base64 length
  var bytes = Math.round((dataUrl.length * 3) / 4);
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderPdfs() {
  var hdr   = document.getElementById('pdfsSectionHdr');
  var sec   = document.getElementById('pdfsSection');
  var grid  = document.getElementById('pdfsGrid');
  var pdfs  = p2pcState.pdfs || [];
  if (!pdfs.length) {
    if (hdr) hdr.style.display = 'none';
    var div = document.getElementById('pdfsDivider'); if (div) div.style.display = 'none';
    sec.style.display = 'none';
    updateReceivedLayout(); return;
  }
  if (hdr) hdr.style.display = 'block';
  var div = document.getElementById('pdfsDivider'); if (div) div.style.display = 'block';
  sec.style.display = 'block';
  var pdfCount = document.getElementById('pdfCount'); if (pdfCount) pdfCount.textContent = pdfs.length;
  grid.innerHTML = pdfs.map(function(pdf) {
    return '<div class="pdf-card" data-id="' + pdf.id + '">' +
      '<button class="pdf-del-btn" data-pdf-del="' + pdf.id + '" title="Remove">✕</button>' +
      '<div class="pdf-icon" style="' + (pdf.mimeType === 'application/pdf' ? '' : 'background:rgba(59,130,246,0.15);border-color:rgba(59,130,246,0.3);color:var(--accent2);') + '">📄</div>' +
      '<div class="pdf-info">' +
        '<div class="pdf-name">' + pdf.filename + '</div>' +
        '<div class="pdf-meta">' + pdf.timestamp + ' · ' + formatSize(pdf.data) + '</div>' +
      '</div>' +
      '<div class="pdf-btns">' +
        '<button class="pdf-btn preview-btn" data-id="' + pdf.id + '">Preview</button>' +
        '<button class="pdf-btn save" data-id="' + pdf.id + '">Save</button>' +
      '</div>' +
    '</div>';
  }).join('');

  grid.querySelectorAll('.preview-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var pdf = (p2pcState.pdfs || []).find(function(p) { return p.id === parseInt(btn.getAttribute('data-id')); });
      if (pdf) chrome.tabs.create({ url: pdf.data });
    });
  });
  grid.querySelectorAll('.pdf-btn.save').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var pdf = (p2pcState.pdfs || []).find(function(p) { return p.id === parseInt(btn.getAttribute('data-id')); });
      if (pdf) chrome.runtime.sendMessage({ type: 'save_image', id: pdf.id }); toast('Saving…');
    });
  });
  updateReceivedLayout();
}

function copyImageToClipboard(dataUrl) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob(function(pngBlob) {
        if (!pngBlob) { reject(new Error('toBlob failed')); return; }
        navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]).then(resolve).catch(reject);
      }, 'image/png');
    };
    img.onerror = function() { reject(new Error('image load failed')); };
    img.src = dataUrl;
  });
}

// ═══════════════════════════════════════════════════════
// CLIPBOARD — Connect / Disconnect
// (DB URL is hardcoded in background — only Room ID needed)
// ═══════════════════════════════════════════════════════
function clipConnect() {
  var room = document.getElementById('clipRoom').value.trim();
  var err  = document.getElementById('clipErrMsg');
  err.classList.remove('show');
  if (!room) { err.textContent = 'Please enter a Room ID.'; err.classList.add('show'); return; }

  chrome.runtime.sendMessage({ type: 'CLIP_CONNECT', room }, function() {
    void chrome.runtime.lastError;
    clipConfig = { room };
    showClipConnected(room);
    clipFetchLatest();
    toast('Clipboard syncing!', 'ok');
  });
}

function clipDisconnect() {
  chrome.runtime.sendMessage({ type: 'CLIP_DISCONNECT' });
  clipConfig = null; clipConnected = false; clipItems = [];
  showClipSetup(); toast('Clipboard disconnected');
}

function showClipSetup() {
  document.getElementById('clipSetup').style.display = 'flex';
  document.getElementById('clipConnectedBar').classList.remove('show');
  document.getElementById('clipToolbar').classList.remove('show');
  document.getElementById('clipSendArea').classList.remove('show');
  document.getElementById('clipList').innerHTML = '<div class="clip-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>Connect to see your synced clips.</div>';
}

function showClipConnected(room) {
  document.getElementById('clipSetup').style.display = 'none';
  document.getElementById('clipConnectedBar').classList.add('show');
  document.getElementById('clipSendArea').classList.add('show');
  document.getElementById('clipRoomBadge').textContent = room;
}

function setClipStatus(live) {
  // Status dot removed from UI — no-op kept for compatibility
}

// ═══════════════════════════════════════════════════════
// CLIPBOARD — Data
// ═══════════════════════════════════════════════════════
function clipFetchLatest() {
  chrome.runtime.sendMessage({ type: 'CLIP_GET_CACHE' }, function(res) {
    void chrome.runtime.lastError;
    if (res && res.connected) { clipConnected = true; setClipStatus(true); if (res.config) clipConfig = res.config; }
    if (res && res.data && Object.keys(res.data).length > 0) applyClipData(res.data);
  });
}

function applyClipData(raw) {
  var items = Object.entries(raw).map(function(e) { return Object.assign({ id: e[0] }, e[1]); });
  items.sort(function(a, b) { return b.timestamp - a.timestamp; });
  clipItems = items; renderClipItems(); setClipStatus(true);
}

function clipSendText() {
  var ta   = document.getElementById('clipTextarea');
  var text = ta.value.trim();
  if (!text) return;
  chrome.runtime.sendMessage({ type: 'CLIP_PUSH', item: {
    text, source: 'pc', timestamp: Date.now(), expiresAt: Date.now() + 86400000
  }});
  ta.value = ''; ta.style.height = 'auto';
}

function clipTogglePin(id, currentlyPinned) {
  var nowPinned = !currentlyPinned;
  clipItems = clipItems.map(function(i) { return i.id === id ? Object.assign({}, i, { pinned: nowPinned }) : i; });
  renderClipItems();
  var fields = nowPinned ? { pinned: true, expiresAt: null } : { pinned: false, expiresAt: Date.now() + 86400000 };
  chrome.runtime.sendMessage({ type: 'CLIP_PATCH', id, fields });
}

function clipDeleteItem(id) {
  clipItems = clipItems.filter(function(i) { return i.id !== id; });
  renderClipItems();
  chrome.runtime.sendMessage({ type: 'CLIP_DELETE', id });
}

function clipClearUnpinned() {
  var unpinned = clipItems.filter(function(i) { return !i.pinned; });
  if (!unpinned.length) { toast('No unpinned clips to clear', ''); return; }
  var pinned = clipItems.filter(function(i) { return i.pinned; });
  var msg = 'Delete all ' + unpinned.length + ' unpinned clip' + (unpinned.length > 1 ? 's' : '') + '?';
  if (pinned.length) msg += ' (' + pinned.length + ' pinned will stay)';
  if (!confirm(msg)) return;
  clipItems = pinned; renderClipItems();
  chrome.runtime.sendMessage({ type: 'CLIP_CLEAR_UNPINNED', ids: unpinned.map(function(i) { return i.id; }) });
}

// ═══════════════════════════════════════════════════════
// CLIPBOARD — Render (unchanged from v3)
// ═══════════════════════════════════════════════════════
function clipTimeAgo(ts) {
  var d = Date.now() - ts;
  if (d < 60000)    return Math.floor(d / 1000) + 's ago';
  if (d < 3600000)  return Math.floor(d / 60000) + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
  return new Date(ts).toLocaleDateString();
}

function clipExpiryLabel(item) {
  if (item.pinned) return '';
  var exp = item.expiresAt || (item.timestamp + 86400000);
  var remaining = exp - Date.now();
  if (remaining <= 0) return '<span class="clip-expire-lbl">expired</span>';
  var h = Math.floor(remaining / 3600000), m = Math.floor((remaining % 3600000) / 60000);
  if (h < 1)  return '<span class="clip-expire-lbl">expires in ' + m + 'm</span>';
  if (h < 6)  return '<span class="clip-expire-lbl">expires in ' + h + 'h ' + m + 'm</span>';
  if (h < 24) return '<span class="clip-expire-lbl">expires in ' + h + 'h</span>';
  return '';
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderClipItems() {
  var query = (document.getElementById('clipSearch').value || '').toLowerCase().trim();
  var list  = document.getElementById('clipList');
  var items = clipItems.slice();
  if (clipActiveTab === 'mobile') items = items.filter(function(i) { return i.source === 'mobile'; });
  if (clipActiveTab === 'pc')     items = items.filter(function(i) { return i.source === 'pc'; });
  if (query) items = items.filter(function(i) { return (i.text || '').toLowerCase().includes(query); });
  items.sort(function(a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.timestamp - a.timestamp; });

  if (!items.length) {
    list.innerHTML = '<div class="clip-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>' +
      (clipItems.length ? 'No matching clips.' : 'No clips yet. Send text from below or your phone.') + '</div>';
    return;
  }

  var existingIds = new Set(Array.from(list.querySelectorAll('.clip-card')).map(function(c) { return c.dataset.id; }));
  var newIds      = new Set(items.map(function(i) { return i.id; }));
  existingIds.forEach(function(id) { if (!newIds.has(id)) { var el = list.querySelector('[data-id="' + id + '"]'); if (el) el.remove(); } });
  var emptyEl = list.querySelector('.clip-empty'); if (emptyEl) emptyEl.remove();

  items.forEach(function(item, index) {
    var existing = list.querySelector('.clip-card[data-id="' + item.id + '"]');
    var card;
    if (existing) { card = existing; patchClipCard(card, item); }
    else          { card = buildClipCard(item); list.appendChild(card); }
    var children = list.querySelectorAll('.clip-card');
    if (children[index] !== card) list.insertBefore(card, children[index] || null);
  });
}

function patchClipCard(card, item) {
  var wasPinned = card.classList.contains('pinned');
  var isPinned  = !!item.pinned;
  if (wasPinned === isPinned) return;
  card.classList.toggle('pinned', isPinned);
  var btn = card.querySelector('.clip-pin-btn');
  if (btn) {
    btn.classList.toggle('active', isPinned); btn.title = isPinned ? 'Unpin' : 'Pin';
    var svg = btn.querySelector('svg'); if (svg) svg.setAttribute('fill', isPinned ? 'currentColor' : 'none');
    btn.onclick = function(e) { e.stopPropagation(); clipTogglePin(item.id, isPinned); };
  }
  var pinLbl = card.querySelector('.clip-pin-lbl');
  var expLbl = card.querySelector('.clip-expire-lbl');
  if (isPinned) {
    if (!pinLbl) { var s = document.createElement('span'); s.className = 'clip-pin-lbl'; s.innerHTML = '<svg viewBox="0 0 24 24" width="9" height="9" fill="#3b82f6" stroke="none"><path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z"/></svg>'; var meta = card.querySelector('.clip-meta'); if (meta) meta.insertBefore(s, meta.querySelector('.clip-time')); }
    if (expLbl) expLbl.remove();
  } else { if (pinLbl) pinLbl.remove(); }
}

function buildClipCard(item) {
  var isPinned = !!item.pinned;
  var isLong   = (item.text || '').length > 160;
  var srcClass = item.source === 'mobile' ? 'mobile' : 'pc';
  var srcLabel = item.source === 'mobile' ? 'phone' : 'pc';
  var card = document.createElement('div');
  card.className = 'clip-card' + (isPinned ? ' pinned' : '');
  card.dataset.id = item.id;
  card.innerHTML =
    '<div class="clip-meta">' +
      '<span class="clip-src ' + srcClass + '">' + srcLabel + '</span>' +
      (isPinned ? '<span class="clip-pin-lbl"><svg viewBox="0 0 24 24" width="9" height="9" fill="#3b82f6" stroke="none"><path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z"/></svg></span>' : '') +
      clipExpiryLabel(item) +
      '<span class="clip-time">' + clipTimeAgo(item.timestamp) + '</span>' +
      '<button class="clip-pin-btn ' + (isPinned ? 'active' : '') + '" title="' + (isPinned ? 'Unpin' : 'Pin') + '">' +
        '<svg viewBox="0 0 24 24" fill="' + (isPinned ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V17z"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="clip-body' + (isLong ? '' : ' expanded') + '" id="cb-' + item.id + '">' + escHtml(item.text) + '</div>' +
    '<div class="clip-actions">' +
      '<button class="clip-act-btn edit-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit</button>' +
      '<button class="clip-act-btn copy-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy</button>' +
      '<button class="clip-act-btn del"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg> Delete</button>' +
      (isLong ? '<button class="clip-expand-btn">more ↓</button>' : '') +
    '</div>';
  card.querySelector('.clip-pin-btn').onclick = function(e) { e.stopPropagation(); clipTogglePin(item.id, !!item.pinned); };
  card.querySelector('.clip-body').addEventListener('dblclick', function(e) {
    e.stopPropagation();
    var current = clipItems.find(function(i) { return i.id === item.id; });
    if (current) clipTogglePin(current.id, !!current.pinned);
  });
  card.querySelector('.edit-btn').addEventListener('click', function() {
    var body = document.getElementById('cb-' + item.id);
    var actions = card.querySelector('.clip-actions');
    // Replace body with textarea
    var ta = document.createElement('textarea');
    ta.value = item.text;
    ta.style.cssText = 'width:100%;background:var(--s2);border:1px solid var(--accent);border-radius:8px;color:var(--text);font-family:Inter,sans-serif;font-size:12px;padding:6px 10px;outline:none;resize:none;min-height:60px;line-height:1.5;margin:0 10px 6px;box-sizing:border-box;width:calc(100% - 20px);display:block;';
    body.style.display = 'none';
    body.parentNode.insertBefore(ta, body);
    ta.focus();
    // Replace actions with save/cancel
    var origActions = actions.innerHTML;
    actions.innerHTML = '<button class="clip-act-btn save-edit-btn" style="color:var(--green);border-color:var(--green);">✓ Save</button><button class="clip-act-btn cancel-edit-btn">✕ Cancel</button>';
    actions.querySelector('.save-edit-btn').addEventListener('click', function() {
      var newText = ta.value.trim();
      if (!newText) return;
      item.text = newText;
      ta.remove();
      body.innerHTML = escHtml(newText);
      body.style.display = '';
      actions.innerHTML = origActions;
      // Re-attach listeners
      card.querySelector('.edit-btn').addEventListener('click', arguments.callee);
      card.querySelector('.copy-btn').addEventListener('click', function() {
        navigator.clipboard.writeText(item.text).then(function() {
          var btn = card.querySelector('.copy-btn'); btn.classList.add('copied'); btn.innerHTML = '✓ Copied!';
          setTimeout(function() { btn.classList.remove('copied'); btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy'; }, 1500);
        });
      });
      card.querySelector('.clip-act-btn.del').addEventListener('click', function() { clipDeleteItem(item.id); });
      // Save to firebase
      chrome.runtime.sendMessage({ type: 'CLIP_PATCH', id: item.id, fields: { text: newText } });
      toast('Clip updated', 'ok');
    });
    actions.querySelector('.cancel-edit-btn').addEventListener('click', function() {
      ta.remove(); body.style.display = ''; actions.innerHTML = origActions;
      card.querySelector('.copy-btn').addEventListener('click', function() {
        navigator.clipboard.writeText(item.text).then(function() {
          var btn = card.querySelector('.copy-btn'); btn.classList.add('copied'); btn.innerHTML = '✓ Copied!';
          setTimeout(function() { btn.classList.remove('copied'); btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy'; }, 1500);
        });
      });
      card.querySelector('.clip-act-btn.del').addEventListener('click', function() { clipDeleteItem(item.id); });
    });
  });
  card.querySelector('.copy-btn').addEventListener('click', function() {
    navigator.clipboard.writeText(item.text).then(function() {
      var btn = card.querySelector('.copy-btn'); btn.classList.add('copied'); btn.innerHTML = '✓ Copied!';
      setTimeout(function() { btn.classList.remove('copied'); btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy'; }, 1500);
    });
  });
  card.querySelector('.clip-act-btn.del').addEventListener('click', function() { clipDeleteItem(item.id); });
  var expBtn = card.querySelector('.clip-expand-btn');
  if (expBtn) {
    expBtn.addEventListener('click', function() {
      var body = document.getElementById('cb-' + item.id);
      expBtn.textContent = body.classList.toggle('expanded') ? 'less ↑' : 'more ↓';
    });
  }
  return card;
}

// ═══════════════════════════════════════════════════════
// SHARED — Tab switching
// ═══════════════════════════════════════════════════════
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.style.display = 'none'; });
  document.querySelector('.tab-btn[data-tab="' + tab + '"]').classList.add('active');
  document.getElementById('tab-' + tab).style.display = 'flex';
  if (tab === 'clipboard') { clipFetchLatest(); renderClipItems(); }
  else {
    // Close search if open when leaving clipboard tab
    var searchInput = document.getElementById('clipSearch');
    var badge = document.getElementById('clipRoomBadge');
    if (searchInput && searchInput.classList.contains('open')) {
      searchInput.classList.remove('open');
      searchInput.style.display = 'none';
      searchInput.value = '';
      var btn = document.getElementById('clipSearchBtn');
      if (btn) { btn.classList.remove('active'); btn.style.display = ''; }
      if (badge) badge.style.display = '';
    }
  }
}

// ═══════════════════════════════════════════════════════
// EVENT DELEGATION — P2P
// ═══════════════════════════════════════════════════════
document.addEventListener('click', function(e) {
  var t = e.target;
  if (t.id === 'settBtn' || t.closest('#settBtn')) toggleSettings();
  var action = t.getAttribute('data-action') || (t.closest('[data-action]') && t.closest('[data-action]').getAttribute('data-action'));
  if (action === 'newRoom')       newRoom();
  if (action === 'clearAllData')  clearAllData();
  if (action === 'restartExt') {
    if (settOpen) toggleSettings();
    var extId = chrome.runtime.id;
    chrome.runtime.reload();
    setTimeout(function() {
      window.open('chrome-extension://' + extId + '/popup.html', '_blank', 'width=400,height=580');
    }, 600);
  }
  if (action === 'copyPhoneLink') copyPhoneLink();
  if (action === 'clearImages')   clearImages();
  if (action === 'clearPdfs')     clearPdfs();
  if (action === 'clearPcSend')   clearPcSend();
  if (action === 'sendToPhone')   sendToPhone();
  if (action === 'reconnect')     chrome.runtime.sendMessage({ type: 'reconnect' });
  var tab = t.getAttribute('data-tab') || (t.closest('[data-tab]') && t.closest('[data-tab]').getAttribute('data-tab'));
  if (tab && !t.classList.contains('clip-subtab')) switchTab(tab);
  if (t.id === 'qrWrap' || t.closest('#qrWrap')) { if (p2pcState.mobileUrl) chrome.tabs.create({ url: p2pcState.mobileUrl }); }
  var copyId = t.getAttribute('data-copy') || (t.closest('[data-copy]') && t.closest('[data-copy]').getAttribute('data-copy'));
  var saveId = t.getAttribute('data-save') || (t.closest('[data-save]') && t.closest('[data-save]').getAttribute('data-save'));
  var delId  = t.getAttribute('data-del')  || (t.closest('[data-del]')  && t.closest('[data-del]').getAttribute('data-del'));
  var pdfDelId = t.getAttribute('data-pdf-del') || (t.closest('[data-pdf-del]') && t.closest('[data-pdf-del]').getAttribute('data-pdf-del'));
  if (copyId) {
    var imgToCopy = p2pcState.images.find(function(i) { return i.id === parseInt(copyId); });
    if (imgToCopy) copyImageToClipboard(imgToCopy.data).then(function() { toast('Copied!', 'ok'); }).catch(function() { toast('Copy failed'); });
  }
  if (saveId) { chrome.runtime.sendMessage({ type: 'save_image', id: parseInt(saveId) }); toast('Saving…'); }
  if (delId) {
    var id = parseInt(delId);
    p2pcState.images = p2pcState.images.filter(function(i) { return i.id !== id; });
    newImgIds.delete(id);
    chrome.runtime.sendMessage({ type: 'delete_image', id: id });
    renderImages();
  }
  if (pdfDelId) {
    var pid = parseInt(pdfDelId);
    p2pcState.pdfs = (p2pcState.pdfs || []).filter(function(p) { return p.id !== pid; });
    chrome.runtime.sendMessage({ type: 'delete_pdf', id: pid });
    renderPdfs();
  }
});

// ═══════════════════════════════════════════════════════
// EVENT DELEGATION — Clipboard
// ═══════════════════════════════════════════════════════
document.getElementById('clipConnectBtn').addEventListener('click', clipConnect);
document.getElementById('clipDiscBtn').addEventListener('click', clipDisconnect);
document.getElementById('clipClearBtn').addEventListener('click', clipClearUnpinned);
document.getElementById('clipSearch').addEventListener('input', renderClipItems);
document.getElementById('clipSearch').addEventListener('blur', function() {
  if (!this.value) {
    var badge = document.getElementById('clipRoomBadge');
    var btn = document.getElementById('clipSearchBtn');
    this.classList.remove('open');
    this.style.display = 'none';
    if (btn) { btn.classList.remove('active'); btn.style.display = ''; }
    if (badge) badge.style.display = '';
  }
});
document.getElementById('clipSearchBtn').addEventListener('click', function() {
  var searchInput = document.getElementById('clipSearch');
  var badge = document.getElementById('clipRoomBadge');
  var isOpen = searchInput.classList.toggle('open');
  this.classList.toggle('active', isOpen);
  if (isOpen) {
    if (badge) badge.style.display = 'none';
    this.style.display = 'none';
    searchInput.style.display = 'block';
    searchInput.focus();
  } else {
    searchInput.style.display = 'none';
    if (badge) badge.style.display = '';
    this.style.display = '';
    searchInput.value = ''; renderClipItems();
  }
});
document.getElementById('clipSendBtn').addEventListener('click', clipSendText);
document.getElementById('clipTextarea').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); clipSendText(); }
});

// Enter key sends image to phone (only when image is selected and on send tab)
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && selectedFile) {
    var activeTab = document.querySelector('.tab-btn.active');
    if (activeTab && activeTab.getAttribute('data-tab') === 'send') {
      e.preventDefault();
      sendToPhone();
    }
  }
});
document.getElementById('clipTextarea').addEventListener('input', function() {
  this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 72) + 'px';
});

// ═══════════════════════════════════════════════════════
// BACKGROUND MESSAGES
// ═══════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.type === 'room_ready')      { p2pcState.roomCode = msg.roomCode; p2pcState.mobileUrl = msg.mobileUrl; setStatus(true); renderRoom(); }
  if (msg.type === 'new_image')       {
    p2pcState.images.unshift(msg.image);
    if (p2pcState.images.length > 20) p2pcState.images.pop();
    newImgIds.add(msg.image.id);
    setTimeout(function() { newImgIds.delete(msg.image.id); renderImages(); }, 3500);
    renderImages(); switchTab('received');
    copyImageToClipboard(msg.image.data)
      .then(function() { toast('Received & copied!', 'ok'); chrome.runtime.sendMessage({ type: 'clear_pending_copy' }); })
      .catch(function() { toast('Image received!'); });
  }
  if (msg.type === 'new_pdf') {
    if (!p2pcState.pdfs) p2pcState.pdfs = [];
    p2pcState.pdfs.unshift(msg.image);
    if (p2pcState.pdfs.length > 10) p2pcState.pdfs.pop();
    renderPdfs(); switchTab('received');
    toast('File received!', 'ok');
  }
  if (msg.type === 'phone_connected') toast('Phone connected!', 'ok');
  if (msg.type === 'sent_to_phone')   toast('Sent to phone!', 'ok');
  if (msg.type === 'room_error')      { toast(msg.msg, ''); setStatus(false); }
  if (msg.type === 'CLIP_UPDATE')     { if (msg.data) applyClipData(msg.data); }
});

// ═══════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  initSendPanel();
  switchTab('received');

  chrome.runtime.sendMessage({ type: 'get_state' }, function(res) {
    void chrome.runtime.lastError;
    if (res) {
      p2pcState = res;
      if (!p2pcState.pdfs) p2pcState.pdfs = [];
      setStatus(!!res.roomCode);
      renderRoom(); renderImages(); renderPdfs();
    }
  });

  chrome.runtime.sendMessage({ type: 'CLIP_GET_CACHE' }, function(res) {
    void chrome.runtime.lastError;
    if (res && res.config) {
      clipConfig = res.config;
      document.getElementById('clipRoom').value = res.config.room || '';
      showClipConnected(res.config.room);
      if (res.data && Object.keys(res.data).length > 0) applyClipData(res.data);
    }
  });

  chrome.storage.local.get(['pendingClipboard'], function(r) {
    if (!r.pendingClipboard) return;
    var dataUrl = r.pendingClipboard;
    chrome.storage.local.remove('pendingClipboard');
    copyImageToClipboard(dataUrl).then(function() { toast('Last image copied!', 'ok'); }).catch(function() {});
  });
});
