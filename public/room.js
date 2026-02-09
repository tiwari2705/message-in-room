(() => {
  const params = new URLSearchParams(window.location.search);
  const isCreateFlow = params.get('create') === '1';
  const pathParts = window.location.pathname.split('/');
  const pathCode = pathParts[pathParts.length - 1];
  const roomCode = pathCode && pathCode !== 'new' ? pathCode : null;

  const $ = (id) => document.getElementById(id);

  const themeToggle = $('theme-toggle');
  const leaveBtn = $('leave-room-btn');
  const roomTitle = $('room-title');
  const roomSubtitle = $('room-subtitle');
  const roomCodePill = $('room-code-pill');
  const roomTimerPill = $('room-timer-pill');

  const tabPublic = $('tab-public');
  const tabPrivate = $('tab-private');
  const publicMessagesEl = $('public-messages');
  const privateMessagesEl = $('private-messages');
  const typingIndicator = $('typing-indicator');
  const privateUnreadBadge = $('private-unread-badge');
  const anonymousToggle = $('anonymous-toggle');
  const messageInput = $('message-input');
  const sendBtn = $('send-btn');
  const sendStatus = $('send-status');

  const memberList = $('member-list');
  const memberCount = $('member-count');
  const adminPanel = $('admin-panel');
  const lockBtn = $('lock-btn');
  const unlockBtn = $('unlock-btn');
  const enablePrivateBtn = $('enable-private-btn');
  const disablePrivateBtn = $('disable-private-btn');
  const deleteRoomBtn = $('delete-room-btn');

  const pollsList = $('polls-list');
  const pollForm = $('poll-form');
  const pollQuestion = $('poll-question');
  const addOptionBtn = $('add-option-btn');
  const newPollToggle = $('new-poll-toggle');

  let currentUser = {
    id: null,
    username: 'Guest',
    anonymous: false,
    isAdmin: false,
  };
  let currentRoom = {
    code: roomCode,
    roomId: null,
    expiresAt: null,
    settings: {
      locked: false,
      privateChatEnabled: true,
    },
  };
  let members = {};
  let targetPrivateId = null;
  let targetPrivateUserId = null;
  let privateUnreadCount = 0;
  let lastTypingSentAt = 0;

  function setTheme(theme) {
    document.body.classList.toggle('theme-dark', theme === 'dark');
    document.body.classList.toggle('theme-light', theme === 'light');
  }

  const storedTheme = localStorage.getItem('chat-theme') || 'light';
  setTheme(storedTheme);
  themeToggle.checked = storedTheme === 'dark';
  themeToggle.addEventListener('change', () => {
    const theme = themeToggle.checked ? 'dark' : 'light';
    localStorage.setItem('chat-theme', theme);
    setTheme(theme);
  });

  const socket = io({ withCredentials: true });

  socket.on('connect', () => {
    if (isCreateFlow) {
      socket.emit('create_room', {}, (res) => {
        if (!res || !res.ok) {
          alert(res?.error || 'Failed to create room. Are you logged in?');
          window.location.href = '/';
          return;
        }
        handleJoinSuccess(res);
      });
    } else if (roomCode) {
      socket.emit('join_room', { roomCode }, (res) => {
        if (!res || !res.ok) {
          alert(res?.error || 'Failed to join room. Are you logged in?');
          window.location.href = '/';
          return;
        }
        handleJoinSuccess(res);
      });
    } else {
      alert('Missing room information');
      window.location.href = '/';
    }
  });

  socket.on('connect_error', () => {
    alert('Connection failed. Please log in on the home page first.');
    window.location.href = '/';
  });

  function handleJoinSuccess(res) {
    currentUser.id = res.userId || currentUser.id;
    currentUser.username = res.username || currentUser.username;
    currentRoom.code = res.roomCode;
    currentRoom.roomId = res.roomId;
    currentRoom.expiresAt = res.expiresAt;
    currentRoom.settings = res.settings || currentRoom.settings;
    currentUser.isAdmin = !!res.isAdmin;
    members = {};
    if (res.members) {
      res.members.forEach((m) => {
        members[m.id] = m;
      });
    }
    updateAdminUI();
    updateMembersUI();
    updateRoomHeader();
    if (Array.isArray(res.publicMessages)) {
      res.publicMessages.forEach((m) => renderMessage(m, 'public'));
    }
    if (Array.isArray(res.polls)) {
      res.polls.forEach(renderPoll);
    }
    startTimer();
  }

  function updateRoomHeader() {
    roomTitle.textContent = `Room ${currentRoom.code || ''}`;
    roomSubtitle.textContent = currentUser.isAdmin
      ? 'You are the admin · Share the code to invite others'
      : 'Classroom chat · Temporary room';
    roomCodePill.textContent = `Code: ${currentRoom.code || '—'}`;
  }

  let timerInterval = null;
  function startTimer() {
    if (!currentRoom.expiresAt) return;
    if (timerInterval) clearInterval(timerInterval);
    const tick = () => {
      const ms = currentRoom.expiresAt - Date.now();
      if (ms <= 0) {
        roomTimerPill.textContent = 'Room ending...';
        clearInterval(timerInterval);
        return;
      }
      const totalSeconds = Math.floor(ms / 1000);
      const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
      const s = String(totalSeconds % 60).padStart(2, '0');
      roomTimerPill.textContent = `Room ends in ${m}:${s}`;
    };
    tick();
    timerInterval = setInterval(tick, 1000);
  }

  leaveBtn.addEventListener('click', () => {
    window.location.href = '/';
  });

  tabPublic.addEventListener('click', () => {
    tabPublic.classList.add('active');
    tabPrivate.classList.remove('active');
    publicMessagesEl.classList.remove('hidden');
    privateMessagesEl.classList.add('hidden');
  });

  tabPrivate.addEventListener('click', () => {
    tabPrivate.classList.add('active');
    tabPublic.classList.remove('active');
    publicMessagesEl.classList.add('hidden');
    privateMessagesEl.classList.remove('hidden');
    privateUnreadCount = 0;
    updatePrivateUnreadBadge();
  });

  function updatePrivateUnreadBadge() {
    if (privateUnreadCount > 0) {
      privateUnreadBadge.hidden = false;
      privateUnreadBadge.textContent = privateUnreadCount;
    } else {
      privateUnreadBadge.hidden = true;
    }
  }

  anonymousToggle.addEventListener('change', () => {
    const anonymous = anonymousToggle.checked;
    currentUser.anonymous = anonymous;
    socket.emit('toggle_anonymous', { anonymous });
  });

  function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 96) + 'px';
  }

  messageInput.addEventListener('input', () => {
    autoResizeTextarea();
    maybeSendTyping();
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  function parseMentionTarget(text) {
    const match = text.match(/^@(\S+)\s+/);
    if (!match) return null;
    const name = match[1];
    const entry = Object.entries(members).find(
      ([id, m]) => !m.anonymous && m.username === name,
    );
    if (!entry) return null;
    return entry[1].userId ? { userId: entry[1].userId, socketId: entry[0] } : null;
  }

  sendBtn.addEventListener('click', () => {
    const raw = messageInput.value;
    const text = raw.trim();
    if (!text) return;

    const mention = parseMentionTarget(raw);
    const privateTarget = (mention && mention.userId) || (tabPrivate.classList.contains('active') && targetPrivateUserId ? targetPrivateUserId : null);
    sendStatus.textContent = 'Sending...';
    if (privateTarget && currentRoom.settings.privateChatEnabled) {
      const receiverUserId = mention && mention.userId ? mention.userId : targetPrivateUserId;
      if (!receiverUserId) {
        sendStatus.textContent = 'Select a member for private chat';
        return;
      }
      socket.emit(
        'send_private_message',
        { receiverUserId, text },
        (res) => {
          if (!res || !res.ok) {
            sendStatus.textContent = res?.error || 'Failed to send';
          } else {
            sendStatus.textContent = 'Sent';
          }
        },
      );
    } else {
      socket.emit(
        'send_public_message',
        { text },
        (res) => {
          if (!res || !res.ok) {
            sendStatus.textContent = res?.error || 'Failed to send';
          } else {
            sendStatus.textContent = 'Sent';
          }
        },
      );
    }

    messageInput.value = '';
    autoResizeTextarea();
  });

  function maybeSendTyping() {
    const now = Date.now();
    if (now - lastTypingSentAt < 500) return;
    lastTypingSentAt = now;
    const scope =
      tabPrivate.classList.contains('active') && (targetPrivateId || targetPrivateUserId)
        ? 'private'
        : 'public';
    const targetId = scope === 'private' ? targetPrivateId : null;
    socket.emit('typing', { scope, targetId, isTyping: true });
    setTimeout(() => {
      socket.emit('typing', { scope, targetId, isTyping: false });
    }, 2000);
  }

  function updateMembersUI() {
    memberList.innerHTML = '';
    const entries = Object.entries(members);
    memberCount.textContent = entries.length;
    entries.forEach(([id, m]) => {
      const li = document.createElement('li');
      li.className = 'member-item';
      li.dataset.id = id;
      const main = document.createElement('div');
      main.className = 'member-main';
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      const initial = (m.username || '?').charAt(0).toUpperCase();
      avatar.textContent = initial;
      const name = document.createElement('div');
      name.className = 'member-name';
      name.textContent = m.anonymous ? 'Anonymous' : m.username;
      main.appendChild(avatar);
      main.appendChild(name);
      const tags = document.createElement('div');
      tags.className = 'member-tags';
      if (m.isAdmin) {
        const t = document.createElement('span');
        t.textContent = 'Admin';
        tags.appendChild(t);
      }
      if (m.muted) {
        const t = document.createElement('span');
        t.textContent = 'Muted';
        tags.appendChild(t);
      }

      li.appendChild(main);
      li.appendChild(tags);

      li.addEventListener('click', () => {
        if (m.userId === currentUser.id) return;
        targetPrivateId = id;
        targetPrivateUserId = m.userId || null;
        tabPrivate.click();
      });

      if (currentUser.isAdmin && m.userId && m.userId !== currentUser.id) {
        li.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const choice = prompt(
            'Admin action: type "kick", "mute", or "unmute".',
          );
          if (!choice) return;
          const action = choice.toLowerCase();
          if (!['kick', 'mute', 'unmute'].includes(action)) return;
          socket.emit('admin_action', { action, targetUserId: m.userId });
        });
      }

      memberList.appendChild(li);
    });
  }

  function updateAdminUI() {
    adminPanel.hidden = !currentUser.isAdmin;
  }

  function renderMessage(msg, scope) {
    const container = scope === 'private' ? privateMessagesEl : publicMessagesEl;
    const el = document.createElement('div');
    el.className = 'message';
    if (msg.senderId === currentUser.id) {
      el.classList.add('self');
    }
    el.dataset.id = msg.id;
    el.dataset.type = scope;
    const header = document.createElement('div');
    header.className = 'message-header';
    const sender = document.createElement('div');
    sender.className = 'message-sender';
    sender.textContent = msg.senderName;
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const time = new Date(msg.createdAt || Date.now());
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.textContent = timeStr;
    header.appendChild(sender);
    header.appendChild(meta);
    const body = document.createElement('div');
    body.className = 'message-text';
    body.textContent = msg.text;

    const footer = document.createElement('div');
    footer.className = 'message-footer';

    const reactionsEl = document.createElement('div');
    reactionsEl.className = 'reactions';
    const emojis = ['👍', '😂', '❤️', '😮'];
    const reactionCount = (obj, emoji) => {
      const arr = obj && obj[emoji];
      return Array.isArray(arr) ? arr.length : 0;
    };
    emojis.forEach((emoji) => {
      const r = document.createElement('button');
      r.type = 'button';
      r.className = 'reaction';
      const count = reactionCount(msg.reactions, emoji);
      r.textContent = count > 0 ? `${emoji} ${count}` : emoji;
      r.addEventListener('click', () => {
        const otherUserId =
          scope === 'private'
            ? (msg.senderId === currentUser.id ? msg.receiverId : msg.senderId)
            : null;
        socket.emit('react_message', {
          messageId: msg.id,
          type: scope,
          emoji,
          otherUserId,
        });
      });
      reactionsEl.appendChild(r);
    });

    const receipt = document.createElement('div');
    receipt.className = 'receipt';
    if (msg.senderId === currentUser.id) {
      const seenBy = Array.isArray(msg.seenBy) ? msg.seenBy : [];
      const isSeen = seenBy.length > 1;
      receipt.textContent = isSeen ? '✔✔ Seen' : '✔ Sent';
    }

    footer.appendChild(reactionsEl);
    footer.appendChild(receipt);

    el.appendChild(header);
    el.appendChild(body);
    el.appendChild(footer);

    container.appendChild(el);
    container.scrollTop = container.scrollHeight;

    if (msg.senderId !== currentUser.id) {
      const otherUserId =
        scope === 'private'
          ? (msg.senderId === currentUser.id ? msg.receiverId : msg.senderId)
          : null;
      socket.emit('message_seen', {
        messageId: msg.id,
        type: scope,
        otherUserId,
      });
    }
  }

  socket.on('public_message', (msg) => {
    renderMessage(msg, 'public');
  });

  socket.on('private_message', (msg) => {
    renderMessage(msg, 'private');
    if (!tabPrivate.classList.contains('active')) {
      privateUnreadCount += 1;
      updatePrivateUnreadBadge();
    }
  });

  socket.on('typing', ({ fromName, isTyping, scope }) => {
    if (!isTyping) {
      typingIndicator.textContent = '';
      return;
    }
    typingIndicator.textContent =
      scope === 'private'
        ? `${fromName} is typing in private chat…`
        : `${fromName} is typing…`;
  });

  socket.on('message_seen_update', ({ messageId, type, seenBy }) => {
    const container = type === 'private' ? privateMessagesEl : publicMessagesEl;
    const el = container.querySelector(`.message[data-id="${messageId}"]`);
    if (!el) return;
    const receipt = el.querySelector('.receipt');
    if (!receipt) return;
    if (!seenBy || !Array.isArray(seenBy)) return;
    const isSeen = seenBy.length > 1;
    receipt.textContent = isSeen ? '✔✔ Seen' : '✔ Sent';
  });

  socket.on('reaction_update', ({ messageId, type, emoji, reactors }) => {
    const container = type === 'private' ? privateMessagesEl : publicMessagesEl;
    const el = container.querySelector(`.message[data-id="${messageId}"]`);
    if (!el) return;
    const buttons = el.querySelectorAll('.reaction');
    const count = Array.isArray(reactors) ? reactors.length : 0;
    buttons.forEach((btn) => {
      if (btn.textContent.startsWith(emoji) || btn.textContent === emoji) {
        btn.textContent = count > 0 ? `${emoji} ${count}` : emoji;
      }
    });
  });

  socket.on('members_update', (list) => {
    members = {};
    list.forEach((m) => {
      members[m.id] = m;
    });
    updateMembersUI();
  });

  socket.on('member_joined', ({ id }) => {
    const m = members[id];
    if (m) return;
  });

  socket.on('member_left', ({ id }) => {
    delete members[id];
    updateMembersUI();
  });

  socket.on('room_settings', (settings) => {
    currentRoom.settings = settings;
  });

  socket.on('room_updated', ({ expiresAt }) => {
    if (expiresAt) {
      currentRoom.expiresAt = typeof expiresAt === 'string' ? new Date(expiresAt).getTime() : expiresAt;
      startTimer();
    }
  });

  function renderPoll(poll) {
    const existing = pollsList.querySelector(`[data-id="${poll.id}"]`);
    if (existing) existing.remove();
    const wrapper = document.createElement('div');
    wrapper.className = 'poll';
    wrapper.dataset.id = poll.id;
    const q = document.createElement('div');
    q.className = 'poll-question';
    q.textContent = poll.question;
    wrapper.appendChild(q);
    const optionsEl = document.createElement('div');
    optionsEl.className = 'poll-options';
    const counts = new Array(poll.options.length).fill(0);
    const votes = poll.votes || {};
    Object.values(votes).forEach((index) => {
      if (typeof index === 'number' && index >= 0 && index < counts.length) {
        counts[index] += 1;
      }
    });
    const total = counts.reduce((a, b) => a + b, 0) || 1;

    poll.options.forEach((opt, index) => {
      const row = document.createElement('div');
      row.className = 'poll-option-row';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `poll-${poll.id}`;
      radio.checked = votes[currentUser.id] === index;
      radio.addEventListener('change', () => {
        socket.emit(
          'vote_poll',
          { pollId: poll.id, optionIndex: index },
          () => {},
        );
      });

      const label = document.createElement('span');
      label.textContent = opt;
      label.style.flex = '0 0 auto';

      const bar = document.createElement('div');
      bar.className = 'poll-bar';
      const fill = document.createElement('div');
      fill.className = 'poll-bar-fill';
      const pct = (counts[index] / total) * 100;
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);

      const countLabel = document.createElement('span');
      countLabel.style.fontSize = '0.7rem';
      countLabel.style.color = 'var(--text-muted)';
      countLabel.textContent = counts[index];

      row.appendChild(radio);
      row.appendChild(label);
      row.appendChild(bar);
      row.appendChild(countLabel);
      optionsEl.appendChild(row);
    });

    wrapper.appendChild(optionsEl);
    pollsList.appendChild(wrapper);
  }

  socket.on('poll_created', (poll) => {
    renderPoll(poll);
  });

  socket.on('poll_updated', ({ id, votes }) => {
    const existing = pollsList.querySelector(`[data-id="${id}"]`);
    if (!existing) return;
    const question = existing.querySelector('.poll-question').textContent;
    const options = Array.from(
      existing.querySelectorAll('.poll-option-row span:first-of-type'),
    ).map((el) => el.textContent);
    renderPoll({ id, question, options, votes });
  });

  newPollToggle.addEventListener('click', () => {
    pollForm.classList.toggle('hidden');
  });

  addOptionBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'poll-option';
    input.placeholder = 'Another option';
    input.maxLength = 80;
    pollForm.insertBefore(input, addOptionBtn);
  });

  pollForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const question = pollQuestion.value.trim();
    const options = Array.from(
      pollForm.querySelectorAll('.poll-option'),
    ).map((el) => el.value.trim());
    socket.emit(
      'create_poll',
      { question, options },
      (res) => {
        if (!res || !res.ok) {
          alert(res?.error || 'Failed to create poll');
        } else {
          pollQuestion.value = '';
          pollForm.querySelectorAll('.poll-option').forEach((el, idx) => {
            if (idx < 2) {
              el.value = '';
            } else {
              el.remove();
            }
          });
          pollForm.classList.add('hidden');
        }
      },
    );
  });

  const adminButtons = [
    lockBtn,
    unlockBtn,
    enablePrivateBtn,
    disablePrivateBtn,
    deleteRoomBtn,
    document.getElementById('extend-room-btn'),
  ];
  adminButtons.forEach((btn) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      const action = btn.dataset.admin;
      if (action === 'delete_room') {
        const sure = confirm(
          'Delete this room for everyone? All messages will be lost.',
        );
        if (!sure) return;
      }
      const durationMinutes = btn.dataset.duration ? parseInt(btn.dataset.duration, 10) : undefined;
      socket.emit('admin_action', { action, durationMinutes }, () => {});
    });
  });

  socket.on('kicked', () => {
    alert('You were removed from the room.');
    window.location.href = '/';
  });

  socket.on('room_closed', ({ reason }) => {
    const msg =
      reason === 'expired'
        ? 'This room has expired. All data was deleted.'
        : 'This room was closed by the admin.';
    alert(msg);
    window.location.href = '/';
  });
})();

