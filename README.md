# Sonora

Sonora is a dark, responsive listening-room app. A host creates a room and controls the shared queue; listeners join with a six-character code. Room state travels over Socket.IO. Audio preferences are per browser profile, never shared with the room.

## Run locally

Requirements: Node.js 20+ and npm. MongoDB is optional for a quick local demo; when omitted, the server explicitly reports that its in-memory room and preference storage is temporary.

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env`.
3. Optional: set `MONGODB_URI` to a MongoDB connection string to persist rooms and device preferences. For Atlas, replace `<db_password>` in `.env.example` with the database user's password; URL-encode any reserved characters in the password.
4. Optional: set `YOUTUBE_API_KEY` (YouTube Data API v3) to enable in-app video search. Pasting a YouTube video URL/ID works without a search key.
5. Start both apps: `npm run dev`
6. Open `http://localhost:5173`. The Express API and Socket.IO server run on port 3001.

### Open on a phone on the same Wi-Fi

The Vite development server listens on the network as well as localhost. On Windows, find the computer's Wi-Fi IPv4 address with `ipconfig` (look under the active Wi-Fi adapter for **IPv4 Address**). Add that phone-facing origin to `CLIENT_ORIGIN` in `.env`, keeping localhost and separating origins with commas. For example:

```env
CLIENT_ORIGIN=http://localhost:5173,http://192.168.1.25:5173
```

Replace `192.168.1.25` with the computer's current Wi-Fi IPv4 address. Run `npm run dev`, allow Node.js through Windows Firewall on your private network if prompted, connect the phone to the same Wi-Fi, and open `http://192.168.1.25:5173` in the phone browser. If the computer's IP or network changes, update `.env` and restart the app. Do not expose the development server to the public internet.

For production, build the client with `npm run build`, then configure a static host for `dist/` and proxy `/api` and `/socket.io` to the Express server. Set `CLIENT_ORIGIN`, `MONGODB_URI`, and `YOUTUBE_API_KEY` for the deployment. The Express service serves uploaded audio from its local `uploads/` directory; production deployments that use multiple server instances should put these files in shared object storage. Do not expose the API key in client code.

## Playback and processing limits

- **YouTube:** Videos use the official YouTube IFrame Player API. This application does not extract or download YouTube audio. An iframe does not expose its audio stream to the Web Audio API, so the EQ, filters, bass and subwoofer controls cannot change YouTube playback. Video playback is aligned by comparing positions only while the player is actually playing; automatic correction waits through buffering and only seeks when drift exceeds three seconds. Host seeks are sent as explicit seek events. It does not change YouTube playback speed.
- **Shared audio uploads:** The host may upload an audio file (40 MB maximum). The server shares that file with room members and serves it as a normal same-origin audio resource. Each listener's browser can route this source through its own Web Audio EQ, filters, bass enhancement, compressor, volume and bass-layer effects. Browser autoplay rules may require each listener to press Play once. Select an audio upload in the room to activate the Web Audio graph; YouTube embeds cannot be processed.
- **Subwoofer:** A browser cannot reliably address a distinct physical subwoofer channel. Subwoofer mode adds a crossover-filtered low-frequency layer to the selected local output; it is not discrete hardware routing.
- **Latency:** Playback messages use the server's wall-clock timestamp. Each client estimates server clock offset from Socket.IO ping round trips every five seconds. Audio uploads receive periodic drift checks, small rate corrections and larger position corrections. Positive per-device offsets advance that listener's media timeline; negative offsets add delay. For YouTube, this is approximate because iframe seeking, network buffering, display latency and autoplay behavior vary by device. A browser cannot directly measure Bluetooth output latency, and the calibration tone is a manual aid, not an automatic measurement.
- **Security and persistence:** Room codes are invitation identifiers, not user accounts. Host controls additionally require a random host token stored in that host browser. In-memory mode is for local evaluation, not production. Use HTTPS, persistent MongoDB, and shared upload storage in a real deployment.

## Included features

- Host-created rooms, host-only playback controls, shareable invitations, presence, disconnect/reconnect, shared queue, YouTube URL entry/search and shared audio upload.
- Socket.IO playback/state updates, periodic client-side drift correction and device-specific signed latency adjustment.
- Six audio settings tabs: 16-band equalizer and presets, bass enhancement, high/low-pass filters, bass-layer controls and test tone, latency calibration, volume/output-device selection.
- Audio preferences saved by browser profile to MongoDB when configured.
