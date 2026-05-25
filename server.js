
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// CORS
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));

app.use(express.static(path.join(__dirname, "public")));

// --- File Upload Setup ---
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
];

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("File type not allowed. Allowed: images, PDF, text."), false);
    }
  },
});

app.post("/upload", (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    const filePath = `/uploads/${req.file.filename}`;
    res.json({ path: filePath });
  });
});

app.use("/uploads", express.static(uploadDir));

// --- Giphy Proxy Route (keeps API key server-side) ---
app.get("/api/gifs", async (req, res) => {
  const query = req.query.q || "trending";
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Giphy API key not configured." });
  }
  try {
    const endpoint =
      query === "trending"
        ? `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=12`
        : `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=12`;

    const response = await fetch(endpoint);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch GIFs." });
  }
});

// --- Socket.IO Room Logic ---
let rooms = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("create-room", ({ roomKey, username }) => {
    if (rooms[roomKey]) {
      return socket.emit("room-exists", "This room key is already taken.");
    }
    socket.join(roomKey);
    rooms[roomKey] = {
      admin: { id: socket.id, username },
      users: [{ id: socket.id, username }],
      messages: [],
      files: [],
      pendingUsers: [],
    };
    socket.emit("room-created", { roomKey, isAdmin: true });
    io.to(roomKey).emit("user-joined", username);
  });

  socket.on("join-room", ({ roomKey, username }) => {
    const room = rooms[roomKey];
    if (!room) {
      return socket.emit("room-not-found", "This room does not exist.");
    }

    const adminSocket = io.sockets.sockets.get(room.admin.id);
    if (adminSocket) {
      room.pendingUsers.push({ id: socket.id, username });
      adminSocket.emit("join-request", { userId: socket.id, username });
      socket.emit("join-request-sent", "Your request to join has been sent to the admin.");
    } else {
      socket.emit("admin-offline", "The admin of this room is currently offline.");
    }
  });

  socket.on("approve-join", ({ roomKey, userId, username }) => {
    const room = rooms[roomKey];
    if (room && room.admin.id === socket.id) {
      const userToJoin = room.pendingUsers.find((u) => u.id === userId);
      if (userToJoin) {
        room.pendingUsers = room.pendingUsers.filter((u) => u.id !== userId);
        room.users.push(userToJoin);

        const userSocket = io.sockets.sockets.get(userId);
        if (userSocket) {
          userSocket.join(roomKey);
          userSocket.emit("join-approved", {
            roomKey,
            messages: room.messages,
            files: room.files,
          });
          io.to(roomKey).emit("user-joined", userToJoin.username);
        }
      }
    }
  });

  socket.on("deny-join", ({ roomKey, userId }) => {
    const room = rooms[roomKey];
    if (room && room.admin.id === socket.id) {
      room.pendingUsers = room.pendingUsers.filter((u) => u.id !== userId);
      const userSocket = io.sockets.sockets.get(userId);
      if (userSocket) {
        userSocket.emit("join-denied", "Your request to join was denied.");
      }
    }
  });

  socket.on("chat-message", ({ roomKey, username, message }) => {
    const messageData = { username, message };
    if (rooms[roomKey]) {
      rooms[roomKey].messages.push(messageData);
    }
    io.to(roomKey).emit("chat-message", messageData);
  });

  socket.on("file-uploaded", ({ roomKey, username, path }) => {
    const fileData = { username, path };
    if (rooms[roomKey]) {
      rooms[roomKey].files.push(fileData);
    }
    io.to(roomKey).emit("file-uploaded", fileData);
  });

  socket.on("leave-room", ({ roomKey, username }) => {
    handleUserLeave(socket, roomKey, username);
  });

  socket.on("disconnect", () => {
    for (const roomKey in rooms) {
      const user = rooms[roomKey].users.find((u) => u.id === socket.id);
      if (user) {
        handleUserLeave(socket, roomKey, user.username);
        break;
      }
    }
    console.log("User disconnected:", socket.id);
  });

  function handleUserLeave(socket, roomKey, username) {
    if (!rooms[roomKey]) return;
    socket.leave(roomKey);

    const room = rooms[roomKey];
    room.users = room.users.filter((u) => u.id !== socket.id);

    if (room.users.length === 0) {
      delete rooms[roomKey];
      return;
    }

    io.to(roomKey).emit("user-left", username);

    if (room.admin.id === socket.id) {
      room.admin = room.users[0];
      const adminSocket = io.sockets.sockets.get(room.admin.id);
      if (adminSocket) {
        adminSocket.emit("promoted-to-admin");
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
