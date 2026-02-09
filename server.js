require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { Server } = require('socket.io');
const { supabase } = require('./supabaseClient');
const { setupSocketHandlers } = require('./socketHandlers');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_MS,
  },
});

app.use(sessionMiddleware);

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, (err) => {
    if (err) return next(err);
    const session = socket.request.session;
    if (!session || !session.userId) {
      return next(new Error('Unauthorized'));
    }
    socket.userId = session.userId;
    next();
  });
});

// Setup Socket.IO handlers
setupSocketHandlers(io);

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return next();
}

async function getCurrentUser(req) {
  if (!req.session || !req.session.userId) return null;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.session.userId)
    .single();
  if (error) return null;
  return data;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Auth routes
app.post('/api/auth/login', async (req, res) => {
  const { username } = req.body || {};
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
  }
  const cleaned = username.trim().slice(0, 40);
  if (!cleaned) {
    return res.status(400).json({ error: 'Username is required' });
  }
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('username', cleaned)
    .maybeSingle();

  let user = existing;
  if (!user) {
    const { data: created, error } = await supabase
      .from('users')
      .insert({ username: cleaned })
      .select('*')
      .single();
    if (error) {
      return res.status(500).json({ error: 'Failed to create user' });
    }
    user = created;
  }

  req.session.userId = user.id;
  return res.json({ id: user.id, username: user.username });
});

app.get('/api/auth/me', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.json({ id: user.id, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

async function createRoomForUser(userId, name, durationMinutes) {
  const baseDuration = Number.isFinite(durationMinutes)
    ? Math.max(5, Math.min(durationMinutes, 8 * 60))
    : 30;
  const expiresAt = new Date(Date.now() + baseDuration * 60 * 1000).toISOString();

  let code = generateRoomCode();
  // Try a few times to avoid collisions
  for (let i = 0; i < 5; i += 1) {
    const { data: existing } = await supabase
      .from('rooms')
      .select('id')
      .eq('code', code)
      .maybeSingle();
    if (!existing) break;
    code = generateRoomCode();
  }

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .insert({
      name: name || 'Classroom Room',
      code,
      creator_id: userId,
      settings: {
        locked: false,
        privateChatEnabled: true,
        durationMinutes: baseDuration,
      },
      expires_at: expiresAt,
    })
    .select('*')
    .single();

  if (roomError) throw roomError;

  const { error: membershipError } = await supabase.from('room_memberships').insert({
    room_id: room.id,
    user_id: userId,
    role: 'admin',
    muted: false,
  });
  if (membershipError) throw membershipError;

  return room;
}

// Rooms API
app.get('/api/rooms', requireAuth, async (req, res) => {
  const userId = req.session.userId;

  const { data: memberships, error: membershipError } = await supabase
    .from('room_memberships')
    .select('room_id, role')
    .eq('user_id', userId);
  if (membershipError) {
    return res.status(500).json({ error: 'Failed to load memberships' });
  }
  const roomIds = (memberships || []).map((m) => m.room_id);
  if (!roomIds.length) return res.json([]);

  const { data: rooms, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .in('id', roomIds)
    .is('deleted_at', null);
  if (roomError) {
    return res.status(500).json({ error: 'Failed to load rooms' });
  }

  const { data: lastMessages, error: lastError } = await supabase
    .from('messages')
    .select('id, room_id, text, created_at')
    .in('room_id', roomIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (lastError) {
    return res.status(500).json({ error: 'Failed to load messages' });
  }
  const lastByRoom = {};
  (lastMessages || []).forEach((m) => {
    if (!lastByRoom[m.room_id]) {
      lastByRoom[m.room_id] = m;
    }
  });

  const payload = rooms.map((room) => {
    const membership = memberships.find((m) => m.room_id === room.id);
    const last = lastByRoom[room.id];
    return {
      id: room.id,
      name: room.name,
      code: room.code,
      expiresAt: room.expires_at,
      role: membership?.role || 'member',
      locked: room.settings?.locked || false,
      privateChatEnabled: room.settings?.privateChatEnabled ?? true,
      lastMessage: last
        ? { id: last.id, text: last.text, createdAt: last.created_at }
        : null,
    };
  });

  return res.json(payload);
});

app.post('/api/rooms', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { name, durationMinutes } = req.body || {};
  try {
    const room = await createRoomForUser(userId, name, durationMinutes);
    return res.status(201).json({
      id: room.id,
      name: room.name,
      code: room.code,
      expiresAt: room.expires_at,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create room' });
  }
});

app.get('/api/rooms/:roomId', requireAuth, async (req, res) => {
  const { roomId } = req.params;
  const userId = req.session.userId;
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .is('deleted_at', null)
    .single();
  if (roomError || !room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const { data: membership, error: membershipError } = await supabase
    .from('room_memberships')
    .select('*')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError || !membership) {
    return res.status(403).json({ error: 'Not a member of this room' });
  }

  const { data: members, error: membersError } = await supabase
    .from('room_memberships')
    .select('user_id, role, muted, users(username)')
    .eq('room_id', roomId);
  if (membersError) {
    return res.status(500).json({ error: 'Failed to load members' });
  }

  return res.json({
    id: room.id,
    name: room.name,
    code: room.code,
    expiresAt: room.expires_at,
    settings: room.settings,
    members: (members || []).map((m) => ({
      id: m.user_id,
      username: m.users?.username || 'User',
      role: m.role,
      muted: m.muted,
    })),
  });
});

app.post('/api/rooms/:roomId/join', requireAuth, async (req, res) => {
  const { roomId } = req.params;
  const userId = req.session.userId;
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .is('deleted_at', null)
    .single();
  if (roomError || !room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  if (room.settings?.locked) {
    return res.status(403).json({ error: 'Room is locked' });
  }

  const { data: existing, error: membershipError } = await supabase
    .from('room_memberships')
    .select('*')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) {
    return res.status(500).json({ error: 'Failed to join room' });
  }

  let membership = existing;
  if (!membership) {
    const { data: created, error: createError } = await supabase
      .from('room_memberships')
      .insert({
        room_id: roomId,
        user_id: userId,
        role: 'member',
        muted: false,
      })
      .select('*')
      .single();
    if (createError) {
      return res.status(500).json({ error: 'Failed to join room' });
    }
    membership = created;
  }

  return res.json({
    id: room.id,
    name: room.name,
    code: room.code,
    role: membership.role,
  });
});

app.post('/api/rooms/:roomId/extend', requireAuth, async (req, res) => {
  const { roomId } = req.params;
  const { durationMinutes } = req.body || {};
  const userId = req.session.userId;
  const { data: membership, error: membershipError } = await supabase
    .from('room_memberships')
    .select('*')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError || !membership || membership.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can extend room time' });
  }

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .is('deleted_at', null)
    .single();
  if (roomError || !room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const additional = Number.isFinite(durationMinutes)
    ? Math.max(5, Math.min(durationMinutes, 8 * 60))
    : 15;
  const currentExpiry = room.expires_at ? new Date(room.expires_at) : new Date();
  const base =
    currentExpiry > new Date()
      ? currentExpiry
      : new Date();
  const newExpiresAt = new Date(base.getTime() + additional * 60 * 1000).toISOString();

  const updatedSettings = {
    ...(room.settings || {}),
    durationMinutes: (room.settings?.durationMinutes || 0) + additional,
  };

  const { data: updated, error: updateError } = await supabase
    .from('rooms')
    .update({
      expires_at: newExpiresAt,
      settings: updatedSettings,
    })
    .eq('id', roomId)
    .select('*')
    .single();
  if (updateError) {
    return res.status(500).json({ error: 'Failed to extend room' });
  }

  io.to(roomId).emit('room_updated', {
    roomId: updated.id,
    expiresAt: updated.expires_at,
  });
  return res.json({ id: updated.id, expiresAt: updated.expires_at });
});

// Basic messages list for initial load (public only for now)
app.get('/api/rooms/:roomId/messages', requireAuth, async (req, res) => {
  const { roomId } = req.params;
  const userId = req.session.userId;
  const { data: membership, error: membershipError } = await supabase
    .from('room_memberships')
    .select('id')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError || !membership) {
    return res.status(403).json({ error: 'Not a member of this room' });
  }

  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('id, room_id, sender_id, text, anonymous, created_at, seen_by')
    .eq('room_id', roomId)
    .is('receiver_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(50);
  if (msgError) {
    return res.status(500).json({ error: 'Failed to load messages' });
  }

  const senderIds = [...new Set((messages || []).map((m) => m.sender_id))];
  const { data: senders } = senderIds.length
    ? await supabase.from('users').select('id, username').in('id', senderIds)
    : { data: [] };
  const userMap = new Map((senders || []).map((u) => [u.id, u]));

  return res.json(
    (messages || []).map((m) => ({
      id: m.id,
      roomId: m.room_id,
      senderId: m.sender_id,
      senderName: m.anonymous ? 'Anonymous' : (userMap.get(m.sender_id)?.username || 'User'),
      text: m.text,
      anonymous: m.anonymous,
      createdAt: m.created_at,
      seenBy: m.seen_by || [],
    })),
  );
});

// Private messages between current user and otherUserId in room
app.get('/api/rooms/:roomId/private/:otherUserId', requireAuth, async (req, res) => {
  const { roomId, otherUserId } = req.params;
  const userId = req.session.userId;
  const { data: membership } = await supabase
    .from('room_memberships')
    .select('id')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) {
    return res.status(403).json({ error: 'Not a member of this room' });
  }

  const { data: sent, error: err1 } = await supabase
    .from('messages')
    .select('id, room_id, sender_id, receiver_id, text, anonymous, created_at, seen_by')
    .eq('room_id', roomId)
    .eq('sender_id', userId)
    .eq('receiver_id', otherUserId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  const { data: received, error: err2 } = await supabase
    .from('messages')
    .select('id, room_id, sender_id, receiver_id, text, anonymous, created_at, seen_by')
    .eq('room_id', roomId)
    .eq('sender_id', otherUserId)
    .eq('receiver_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (err1 || err2) {
    return res.status(500).json({ error: 'Failed to load messages' });
  }
  const messages = [...(sent || []), ...(received || [])].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  ).slice(-100);

  const senderIds = [...new Set((messages || []).map((m) => m.sender_id))];
  const { data: senders } = senderIds.length
    ? await supabase.from('users').select('id, username').in('id', senderIds)
    : { data: [] };
  const userMap = new Map((senders || []).map((u) => [u.id, u]));

  return res.json(
    (messages || []).map((m) => ({
      id: m.id,
      roomId: m.room_id,
      senderId: m.sender_id,
      receiverId: m.receiver_id,
      senderName: m.anonymous ? 'Anonymous' : (userMap.get(m.sender_id)?.username || 'User'),
      text: m.text,
      anonymous: m.anonymous,
      createdAt: m.created_at,
      seenBy: m.seen_by || [],
    })),
  );
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve room.html for room routes
app.get('/room/new', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

app.get('/room/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// Fallback route for SPA routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Room expiry cleanup: every 60s, mark expired rooms and delete their data
async function cleanupExpiredRooms() {
  const now = new Date().toISOString();
  const { data: expired } = await supabase
    .from('rooms')
    .select('id')
    .lt('expires_at', now)
    .is('deleted_at', null);
  if (!expired?.length) return;
  for (const room of expired) {
    await supabase.from('messages').delete().eq('room_id', room.id);
    await supabase.from('polls').delete().eq('room_id', room.id);
    await supabase.from('rooms').update({ deleted_at: now }).eq('id', room.id);
    io.to(room.id).emit('room_closed', { reason: 'expired' });
  }
}
setInterval(cleanupExpiredRooms, 60 * 1000);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`);
});

