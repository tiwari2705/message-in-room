const { supabase } = require('./supabaseClient');

// In-memory store for active connections
const activeUsers = new Map(); // socketId -> { userId, username, roomId, anonymous }
const roomMembers = new Map(); // roomId -> Set of socketIds
const userIdToSockets = new Map(); // userId -> Set of socketIds

function getSocketsForUser(io, userId) {
  const set = userIdToSockets.get(userId);
  if (!set) return [];
  return [...set].filter((sid) => io.sockets.sockets.get(sid));
}

function buildMembersList(roomId, allMemberships) {
  const members = [];
  const roomSockets = roomMembers.get(roomId) || new Set();
  roomSockets.forEach((sid) => {
    const userData = activeUsers.get(sid);
    if (userData) {
      const membershipData = (allMemberships || []).find(
        (m) => m.user_id === userData.userId
      );
      members.push({
        id: sid,
        userId: userData.userId,
        username: userData.username,
        isAdmin: membershipData?.role === 'admin',
        muted: membershipData?.muted || false,
        anonymous: userData.anonymous,
      });
    }
  });
  return members;
}

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    const userId = socket.userId;
    if (!userId) {
      socket.disconnect(true);
      return;
    }
    if (!userIdToSockets.has(userId)) {
      userIdToSockets.set(userId, new Set());
    }
    userIdToSockets.get(userId).add(socket.id);

    socket.on('create_room', async (_, callback) => {
      try {
        const { data: user, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .single();
        if (userError || !user) {
          return callback({ ok: false, error: 'User not found' });
        }

        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i += 1) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        const baseDuration = 30;
        const expiresAt = new Date(Date.now() + baseDuration * 60 * 1000).toISOString();

        const { data: room, error: roomError } = await supabase
          .from('rooms')
          .insert({
            name: 'Classroom Room',
            code,
            creator_id: user.id,
            settings: {
              locked: false,
              privateChatEnabled: true,
              durationMinutes: baseDuration,
            },
            expires_at: expiresAt,
          })
          .select('*')
          .single();

        if (roomError) {
          return callback({ ok: false, error: 'Failed to create room' });
        }

        const { error: membershipError } = await supabase
          .from('room_memberships')
          .insert({
            room_id: room.id,
            user_id: user.id,
            role: 'admin',
            muted: false,
          });

        if (membershipError) {
          return callback({ ok: false, error: 'Failed to join room' });
        }

        socket.join(room.id);
        activeUsers.set(socket.id, {
          userId: user.id,
          username: user.username,
          roomId: room.id,
          anonymous: false,
        });

        if (!roomMembers.has(room.id)) {
          roomMembers.set(room.id, new Set());
        }
        roomMembers.get(room.id).add(socket.id);

        const { data: allMemberships } = await supabase
          .from('room_memberships')
          .select('user_id, role, muted')
          .eq('room_id', room.id);

        const members = buildMembersList(room.id, allMemberships);

        callback({
          ok: true,
          userId: user.id,
          username: user.username,
          roomCode: room.code,
          roomId: room.id,
          expiresAt: new Date(room.expires_at).getTime(),
          settings: room.settings,
          isAdmin: true,
          members,
          publicMessages: [],
          polls: [],
        });

        io.to(room.id).emit('members_update', members);
      } catch (error) {
        console.error('Error creating room:', error);
        callback({ ok: false, error: 'Server error' });
      }
    });

    socket.on('join_room', async ({ roomCode }, callback) => {
      try {
        if (!roomCode) {
          return callback({ ok: false, error: 'Room code required' });
        }

        const { data: user, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .single();
        if (userError || !user) {
          return callback({ ok: false, error: 'User not found' });
        }

        const { data: room, error: roomError } = await supabase
          .from('rooms')
          .select('*')
          .eq('code', String(roomCode).toUpperCase())
          .is('deleted_at', null)
          .single();

        if (roomError || !room) {
          return callback({ ok: false, error: 'Room not found' });
        }

        if (room.settings?.locked) {
          return callback({ ok: false, error: 'Room is locked' });
        }

        const { data: membership, error: membershipError } = await supabase
          .from('room_memberships')
          .select('*')
          .eq('room_id', room.id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!membership) {
          const { error: insertErr } = await supabase
            .from('room_memberships')
            .insert({
              room_id: room.id,
              user_id: user.id,
              role: 'member',
              muted: false,
            });
          if (insertErr) {
            return callback({ ok: false, error: 'Failed to join room' });
          }
        }

        socket.join(room.id);
        activeUsers.set(socket.id, {
          userId: user.id,
          username: user.username,
          roomId: room.id,
          anonymous: false,
        });

        if (!roomMembers.has(room.id)) {
          roomMembers.set(room.id, new Set());
        }
        roomMembers.get(room.id).add(socket.id);

        const { data: allMemberships } = await supabase
          .from('room_memberships')
          .select('user_id, role, muted')
          .eq('room_id', room.id);

        const { data: messages } = await supabase
          .from('messages')
          .select('id, room_id, sender_id, text, anonymous, created_at, seen_by, reactions')
          .eq('room_id', room.id)
          .is('receiver_id', null)
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
          .limit(50);

        const publicMessages = (messages || []).map((m) => ({
          id: m.id,
          roomId: m.room_id,
          senderId: m.sender_id,
          senderName: m.anonymous ? 'Anonymous' : null,
          text: m.text,
          anonymous: m.anonymous,
          createdAt: m.created_at,
          seenBy: m.seen_by || [],
          reactions: m.reactions || {},
        }));

        const { data: usersInRoom } = await supabase
          .from('users')
          .select('id, username')
          .in('id', (allMemberships || []).map((m) => m.user_id));
        const userMap = new Map((usersInRoom || []).map((u) => [u.id, u]));
        publicMessages.forEach((m) => {
          if (!m.senderName && m.senderId) m.senderName = userMap.get(m.senderId)?.username || 'User';
        });

        const members = buildMembersList(room.id, allMemberships);

        const { data: polls } = await supabase
          .from('polls')
          .select('*')
          .eq('room_id', room.id);

        callback({
          ok: true,
          userId: user.id,
          username: user.username,
          roomCode: room.code,
          roomId: room.id,
          expiresAt: new Date(room.expires_at).getTime(),
          settings: room.settings,
          isAdmin: (membership || {}).role === 'admin',
          members,
          publicMessages,
          polls: (polls || []).map((p) => ({
            id: p.id,
            question: p.question,
            options: p.options || [],
            votes: p.votes || {},
          })),
        });

        io.to(room.id).emit('members_update', members);
      } catch (error) {
        console.error('Error joining room:', error);
        callback({ ok: false, error: 'Server error' });
      }
    });

    socket.on('send_public_message', async ({ text }, callback) => {
      try {
        const userData = activeUsers.get(socket.id);
        if (!userData) {
          return callback({ ok: false, error: 'Not in a room' });
        }

        const { data: membership } = await supabase
          .from('room_memberships')
          .select('muted')
          .eq('room_id', userData.roomId)
          .eq('user_id', userData.userId)
          .single();
        if (membership?.muted) {
          return callback({ ok: false, error: 'You are muted' });
        }

        const content = (text && String(text).trim()).slice(0, 2000);
        if (!content) return callback({ ok: false, error: 'Empty message' });

        const { roomId, userId, username, anonymous } = userData;

        const { data: message, error } = await supabase
          .from('messages')
          .insert({
            room_id: roomId,
            sender_id: userId,
            text: content,
            anonymous: !!anonymous,
            seen_by: [userId],
          })
          .select('*')
          .single();

        if (error) {
          return callback({ ok: false, error: 'Failed to send message' });
        }

        const msg = {
          id: message.id,
          roomId: message.room_id,
          senderId: message.sender_id,
          senderName: anonymous ? 'Anonymous' : username,
          text: message.text,
          anonymous: message.anonymous,
          createdAt: message.created_at,
          seenBy: message.seen_by || [],
          reactions: message.reactions || {},
        };

        io.to(roomId).emit('public_message', msg);
        callback({ ok: true });
      } catch (error) {
        console.error('Error sending message:', error);
        callback({ ok: false, error: 'Server error' });
      }
    });

    socket.on('send_private_message', async ({ toId, receiverUserId, text }, callback) => {
      try {
        const userData = activeUsers.get(socket.id);
        if (!userData) {
          return callback({ ok: false, error: 'Not in a room' });
        }

        const { data: room } = await supabase
          .from('rooms')
          .select('settings')
          .eq('id', userData.roomId)
          .single();
        if (room?.settings?.privateChatEnabled === false) {
          return callback({ ok: false, error: 'Private chat is disabled' });
        }

        const { data: myMembership } = await supabase
          .from('room_memberships')
          .select('muted')
          .eq('room_id', userData.roomId)
          .eq('user_id', userData.userId)
          .single();
        if (myMembership?.muted) {
          return callback({ ok: false, error: 'You are muted' });
        }

        let targetUserId = receiverUserId;
        if (!targetUserId && toId) {
          const targetData = activeUsers.get(toId);
          if (targetData) targetUserId = targetData.userId;
        }
        if (!targetUserId) {
          return callback({ ok: false, error: 'Invalid recipient' });
        }

        const { data: targetMembership } = await supabase
          .from('room_memberships')
          .select('id')
          .eq('room_id', userData.roomId)
          .eq('user_id', targetUserId)
          .maybeSingle();
        if (!targetMembership) {
          return callback({ ok: false, error: 'User is not in this room' });
        }

        const content = (text && String(text).trim()).slice(0, 2000);
        if (!content) return callback({ ok: false, error: 'Empty message' });

        const { data: message, error } = await supabase
          .from('messages')
          .insert({
            room_id: userData.roomId,
            sender_id: userData.userId,
            receiver_id: targetUserId,
            text: content,
            anonymous: !!userData.anonymous,
            seen_by: [userData.userId],
          })
          .select('*')
          .single();

        if (error) {
          return callback({ ok: false, error: 'Failed to send message' });
        }

        const msg = {
          id: message.id,
          roomId: message.room_id,
          senderId: message.sender_id,
          receiverId: message.receiver_id,
          senderName: userData.anonymous ? 'Anonymous' : userData.username,
          text: message.text,
          anonymous: message.anonymous,
          createdAt: message.created_at,
          seenBy: message.seen_by || [],
          reactions: message.reactions || {},
        };

        socket.emit('private_message', msg);
        const targetSockets = getSocketsForUser(io, targetUserId);
        targetSockets.forEach((sid) => {
          if (sid !== socket.id) io.to(sid).emit('private_message', msg);
        });
        callback({ ok: true });
      } catch (error) {
        console.error('Error sending private message:', error);
        callback({ ok: false, error: 'Server error' });
      }
    });

    socket.on('toggle_anonymous', ({ anonymous }) => {
      const userData = activeUsers.get(socket.id);
      if (userData) {
        userData.anonymous = !!anonymous;
      }
    });

    socket.on('typing', ({ scope, targetId, isTyping }) => {
      const userData = activeUsers.get(socket.id);
      if (!userData) return;

      if (scope === 'private' && targetId) {
        socket.to(targetId).emit('typing', {
          fromName: userData.anonymous ? 'Anonymous' : userData.username,
          isTyping,
          scope: 'private',
        });
      } else {
        socket.to(userData.roomId).emit('typing', {
          fromName: userData.anonymous ? 'Anonymous' : userData.username,
          isTyping,
          scope: 'public',
        });
      }
    });

    socket.on('message_seen', async ({ messageId, type, otherId, otherUserId }) => {
      try {
        const userData = activeUsers.get(socket.id);
        if (!userData) return;

        const { data: message } = await supabase
          .from('messages')
          .select('seen_by')
          .eq('id', messageId)
          .single();

        if (!message) return;

        const seenBy = Array.isArray(message.seen_by) ? [...message.seen_by] : [];
        if (!seenBy.includes(userData.userId)) {
          seenBy.push(userData.userId);
          await supabase
            .from('messages')
            .update({ seen_by: seenBy })
            .eq('id', messageId);

          const payload = { messageId, type, seenBy };
          if (type === 'private') {
            const peerUserId = otherUserId || (otherId && activeUsers.get(otherId)?.userId);
            if (peerUserId) {
              socket.emit('message_seen_update', payload);
              getSocketsForUser(io, peerUserId).forEach((sid) => {
                if (sid !== socket.id) io.to(sid).emit('message_seen_update', payload);
              });
            }
          } else {
            io.to(userData.roomId).emit('message_seen_update', payload);
          }
        }
      } catch (error) {
        console.error('Error marking message as seen:', error);
      }
    });

    const VALID_EMOJIS = ['👍', '😂', '❤️', '😮'];
    socket.on('react_message', async ({ messageId, type, emoji, otherId, otherUserId }) => {
      try {
        const userData = activeUsers.get(socket.id);
        if (!userData) return;
        if (!VALID_EMOJIS.includes(emoji)) return;

        const { data: message } = await supabase
          .from('messages')
          .select('reactions')
          .eq('id', messageId)
          .single();

        if (!message) return;

        const reactions = message.reactions && typeof message.reactions === 'object'
          ? { ...message.reactions }
          : {};
        if (!reactions[emoji]) reactions[emoji] = [];
        const arr = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];
        const idx = arr.indexOf(userData.userId);
        if (idx >= 0) arr.splice(idx, 1);
        else arr.push(userData.userId);
        reactions[emoji] = arr;

        await supabase
          .from('messages')
          .update({ reactions })
          .eq('id', messageId);

        const payload = { messageId, type, emoji, reactors: arr };
        if (type === 'private') {
          const peerUserId = otherUserId || (otherId && activeUsers.get(otherId)?.userId);
          if (peerUserId) {
            socket.emit('reaction_update', payload);
            getSocketsForUser(io, peerUserId).forEach((sid) => {
              if (sid !== socket.id) io.to(sid).emit('reaction_update', payload);
            });
          }
        } else {
          io.to(userData.roomId).emit('reaction_update', payload);
        }
      } catch (error) {
        console.error('Error reacting to message:', error);
      }
    });

    socket.on('create_poll', async ({ question, options }, callback) => {
      try {
        const userData = activeUsers.get(socket.id);
        if (!userData) {
          return callback({ ok: false, error: 'Not in a room' });
        }

        if (!question || !Array.isArray(options) || options.length < 2) {
          return callback({ ok: false, error: 'Invalid poll data' });
        }

        const { data: poll, error } = await supabase
          .from('polls')
          .insert({
            room_id: userData.roomId,
            creator_id: userData.userId,
            question: question.trim(),
            options: options.filter((o) => o.trim()).slice(0, 10),
            votes: {},
          })
          .select('*')
          .single();

        if (error) {
          return callback({ ok: false, error: 'Failed to create poll' });
        }

        const pollData = {
          id: poll.id,
          question: poll.question,
          options: poll.options,
          votes: poll.votes || {},
        };

        io.to(userData.roomId).emit('poll_created', pollData);
        callback({ ok: true });
      } catch (error) {
        console.error('Error creating poll:', error);
        callback({ ok: false, error: 'Server error' });
      }
    });

    socket.on('vote_poll', async ({ pollId, optionIndex }, callback) => {
      try {
        const userData = activeUsers.get(socket.id);
        if (!userData) {
          return callback({ ok: false, error: 'Not in a room' });
        }

        const { data: poll } = await supabase
          .from('polls')
          .select('*')
          .eq('id', pollId)
          .single();

        if (!poll) {
          return callback({ ok: false, error: 'Poll not found' });
        }

        const votes = poll.votes || {};
        votes[userData.userId] = optionIndex;

        await supabase
          .from('polls')
          .update({ votes })
          .eq('id', pollId);

        io.to(userData.roomId).emit('poll_updated', {
          id: pollId,
          votes,
        });

        callback({ ok: true });
      } catch (error) {
        console.error('Error voting on poll:', error);
        callback({ ok: false, error: 'Server error' });
      }
    });

    socket.on('admin_action', async ({ action, targetId, targetUserId, durationMinutes }, callback) => {
      try {
        const userData = activeUsers.get(socket.id);
        if (!userData) {
          return callback?.({ ok: false, error: 'Not in a room' });
        }

        const { data: membership } = await supabase
          .from('room_memberships')
          .select('role')
          .eq('room_id', userData.roomId)
          .eq('user_id', userData.userId)
          .single();

        if (!membership || membership.role !== 'admin') {
          return callback?.({ ok: false, error: 'Not authorized' });
        }

        const roomId = userData.roomId;
        const targetUid = targetUserId || (targetId && activeUsers.get(targetId)?.userId);

        if (action === 'kick' || action === 'remove_user') {
          if (!targetUid) {
            return callback?.({ ok: false, error: 'Target user required' });
          }
          await supabase
            .from('room_memberships')
            .delete()
            .eq('room_id', roomId)
            .eq('user_id', targetUid);

          getSocketsForUser(io, targetUid).forEach((sid) => {
            const data = activeUsers.get(sid);
            if (data && data.roomId === roomId) {
              activeUsers.delete(sid);
              const roomSockets = roomMembers.get(roomId);
              if (roomSockets) roomSockets.delete(sid);
              io.to(sid).emit('kicked');
            }
          });

          const { data: allMemberships } = await supabase
            .from('room_memberships')
            .select('user_id, role, muted')
            .eq('room_id', roomId);
          io.to(roomId).emit('members_update', buildMembersList(roomId, allMemberships));
        } else if (action === 'mute' && targetUid) {
          await supabase
            .from('room_memberships')
            .update({ muted: true })
            .eq('room_id', roomId)
            .eq('user_id', targetUid);
          const { data: allMemberships } = await supabase
            .from('room_memberships')
            .select('user_id, role, muted')
            .eq('room_id', roomId);
          io.to(roomId).emit('members_update', buildMembersList(roomId, allMemberships));
        } else if (action === 'unmute' && targetUid) {
          await supabase
            .from('room_memberships')
            .update({ muted: false })
            .eq('room_id', roomId)
            .eq('user_id', targetUid);
          const { data: allMemberships } = await supabase
            .from('room_memberships')
            .select('user_id, role, muted')
            .eq('room_id', roomId);
          io.to(roomId).emit('members_update', buildMembersList(roomId, allMemberships));
        } else if (action === 'delete_room') {
          await supabase.from('messages').delete().eq('room_id', roomId);
          await supabase.from('polls').delete().eq('room_id', roomId);
          await supabase
            .from('rooms')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', roomId);
          roomMembers.delete(roomId);
          io.to(roomId).emit('room_closed', { reason: 'deleted' });
        } else if (action === 'lock' || action === 'unlock') {
          const { data: room } = await supabase
            .from('rooms')
            .select('settings')
            .eq('id', roomId)
            .single();
          const settings = { ...(room?.settings || {}), locked: action === 'lock' };
          await supabase.from('rooms').update({ settings }).eq('id', roomId);
          io.to(roomId).emit('room_settings', settings);
        } else if (action === 'enable_private' || action === 'disable_private') {
          const { data: room } = await supabase
            .from('rooms')
            .select('settings')
            .eq('id', roomId)
            .single();
          const settings = { ...(room?.settings || {}), privateChatEnabled: action === 'enable_private' };
          await supabase.from('rooms').update({ settings }).eq('id', roomId);
          io.to(roomId).emit('room_settings', settings);
        } else if (action === 'extend_duration') {
          const { data: room } = await supabase
            .from('rooms')
            .select('expires_at, settings')
            .eq('id', roomId)
            .single();
          if (!room) return callback?.({ ok: false, error: 'Room not found' });
          const add = Number.isFinite(durationMinutes) ? Math.max(5, Math.min(durationMinutes, 480)) : 15;
          const base = room.expires_at && new Date(room.expires_at) > new Date()
            ? new Date(room.expires_at)
            : new Date();
          const newExpiresAt = new Date(base.getTime() + add * 60 * 1000).toISOString();
          const updatedSettings = { ...(room.settings || {}), durationMinutes: (room.settings?.durationMinutes || 0) + add };
          await supabase.from('rooms').update({ expires_at: newExpiresAt, settings: updatedSettings }).eq('id', roomId);
          io.to(roomId).emit('room_updated', { roomId, expiresAt: newExpiresAt });
        }

        callback?.({ ok: true });
      } catch (error) {
        console.error('Error performing admin action:', error);
        callback?.({ ok: false, error: 'Server error' });
      }
    });

    socket.on('disconnect', async () => {
      const set = userIdToSockets.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) userIdToSockets.delete(userId);
      }
      const userData = activeUsers.get(socket.id);
      if (userData) {
        const { roomId } = userData;
        activeUsers.delete(socket.id);

        const roomSockets = roomMembers.get(roomId);
        if (roomSockets) {
          roomSockets.delete(socket.id);
          const { data: allMemberships } = await supabase
            .from('room_memberships')
            .select('user_id, role, muted')
            .eq('room_id', roomId);
          io.to(roomId).emit('members_update', buildMembersList(roomId, allMemberships || []));
          io.to(roomId).emit('member_left', { id: socket.id });
        }
      }
    });
  });
}

module.exports = { setupSocketHandlers };
