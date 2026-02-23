const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Glitch / Render / Railway all inject PORT via env
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // Serve cheeseboard as main app if present, fallback to index.html
  const serveFile = (filename, contentType) => {
    const filePath = path.join(__dirname, filename);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
      return true;
    }
    return false;
  };

  if (req.url === '/' || req.url === '/index.html') {
    if (!serveFile('cheeseboard.html', 'text/html')) {
      serveFile('index.html', 'text/html');
    }
  } else if (req.url === '/cheeseboard.html') {
    serveFile('cheeseboard.html', 'text/html');
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocket.Server({ server });

// Rooms: roomId -> Set of clients
const rooms = new Map();

wss.on('connection', (ws) => {
  let roomId = null;
  let userId = Math.random().toString(36).substr(2, 8);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch { return; }

    if (msg.type === 'join') {
      roomId = msg.room;
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      const room = rooms.get(roomId);
      room.add(ws);
      ws.roomId = roomId;
      ws.userId = userId;

      const count = room.size;
      ws.send(JSON.stringify({ type: 'joined', userId, count }));

      // Notify others
      broadcast(roomId, ws, { type: 'peer_joined', userId, count });

      // Ask existing peer to send canvas state to newcomer
      if (count > 1) {
        for (const peer of room) {
          if (peer !== ws && peer.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify({ type: 'request_state', targetUserId: userId }));
            break;
          }
        }
      }
      return;
    }

    if (!roomId) return;

    // If message has a targetUserId, send only to that user
    if (msg.targetUserId) {
      const room = rooms.get(roomId);
      if (room) {
        for (const peer of room) {
          if (peer.userId === msg.targetUserId && peer.readyState === WebSocket.OPEN) {
            peer.send(data.toString());
            break;
          }
        }
      }
      return;
    }

    // Otherwise broadcast to everyone else in room
    broadcast(roomId, ws, msg);
  });

  ws.on('close', () => {
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.delete(ws);
      if (room.size === 0) {
        rooms.delete(roomId);
      } else {
        broadcast(roomId, ws, { type: 'peer_left', userId });
      }
    }
  });
});

function broadcast(roomId, sender, msg) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msg);
  for (const client of room) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

server.listen(PORT, () => {
  console.log(`Collaborative Whiteboard running at http://localhost:${PORT}`);
});
