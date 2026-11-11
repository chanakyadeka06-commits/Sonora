import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import mongoose from 'mongoose';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDirectory = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });

const app = express();
const httpServer = http.createServer(app);
const allowedOrigins = new Set(
  (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('This origin is not allowed to connect to Sonora.'));
  }
};
const io = new Server(httpServer, {
  cors: corsOptions
});
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

const memberSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true },
  joinedAt: { type: Date, default: Date.now }
}, { _id: false });

const songSchema = new mongoose.Schema({
  type: { type: String, enum: ['youtube', 'audio'], required: true },
  videoId: String,
  title: { type: String, required: true },
  channel: String,
  thumbnail: String,
  duration: String,
  durationSeconds: Number,
  url: String
}, { _id: false });

const roomSchema = new mongoose.Schema({
  code: { type: String, unique: true, required: true },
  hostUserId: { type: String, required: true },
  hostName: { type: String, required: true },
  hostTokenHash: { type: String, required: true },
  members: { type: [memberSchema], default: [] },
  queue: { type: [songSchema], default: [] },
  currentIndex: { type: Number, default: -1 },
  playback: {
    status: { type: String, enum: ['idle', 'playing', 'paused'], default: 'idle' },
    position: { type: Number, default: 0 },
    updatedAt: { type: Number, default: () => Date.now() }
  }
}, { timestamps: true });

const preferenceSchema = new mongoose.Schema({
  userId: { type: String, unique: true, required: true },
  settings: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

const Room = mongoose.model('Room', roomSchema);
const AudioPreference = mongoose.model('AudioPreference', preferenceSchema);
const memoryRooms = new Map();
const memoryPreferences = new Map();
const activeUsers = new Map();
let databaseMode = 'memory';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const cleanRoom = (room) => {
  if (!room) return null;
  const data = typeof room.toObject === 'function' ? room.toObject() : structuredClone(room);
  delete data.hostTokenHash;
  return data;
};
const findRoom = async (code) => databaseMode === 'mongo'
  ? Room.findOne({ code }).exec()
  : memoryRooms.get(code) || null;
const saveRoom = async (room) => {
  if (databaseMode === 'mongo') return room.save();
  memoryRooms.set(room.code, room);
  return room;
};
const authorizedHost = async (code, token) => {
  if (typeof token !== 'string' || token.length < 32) return null;
  const room = await findRoom(code);
  if (!room) return null;
  const stored = room.hostTokenHash;
  const supplied = Buffer.from(hashToken(token));
  const expected = Buffer.from(stored);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  return room;
};
const roomState = (room) => {
  const safe = cleanRoom(room);
  const connected = activeUsers.get(safe.code) || new Set();
  safe.members = safe.members.map((member) => ({
    ...member,
    online: connected.has(member.userId),
    role: member.userId === safe.hostUserId ? 'Host' : 'Listener'
  }));
  return safe;
};
const broadcastRoom = (room) => io.to(room.code).emit('room:state', roomState(room));
const validCode = (code) => typeof code === 'string' && /^[A-Z0-9]{6}$/.test(code.toUpperCase());
const makeCode = async () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    if (!(await findRoom(code))) return code;
  }
  throw new Error('Could not generate an available room code. Please try again.');
};

app.get('/api/health', (_req, res) => res.json({ ok: true, database: databaseMode }));

app.post('/api/rooms', async (req, res, next) => {
  try {
    const { userId, name } = req.body || {};
    if (!validId(userId) || typeof name !== 'string' || !name.trim() || name.trim().length > 32) {
      return res.status(400).json({ error: 'Enter a display name to create a room.' });
    }
    const code = await makeCode();
    const ownerToken = crypto.randomBytes(32).toString('hex');
    const values = {
      code,
      hostUserId: userId,
      hostName: name.trim(),
      hostTokenHash: hashToken(ownerToken),
      members: [{ userId, name: name.trim(), joinedAt: new Date() }],
      queue: [],
      currentIndex: -1,
      playback: { status: 'idle', position: 0, updatedAt: Date.now() }
    };
    const room = databaseMode === 'mongo' ? await Room.create(values) : values;
    if (databaseMode === 'memory') memoryRooms.set(code, room);
    res.status(201).json({ room: cleanRoom(room), ownerToken });
  } catch (error) {
    next(error);
  }
});

app.post('/api/rooms/:code/join', async (req, res, next) => {
  try {
    const code = String(req.params.code).toUpperCase();
    const { userId, name } = req.body || {};
    if (!validCode(code)) return res.status(400).json({ error: 'Room codes contain six letters or numbers.' });
    if (!validId(userId) || typeof name !== 'string' || !name.trim() || name.trim().length > 32) {
      return res.status(400).json({ error: 'Enter a display name to join.' });
    }
    const room = await findRoom(code);
    if (!room) return res.status(404).json({ error: 'We could not find that room. Check the code and try again.' });
    const existing = room.members.find((member) => member.userId === userId);
    if (existing) existing.name = name.trim();
    else room.members.push({ userId, name: name.trim(), joinedAt: new Date() });
    await saveRoom(room);
    broadcastRoom(room);
    res.json({ room: cleanRoom(room) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/rooms/:code', async (req, res, next) => {
  try {
    const code = String(req.params.code).toUpperCase();
    if (!validCode(code)) return res.status(400).json({ error: 'Invalid room code.' });
    const room = await findRoom(code);
    if (!room) return res.status(404).json({ error: 'This room no longer exists.' });
    res.json({ room: roomState(room) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/preferences/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!validId(userId)) return res.status(400).json({ error: 'Invalid device profile.' });
    const preference = databaseMode === 'mongo'
      ? await AudioPreference.findOne({ userId }).lean().exec()
      : memoryPreferences.get(userId);
    const settings = databaseMode === 'mongo' ? preference?.settings : preference;
    res.json({ settings: settings || null });
  } catch (error) {
    next(error);
  }
});

app.put('/api/preferences/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { settings } = req.body || {};
    if (!validId(userId) || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ error: 'Invalid audio settings.' });
    }
    if (databaseMode === 'mongo') {
      await AudioPreference.findOneAndUpdate(
        { userId }, { $set: { settings } }, { upsert: true, new: true, runValidators: true }
      ).exec();
    } else {
      memoryPreferences.set(userId, settings);
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/youtube/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (!query) return res.status(400).json({ error: 'Enter a song, artist or video to search.' });
  if (!process.env.YOUTUBE_API_KEY) {
    return res.status(503).json({ error: 'YouTube search needs a YouTube Data API key. You can still add a video by pasting its URL.' });
  }
  try {
    const endpoint = new URL('https://www.googleapis.com/youtube/v3/search');
    endpoint.search = new URLSearchParams({
      key: process.env.YOUTUBE_API_KEY,
      part: 'snippet',
      type: 'video',
      maxResults: '8',
      q: query
    });
    const response = await fetch(endpoint);
    const body = await response.json();
    if (!response.ok) {
      const message = body?.error?.message || 'YouTube search is temporarily unavailable.';
      return res.status(response.status === 403 ? 503 : response.status).json({ error: message });
    }
    const ids = (body.items || []).map((item) => item.id?.videoId).filter(Boolean);
    const durations = new Map();
    if (ids.length) {
      const detailUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
      detailUrl.search = new URLSearchParams({
        key: process.env.YOUTUBE_API_KEY,
        part: 'contentDetails',
        id: ids.join(',')
      });
      const detailsResponse = await fetch(detailUrl);
      if (detailsResponse.ok) {
        const details = await detailsResponse.json();
        for (const item of details.items || []) durations.set(item.id, durationInfo(item.contentDetails?.duration));
      }
    }
    res.json({
      results: (body.items || []).map((item) => ({
        type: 'youtube',
        videoId: item.id.videoId,
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
        duration: durations.get(item.id.videoId)?.label || '—',
        durationSeconds: durations.get(item.id.videoId)?.seconds
      }))
    });
  } catch (error) {
    console.error('YouTube search failed:', error);
    res.status(502).json({ error: 'Could not reach YouTube right now. Please try again.' });
  }
});

app.get('/api/youtube/video/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!/^[\w-]{11}$/.test(videoId)) return res.status(400).json({ error: 'Invalid YouTube video ID.' });
  try {
    const endpoint = new URL('https://www.youtube.com/oembed');
    endpoint.search = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${videoId}`, format: 'json' });
    const response = await fetch(endpoint);
    if (!response.ok) return res.status(502).json({ error: 'YouTube could not provide details for that video.' });
    const details = await response.json();
    res.json({
      type: 'youtube',
      videoId,
      title: details.title,
      channel: details.author_name,
      thumbnail: details.thumbnail_url
    });
  } catch (error) {
    console.error('YouTube video details failed:', error);
    res.status(502).json({ error: 'Could not load video details from YouTube.' });
  }
});

function durationInfo(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value || '');
  if (!match) return null;
  const seconds = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const label = hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  return { label, seconds };
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 8);
    callback(null, `${crypto.randomBytes(16).toString('hex')}${extension}`);
  }
});
const audioUpload = multer({
  storage,
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith('audio/')) return callback(new Error('Please choose an audio file.'));
    callback(null, true);
  }
}).single('audio');

app.post('/api/rooms/:code/upload', async (req, res, next) => {
  try {
    const code = String(req.params.code).toUpperCase();
    const token = req.get('Authorization')?.replace(/^Bearer\s+/i, '');
    const room = await authorizedHost(code, token);
    if (!room) return res.status(403).json({ error: 'Only this room’s host can upload shared audio.' });
    req.authorizedRoom = room;
    next();
  } catch (error) {
    next(error);
  }
}, (req, res, next) => {
  audioUpload(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.message || 'The audio file could not be uploaded.' });
    next();
  });
}, async (req, res, next) => {
  try {
    const code = String(req.params.code).toUpperCase();
    const room = req.authorizedRoom;
    if (!req.file) return res.status(400).json({ error: 'Choose an audio file to upload.' });
    const song = {
      type: 'audio',
      title: path.basename(req.file.originalname, path.extname(req.file.originalname)).slice(0, 100) || 'Shared audio',
      channel: 'Shared audio upload',
      url: `/api/media/${req.file.filename}`
    };
    room.queue.push(song);
    room.currentIndex = room.queue.length - 1;
    room.playback = { status: 'paused', position: 0, updatedAt: Date.now() };
    await saveRoom(room);
    broadcastRoom(room);
    res.status(201).json({ room: cleanRoom(room) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/media/:filename', (req, res) => {
  if (!/^[a-f0-9]{32}\.[a-z0-9]{1,8}$/i.test(req.params.filename)) {
    return res.status(404).json({ error: 'Media not found.' });
  }
  const file = path.join(uploadDirectory, req.params.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'This uploaded track is no longer available.' });
  res.sendFile(file);
});

io.on('connection', (socket) => {
  socket.on('sync:ping', (callback) => {
    if (typeof callback === 'function') callback({ serverNow: Date.now() });
  });

  socket.on('room:join', async (payload = {}, callback = () => {}) => {
    try {
      const code = String(payload.code || '').toUpperCase();
      const { userId, ownerToken } = payload;
      if (!validCode(code) || !validId(userId)) return callback({ error: 'Invalid room connection.' });
      const room = await findRoom(code);
      if (!room) return callback({ error: 'This room no longer exists.' });
      const member = room.members.find((item) => item.userId === userId);
      if (!member) return callback({ error: 'Join this room before connecting.' });
      if (userId === room.hostUserId && !(await authorizedHost(code, ownerToken))) {
        return callback({ error: 'The host session could not be verified. Reopen the room from this device.' });
      }
      socket.data.roomCode = code;
      socket.data.userId = userId;
      await socket.join(code);
      if (!activeUsers.has(code)) activeUsers.set(code, new Set());
      activeUsers.get(code).add(userId);
      broadcastRoom(room);
      callback({ room: roomState(room) });
    } catch (error) {
      console.error('Room connection failed:', error);
      callback({ error: 'Could not connect to this room.' });
    }
  });

  socket.on('playback:command', async (payload = {}, callback = () => {}) => {
    try {
      const code = String(payload.code || '').toUpperCase();
      const room = await authorizedHost(code, payload.ownerToken);
      if (!room || socket.data.roomCode !== code || socket.data.userId !== room.hostUserId) {
        return callback({ error: 'Only the verified host can control playback.' });
      }
      const { type } = payload;
      const now = Date.now();
      if (type === 'select') {
        const song = payload.song;
        if (!song || !['youtube', 'audio'].includes(song.type) || typeof song.title !== 'string') {
          return callback({ error: 'This track cannot be added to the room.' });
        }
        if (song.type === 'youtube' && !/^[\w-]{11}$/.test(song.videoId || '')) {
          return callback({ error: 'That YouTube video ID is invalid.' });
        }
        if (song.type === 'audio' && !/^\/api\/media\/[a-f0-9]{32}\.[a-z0-9]{1,8}$/i.test(song.url || '')) {
          return callback({ error: 'That shared audio file is invalid.' });
        }
        room.queue.push(song);
        room.currentIndex = room.queue.length - 1;
        room.playback = { status: 'playing', position: 0, updatedAt: now };
      } else if (type === 'play') {
        room.playback = { status: 'playing', position: Math.max(0, Number(payload.position) || 0), updatedAt: now };
      } else if (type === 'pause' || type === 'seek') {
        room.playback = {
          status: type === 'pause' ? 'paused' : room.playback.status,
          position: Math.max(0, Number(payload.position) || 0),
          updatedAt: now
        };
      } else if (type === 'next') {
        if (room.currentIndex + 1 >= room.queue.length) return callback({ error: 'There are no more tracks in the queue.' });
        room.currentIndex += 1;
        room.playback = { status: 'playing', position: 0, updatedAt: now };
      } else if (type === 'queue') {
        const song = payload.song;
        if (!song || !['youtube', 'audio'].includes(song.type) || typeof song.title !== 'string') {
          return callback({ error: 'This track cannot be added to the queue.' });
        }
        room.queue.push(song);
      } else {
        return callback({ error: 'Unknown playback command.' });
      }
      await saveRoom(room);
      broadcastRoom(room);
      if (type === 'seek') {
        io.to(code).emit('playback:seek', { position: room.playback.position });
      }
      callback({ ok: true });
    } catch (error) {
      console.error('Playback command failed:', error);
      callback({ error: 'Could not update room playback.' });
    }
  });

  socket.on('room:leave', async () => {
    await leaveRoom(socket);
  });
  socket.on('disconnect', async () => {
    await leaveRoom(socket);
  });
});

async function leaveRoom(socket) {
  const { roomCode, userId } = socket.data;
  if (!roomCode || !userId) return;
  const otherSockets = await io.in(roomCode).fetchSockets();
  const stillConnected = otherSockets.some((item) => item.id !== socket.id && item.data.userId === userId);
  if (!stillConnected) {
    const connected = activeUsers.get(roomCode);
    connected?.delete(userId);
    if (connected?.size === 0) activeUsers.delete(roomCode);
  }
  const room = await findRoom(roomCode);
  if (room) broadcastRoom(room);
  socket.data.roomCode = null;
}

app.use((error, _req, res, _next) => {
  console.error('Request failed:', error);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

const port = Number(process.env.PORT) || 3001;
if (process.env.MONGODB_URI) {
  await mongoose.connect(process.env.MONGODB_URI);
  databaseMode = 'mongo';
  console.log('Connected to MongoDB.');
} else {
  console.warn('MONGODB_URI is not set. Using clearly temporary in-memory storage; rooms and preferences will not survive a restart.');
}
httpServer.listen(port, () => console.log(`Sonora server listening on http://localhost:${port}`));
