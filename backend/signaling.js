const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Room and client management
let rooms = new Map(); // roomId -> Set of clients
let clientInfo = new Map(); // ws -> { room, userName, id }

// Generate unique client ID
function generateClientId() {
  return Math.random().toString(36).substring(2, 15);
}

// Get participants list for a room with IDs
function getRoomParticipants(roomId) {
  const roomClients = rooms.get(roomId) || new Set();
  const participants = [];

  roomClients.forEach(client => {
    const info = clientInfo.get(client);
    if (info) {
      participants.push({
        id: info.id,
        userName: info.userName
      });
    }
  });

  return participants;
}

// Broadcast message to all clients in a room except sender
function broadcastToRoom(roomId, message, excludeClient = null) {
  const roomClients = rooms.get(roomId);
  if (!roomClients) return;

  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);

  roomClients.forEach(client => {
    if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
}

// Send message to specific client
function sendToClient(client, message) {
  if (client.readyState === WebSocket.OPEN) {
    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
    client.send(messageStr);
  }
}

// Clean up client from all data structures
function cleanupClient(ws) {
  const info = clientInfo.get(ws);
  if (info) {
    const roomClients = rooms.get(info.room);
    if (roomClients) {
      roomClients.delete(ws);

      // If room is empty, remove it
      if (roomClients.size === 0) {
        rooms.delete(info.room);
        console.log(`Room ${info.room} deleted (empty)`);
      } else {
        // Notify others in room about user leaving
        const updatedParticipants = getRoomParticipants(info.room);
        broadcastToRoom(info.room, {
          type: "user-left",
          userName: info.userName,
          participants: updatedParticipants
        }, ws);
      }
    }
    clientInfo.delete(ws);
  }
}

wss.on("connection", (ws) => {
  const clientId = generateClientId();
  console.log(`Client connected: ${clientId}`);

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      console.log(`Received from ${clientId}:`, data.type, data.room || '');

      switch (data.type) {
        case "join-room":
          handleJoinRoom(ws, data, clientId);
          break;

        case "leave-room":
          handleLeaveRoom(ws, data);
          break;

        case "offer":
        case "answer":
        case "candidate":
          handleWebRTCMessage(ws, data);
          break;

        default:
          console.log("Unknown message type:", data.type);
          break;
      }
    } catch (error) {
      console.error("Error parsing message:", error);
      // For backward compatibility, broadcast raw messages
      broadcastRawMessage(ws, msg.toString());
    }
  });

  ws.on("close", () => {
    console.log(`Client disconnected: ${clientId}`);
    cleanupClient(ws);
  });

  ws.on("error", (error) => {
    console.error(`Client error ${clientId}:`, error);
    cleanupClient(ws);
  });
});

function handleJoinRoom(ws, data, clientId) {
  const { room, userName } = data;

  if (!room || !userName) {
    sendToClient(ws, {
      type: "error",
      message: "Room ID and username are required"
    });
    return;
  }

  // Clean up any existing room association
  cleanupClient(ws);

  // Add client to room
  if (!rooms.has(room)) {
    rooms.set(room, new Set());
  }

  rooms.get(room).add(ws);
  clientInfo.set(ws, {
    room: room,
    userName: userName,
    id: clientId
  });

  const participants = getRoomParticipants(room);

  // Confirm room join to the client
  sendToClient(ws, {
    type: "room-joined",
    room: room,
    participants: participants
  });

  // Notify others in the room
  broadcastToRoom(room, {
    type: "user-joined",
    userName: userName,
    participants: participants
  }, ws);

  console.log(`${userName} joined room ${room}. Participants: ${participants.length}`);
}

function handleLeaveRoom(ws, data) {
  cleanupClient(ws);
}

function handleWebRTCMessage(ws, data) {
  const info = clientInfo.get(ws);
  if (!info) {
    console.log("WebRTC message from client not in room");
    return;
  }

  // Add sender info to WebRTC messages for multi-peer support
  const messageWithSender = {
    ...data,
    from: info.id,
    fromUser: info.userName
  };

  // If message has a target, send only to that client
  if (data.to) {
    const roomClients = rooms.get(info.room);
    if (roomClients) {
      roomClients.forEach(client => {
        const clientData = clientInfo.get(client);
        if (clientData && clientData.id === data.to && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(messageWithSender));
        }
      });
    }
  } else {
    // Broadcast to all others in room
    broadcastToRoom(info.room, messageWithSender, ws);
  }
}

// Backward compatibility function
function broadcastRawMessage(ws, message) {
  const info = clientInfo.get(ws);
  if (info) {
    broadcastToRoom(info.room, message, ws);
  }
}

// API endpoints
app.get("/", (req, res) => {
  res.json({
    message: "Enhanced signaling server running",
    rooms: rooms.size,
    totalClients: clientInfo.size
  });
});

app.get("/stats", (req, res) => {
  const roomStats = {};
  rooms.forEach((clients, roomId) => {
    roomStats[roomId] = {
      participants: getRoomParticipants(roomId),
      count: clients.size
    };
  });

  res.json({
    totalRooms: rooms.size,
    totalClients: clientInfo.size,
    rooms: roomStats
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    rooms: rooms.size,
    clients: clientInfo.size
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Enhanced signaling server running at http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});

module.exports = { app, server, wss };