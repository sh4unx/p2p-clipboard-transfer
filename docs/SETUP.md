# Setup Guide

## 1. Create a Firebase project

1. Go to the [Firebase Console](https://console.firebase.google.com/) and
   create a new project.
2. In **Build → Authentication**, enable the **Anonymous** sign-in provider.
3. In **Build → Realtime Database**, create a database (choose a region close
   to you — this becomes part of your `databaseURL`).

## 2. Apply the security rules

In the Realtime Database console, open the **Rules** tab and paste the
contents of [`database.rules.json`](../database.rules.json), then publish.

These rules:
- Require an authenticated (anonymous is fine) user for all reads/writes.
- Cap `imageData` payloads under a room to ~9 MB.
- Cap clipboard `text` items under a link node to ~100 KB.

## 3. Get your config values

In **Project Settings → General → Your apps**, add a Web app if you haven't,
and copy:
- `apiKey`
- `databaseURL`
- `projectId`

## 4. Configure the extension

Open `extension/background.js` and replace the placeholder values:

```js
const FIREBASE_CONFIG = {
  apiKey:      'YOUR_API_KEY',
  databaseURL: 'YOUR_DATABASE_URL',
  projectId:   'YOUR_PROJECT_ID',
};
```

## 5. Configure the mobile app

```bash
cp mobile/firebase-config.example.js mobile/firebase-config.js
```

Edit `mobile/firebase-config.js` with the same three values.

## 6. Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder.
4. Pin the extension and open its popup — you should see a room code/QR.

## 7. Deploy or host the mobile app

Option A — Firebase Hosting:

```bash
cp .firebaserc.example .firebaserc
# edit .firebaserc with your project id
firebase deploy
```

Option B — any static host (Netlify, GitHub Pages, etc.) as long as it serves
over HTTPS (required for clipboard APIs and service workers).

## 8. Pair your devices

1. Open the extension popup on your PC — note the room code or scan-ready QR.
2. Open the mobile app URL on your phone.
3. Enter the room code (or scan the QR) to join the same room.
4. Send an image from your phone — it should appear as a download on your PC
   within a second or two. Clipboard text syncs both ways automatically.

## Troubleshooting

- **Nothing syncs**: double check `database.rules.json` was published, and
  that both `firebase-config.js` and `background.js` point at the same
  Firebase project.
- **Clipboard sync fails on PC**: make sure the extension has been granted
  clipboard permissions (Chrome may prompt on first use).
- **QR code doesn't scan**: use the copy-link fallback shown in the popup.
