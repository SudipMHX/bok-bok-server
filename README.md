# 🐔 Bok-Bok Server

A lightweight, real-time anonymous chat room backend built with **Express.js**, **Socket.IO**, and **MongoDB**.

Rooms are temporary — they expire automatically and all associated messages are cleaned up. No accounts, no history, just ephemeral chat.

---

## Features

- 🔐 **Anonymous rooms** — create public or private chat rooms with a 6-character ID
- ⏳ **Auto-expiry** — rooms expire between 1–24 hours; a background job purges rooms and their messages
- 💬 **Real-time messaging** — powered by Socket.IO with delivery acknowledgements
- 🚫 **Profanity filter** — messages cleaned via `leo-profanity`
- 🛡️ **Spam protection** — per-socket rate limiter (max 3 messages/second)
- 📄 **Paginated message history** — REST endpoint for fetching past messages
- 📊 **Live user counts** — active socket count per room via Socket.IO adapter
- 👥 **Total joined count** — unique nickname count from message history

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js v5 |
| Real-time | Socket.IO v4 |
| Database | MongoDB + Mongoose |
| Rate Limiting | express-rate-limit |
| Profanity Filter | leo-profanity |

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- A running MongoDB instance (local or Atlas)

### Installation

```bash
git clone <your-repo-url>
cd bok-bok-server
npm install
```

### Environment Variables

Copy `.env.example` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `MONGODB_URI` | MongoDB connection string | *(required)* |
| `PORT` | HTTP server port | `4000` |
| `CORS_ORIGIN` | Allowed CORS origin | `*` |

### Run

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

---

## API Reference

### Rooms

#### `POST /api/rooms`
Create a new room.

**Body**
```json
{
  "roomName": "My Room",
  "expireHours": 2,
  "isPrivate": false
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "roomName": "My Room",
    "roomId": "a1b2c3",
    "isPrivate": false,
    "expiresAt": "2026-01-01T14:00:00.000Z"
  }
}
```

> Rate limited to **5 rooms per IP per hour**.

---

#### `GET /api/rooms/public`
List all public rooms with live online count and total participants.

**Response**
```json
{
  "success": true,
  "data": [
    {
      "roomName": "My Room",
      "roomId": "a1b2c3",
      "expiresAt": "...",
      "userCount": 3,
      "totalJoined": 12
    }
  ]
}
```

---

#### `GET /api/rooms/:roomId`
Get a single room by ID.

**Response**
```json
{
  "success": true,
  "data": {
    "roomName": "My Room",
    "roomId": "a1b2c3",
    "isPrivate": false,
    "expiresAt": "...",
    "totalJoined": 12
  }
}
```

---

### Messages

#### `GET /api/messages/:roomId?page=1&limit=50`
Fetch paginated messages for a room (newest first).

**Response**
```json
{
  "success": true,
  "data": {
    "messages": [
      { "roomId": "a1b2c3", "senderName": "Alice", "text": "Hello!", "createdAt": "..." }
    ],
    "pagination": { "page": 1, "limit": 50, "total": 120, "totalPages": 3 }
  }
}
```

---

#### `POST /api/messages/:roomId`
Post a message to a room via REST (Socket.IO preferred for real-time use).

**Body**
```json
{
  "senderName": "Alice",
  "text": "Hello!"
}
```

---

## Socket.IO Events

Connect to the server at `ws://localhost:4000`.

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `join_room` | `{ roomId, senderName }` | Join a room |
| `send_message` | `{ roomId, senderName, text }` | Send a message (with ack callback) |
| `typing` | `{ roomId, senderName }` | Notify others you're typing |
| `stop_typing` | `{ roomId, senderName }` | Notify others you stopped typing |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `receive_message` | `{ roomId, senderName, text, createdAt }` | New message broadcast |
| `system_message` | `{ text }` | User joined/left notifications |
| `room_users_count` | `{ count }` | Updated live user count |
| `user_typing` | `{ senderName }` | Who is typing (`null` = stopped) |
| `error` | `{ message }` | Room not found or expired |

### Example (browser)

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000');

socket.emit('join_room', { roomId: 'a1b2c3', senderName: 'Alice' });

socket.emit('send_message', { roomId: 'a1b2c3', senderName: 'Alice', text: 'Hey!' }, (ack) => {
  console.log(ack); // { success: true, message: 'Delivered' }
});

socket.on('receive_message', (msg) => {
  console.log(msg.senderName, ':', msg.text);
});
```

---

## Validation Limits

| Field | Limit |
|---|---|
| `roomName` | Max 60 characters |
| `senderName` | Max 30 characters |
| `text` | Max 500 characters |
| `expireHours` | 1 – 24 |
| Request body | Max 16 KB |

---

## Project Structure

```
bok-bok-server/
├── index.js          # Entry point, Express + Socket.IO setup
├── models/
│   ├── Room.js       # Room schema with compound indexes
│   └── Message.js    # Message schema with compound indexes
├── routes/
│   ├── rooms.js      # Room CRUD endpoints
│   └── messages.js   # Message fetch + post endpoints
└── utils/
    └── cleanup.js    # Background job: purges expired rooms & orphaned messages
```

---

## License

ISC
