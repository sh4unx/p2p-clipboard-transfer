# P2P — Phone ⇄ PC Image Transfer & Clipboard Sync

A Chrome extension (Manifest V3) + companion mobile web app that lets you send
images from your phone to your PC and keep your clipboard text in sync across
devices, in real time, using Firebase Realtime Database as the relay.

## Features

- 📱➡️💻 Transfer images from your phone to your PC's downloads with one tap
- 📋 Live clipboard text sync between devices
- 🔗 Simple room-code or QR-code pairing — no accounts to create
- 🔒 Anonymous Firebase Auth + per-room access rules (data scoped to your room only)
- ⚡ Mobile companion is a lightweight installable PWA — no app store needed

## How it works

```
┌─────────────┐        ┌──────────────────────┐        ┌──────────────────┐
│  Mobile PWA │ <----> │ Firebase Realtime DB  │ <----> │ Chrome Extension │
│ (mobile/)   │        │ (rooms / link nodes)  │        │ (extension/)     │
└─────────────┘        └──────────────────────┘        └──────────────────┘
```

- The extension and the mobile page both sign in anonymously to the same
  Firebase project and join a shared **room code**.
- Images and clipboard text are written to that room's node in the Realtime
  Database; the other side listens and reacts instantly.
- `database.rules.json` restricts read/write to authenticated users only, and
  caps payload sizes.

## Project structure

```
.
├── extension/              # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js       # service worker: auth, sync logic, Firebase REST calls
│   ├── firebase-rest.js    # minimal Firebase REST/Realtime DB client
│   ├── offscreen.html/js   # offscreen document (clipboard access from a service worker)
│   ├── popup.html/js       # extension popup UI
│   ├── qrcode.min.js       # QR code generation for pairing
│   └── icons/
├── mobile/                  # Companion installable PWA, hosted on Firebase Hosting
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js                # service worker (offline/installable support)
│   ├── firebase-config.example.js   # copy to firebase-config.js and fill in your keys
│   └── icon-192.png / icon-512.png
├── docs/
│   └── SETUP.md             # full Firebase + install walkthrough
├── firebase.json            # Firebase Hosting config (serves mobile/)
├── database.rules.json      # Realtime Database security rules
├── .firebaserc.example       # copy to .firebaserc and fill in your project id
└── LICENSE
```

## Quick start

1. Read [`docs/SETUP.md`](docs/SETUP.md) — create a Firebase project, enable
   Anonymous Auth and Realtime Database, and apply `database.rules.json`.
2. Copy `mobile/firebase-config.example.js` → `mobile/firebase-config.js` and
   fill in your Firebase project's `apiKey`, `databaseURL`, `projectId`.
3. Put the same three values into `extension/background.js`
   (`FIREBASE_CONFIG` near the top of the file).
4. Load `extension/` as an unpacked extension in `chrome://extensions`
   (Developer Mode → "Load unpacked").
5. Deploy `mobile/` to Firebase Hosting (`firebase deploy`) or serve it
   anywhere static files can be hosted — it just needs HTTPS.
6. Open the extension popup, note the room code/QR, open the mobile site on
   your phone, and join the same room.

## Security notes

- No hardcoded credentials are committed to this repo — `firebase-config.js`
  and `.firebaserc` are gitignored; use the `.example` files as templates.
- Firebase web API keys aren't secret in the traditional sense, but you
  should still restrict your key in the Firebase/Google Cloud console
  (HTTP referrer + API restrictions) and rely on `database.rules.json` (not
  the key) to keep your data private.
- Realtime Database rules require `auth != null` for all reads/writes and
  cap payload sizes to prevent abuse.

## Permissions used by the extension

| Permission | Why |
|---|---|
| `clipboardRead` / `clipboardWrite` | Sync clipboard text across devices |
| `downloads` | Save incoming images to disk |
| `notifications` | Notify when a transfer completes |
| `storage` | Persist auth tokens and settings |
| `offscreen` | Access clipboard APIs from a service worker |
| `tabs`, `scripting`, `activeTab` | Popup/UI interactions |
| `alarms` | Token refresh scheduling |

## License

MIT — see [LICENSE](LICENSE).
