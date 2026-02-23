// Cheeseboard WebSocket Relay — Deno Deploy
// Deploy at: https://dash.deno.com/new

const rooms = new Map();

Deno.serve((req) => {
  const url = new URL(req.url);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
      }
    });
  }

  // WebSocket upgrade
  if (req.headers.get('upgrade') === 'websocket') {
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleSocket(socket);
    return response;
  }

  // Health check / root
  return new Response('Cheeseboard WS Relay ✅ Running', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
});

function handleSocket(ws) {
  let roomId = null;
  const userId = Math.random().toString(36).substr(2, 8);

  ws.onopen = () => {
    console.log('Client connected:', userId);
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === 'join') {
      roomId = msg.room;
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      const room = rooms.get(roomId);
      room.add(ws);
      ws._userId = userId;

      const count = room.size;
      safeSend(ws, { type: 'joined', userId, count });
      broadcastRoom(roomId, ws, { type: 'peer_joined', userId, count });

      // Ask existing peer to share canvas state with newcomer
      if (count > 1) {
        for (const peer of room) {
          if (peer !== ws && peer.readyState === WebSocket.OPEN) {
            safeSend(peer, { type: 'request_state', targetUserId: userId });
            break;
          }
        }
      }
      return;
    }

    if (!roomId) return;

    // Targeted message (state sync to specific user)
    if (msg.targetUserId) {
      const room = rooms.get(roomId);
      if (room) {
        for (const peer of room) {
          if (peer._userId === msg.targetUserId && peer.readyState === WebSocket.OPEN) {
            peer.send(e.data);
            break;
          }
        }
      }
      return;
    }

    // Broadcast to everyone else in room
    broadcastRoom(roomId, ws, msg);
  };

  ws.onclose = () => {
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.delete(ws);
      console.log(`User ${userId} left room ${roomId}, ${room.size} remaining`);
      if (room.size === 0) {
        rooms.delete(roomId);
      } else {
        broadcastRoom(roomId, ws, { type: 'peer_left', userId });
      }
    }
  };

  ws.onerror = (e) => {
    console.error('WS error for', userId, e.message);
  };
}

function broadcastRoom(roomId, sender, msg) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msg);
  for (const client of room) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function safeSend(ws, msg) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  } catch (e) {
    console.error('safeSend error:', e.message);
  }
}
