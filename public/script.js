const socket = io();

const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const leaveBtn = document.getElementById("leaveBtn");
const roomKeyInput = document.getElementById("roomKey");
const usernameInput = document.getElementById("username");
const chatScreen = document.getElementById("chatScreen");
const joinScreen = document.getElementById("joinScreen");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const messagesDiv = document.getElementById("messages");
const fileInput = document.getElementById("fileInput");
const emojiBtn = document.getElementById("emojiBtn");
const gifBtn = document.getElementById("gifBtn");
const stickerBtn = document.getElementById("stickerBtn");
const mediaPicker = document.getElementById("media-picker");
const joinRequestModal = document.getElementById("joinRequestModal");
const joinRequestUser = document.getElementById("joinRequestUser");
const approveJoinBtn = document.getElementById("approveJoinBtn");
const denyJoinBtn = document.getElementById("denyJoinBtn");

let roomKey, username, isAdmin = false;
let pendingJoinRequest = null;

// ✅ Expanded emoji list with categories
const emojis = [
  // Smileys
  "😀","😁","😂","🤣","😃","😄","😅","😆","😉","😊",
  "😋","😎","😍","😘","🥰","😗","😙","😚","🙂","🤗",
  "🤩","🤔","🤨","😐","😑","😶","🙄","😏","😣","😥",
  "😮","🤐","😯","😪","😫","🥱","😴","😌","😛","😜",
  "😝","🤤","😒","😓","😔","😕","🙃","🤑","😲","☹️",
  "🙁","😖","😞","😟","😤","😢","😭","😦","😧","😨",
  "😩","🤯","😬","😰","😱","🥵","🥶","😳","🤪","😵",
  "🥴","😠","😡","🤬","😷","🤒","🤕","🤢","🤮","🥳",
  // Gestures
  "👍","👎","👏","🙌","👐","🤲","🤝","🙏","✌️","🤞",
  "🤟","🤘","👌","🤌","🤏","👈","👉","👆","👇","☝️",
  // Hearts & symbols
  "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔",
  "💯","🔥","✨","⭐","🎉","🎊","🎈","💫","💥","🌟",
];

const stickers = [
  "/stickers/sticker1.png",
  "/stickers/sticker2.png",
  "/stickers/sticker3.png",
];

// ✅ XSS sanitizer — prevents malicious HTML injection
function sanitize(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}

function showChatScreen() {
  joinScreen.style.opacity = 0;
  setTimeout(() => {
    joinScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
  }, 500);
}

createRoomBtn.onclick = () => {
  roomKey = roomKeyInput.value.trim();
  username = usernameInput.value.trim();
  if (!roomKey || !username) return alert("Please enter a username and a room key.");
  socket.emit("create-room", { roomKey, username });
};

joinRoomBtn.onclick = () => {
  roomKey = roomKeyInput.value.trim();
  username = usernameInput.value.trim();
  if (!roomKey || !username) return alert("Please enter a username and a room key.");
  socket.emit("join-room", { roomKey, username });
};

leaveBtn.onclick = () => {
  socket.emit("leave-room", { roomKey, username });
  chatScreen.classList.add("hidden");
  joinScreen.classList.remove("hidden");
  joinScreen.style.opacity = 1;
  messagesDiv.innerHTML = "";
  roomKeyInput.value = "";
  isAdmin = false;
};

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendBtn.click();
  }
});

sendBtn.onclick = () => {
  const message = messageInput.value.trim();
  if (message === "") return;
  socket.emit("chat-message", { roomKey, username, message: { type: "text", content: message } });
  messageInput.value = "";
};

fileInput.onchange = () => {
  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  fetch("/upload", { method: "POST", body: formData })
    .then((res) => res.json())
    .then(({ path, error }) => {
      if (error) {
        alert("Upload failed: " + error);
        return;
      }
      if (path) {
        socket.emit("file-uploaded", { roomKey, username, path });
      }
    })
    .catch(() => alert("Upload failed. Please try again."));

  // Reset so same file can be re-uploaded
  fileInput.value = "";
};

approveJoinBtn.onclick = () => {
  if (pendingJoinRequest) {
    socket.emit("approve-join", {
      roomKey,
      userId: pendingJoinRequest.userId,
      username: pendingJoinRequest.username,
    });
    joinRequestModal.classList.add("hidden");
    pendingJoinRequest = null;
  }
};

denyJoinBtn.onclick = () => {
  if (pendingJoinRequest) {
    socket.emit("deny-join", { roomKey, userId: pendingJoinRequest.userId });
    joinRequestModal.classList.add("hidden");
    pendingJoinRequest = null;
  }
};

socket.on("room-created", (data) => {
  isAdmin = data.isAdmin;
  showChatScreen();
  displaySystemMessage("You created the room and are now the admin.");
});

socket.on("room-exists", (message) => { alert(message); });
socket.on("room-not-found", (message) => { alert(message); });
socket.on("admin-offline", (message) => { alert(message); });
socket.on("join-request-sent", (message) => { alert(message); });

socket.on("join-request", ({ userId, username: reqUsername }) => {
  if (isAdmin) {
    pendingJoinRequest = { userId, username: reqUsername };
    joinRequestUser.innerText = `${reqUsername} wants to join the room.`;
    joinRequestModal.classList.remove("hidden");
  }
});

socket.on("join-approved", (data) => {
  messagesDiv.innerHTML = "";
  data.messages.forEach((msg) => displayMessage(msg.username, msg.message));
  data.files.forEach((file) => displayFile(file.username, file.path));
  showChatScreen();
  displaySystemMessage("Your request was approved. Welcome to the room!");
});

socket.on("join-denied", (message) => { alert(message); });

socket.on("promoted-to-admin", () => {
  isAdmin = true;
  displaySystemMessage("The previous admin left. You are the new admin!");
});

socket.on("chat-message", ({ username: msgUser, message }) => {
  displayMessage(msgUser, message);
});

socket.on("file-uploaded", ({ username: fileUser, path }) => {
  displayFile(fileUser, path);
});

socket.on("user-joined", (joinedUsername) => {
  displaySystemMessage(`${joinedUsername} joined the room`);
});

socket.on("user-left", (leftUsername) => {
  displaySystemMessage(`${leftUsername} left the room`);
});

function displaySystemMessage(message) {
  const div = document.createElement("div");
  div.className = "message italic mb-2 text-gray-400 text-center";
  div.innerText = message;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function displayMessage(user, message) {
  const div = document.createElement("div");
  div.className = "message mb-4 flex";
  const messageBubble = document.createElement("div");
  messageBubble.className = "p-3 rounded-lg max-w-xs";

  if (user === username) {
    div.classList.add("justify-end");
    messageBubble.classList.add("bg-blue-500", "text-white");
  } else {
    messageBubble.classList.add("bg-gray-700");
  }

  if (message.type === "text") {
    // ✅ Sanitized to prevent XSS
    messageBubble.innerHTML = `<span class="font-bold">${sanitize(user)}:</span> ${sanitize(message.content)}`;
  } else if (message.type === "gif" || message.type === "sticker") {
    const img = document.createElement("img");
    img.src = message.content;
    img.className = "mt-2 rounded-lg max-w-full";
    const label = document.createElement("span");
    label.className = "font-bold";
    label.textContent = user + ":";
    messageBubble.appendChild(label);
    messageBubble.appendChild(img);
  }

  div.appendChild(messageBubble);
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function displayFile(user, filePath) {
  const div = document.createElement("div");
  div.className = "message mb-4 flex";
  if (user === username) div.classList.add("justify-end");

  // ✅ Built with DOM API — no innerHTML with user data
  const bubble = document.createElement("div");
  bubble.className = `p-3 rounded-lg max-w-xs ${user === username ? "bg-blue-500 text-white" : "bg-gray-700"}`;

  const label = document.createElement("span");
  label.className = "font-bold";
  label.textContent = sanitize(user) + " uploaded a file: ";

  const link = document.createElement("a");
  link.href = filePath;
  link.target = "_blank";
  link.className = "text-green-400 underline";
  // Show filename without the timestamp prefix
  link.textContent = filePath.split("-").slice(1).join("-") || filePath;

  bubble.appendChild(label);
  bubble.appendChild(link);
  div.appendChild(bubble);
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// --- Media Picker ---
emojiBtn.onclick = () => toggleMediaPicker("emoji");
gifBtn.onclick = () => toggleMediaPicker("gif");
stickerBtn.onclick = () => toggleMediaPicker("sticker");

function toggleMediaPicker(type) {
  if (mediaPicker.style.display === "block" && mediaPicker.dataset.type === type) {
    mediaPicker.style.display = "none";
    return;
  }

  mediaPicker.style.display = "block";
  mediaPicker.dataset.type = type;
  mediaPicker.innerHTML = "";

  if (type === "emoji") {
    emojis.forEach((emoji) => {
      const btn = document.createElement("button");
      btn.innerHTML = emoji;
      btn.className = "m-1 text-2xl hover:scale-125 transition-transform";
      btn.onclick = () => {
        messageInput.value += emoji;
        messageInput.focus();
      };
      mediaPicker.appendChild(btn);
    });
  } else if (type === "sticker") {
    stickers.forEach((sticker) => {
      const img = document.createElement("img");
      img.src = sticker;
      img.className = "m-2 w-24 h-24 cursor-pointer inline-block rounded-lg hover:scale-110 transition-transform";
      img.onclick = () => {
        socket.emit("chat-message", { roomKey, username, message: { type: "sticker", content: sticker } });
        mediaPicker.style.display = "none";
      };
      mediaPicker.appendChild(img);
    });
  } else if (type === "gif") {
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search for GIFs...";
    searchInput.className = "w-full p-2 rounded-lg bg-gray-700 text-white";
    searchInput.onkeydown = (e) => {
      if (e.key === "Enter") searchGifs(searchInput.value);
    };
    mediaPicker.appendChild(searchInput);

    const resultsDiv = document.createElement("div");
    resultsDiv.className = "mt-2 grid grid-cols-3 gap-2";
    mediaPicker.appendChild(resultsDiv);

    // ✅ Now hits our server proxy — API key stays hidden
    searchGifs("trending");
  }
}

function searchGifs(query) {
  // ✅ Calls server-side proxy instead of Giphy directly
  fetch(`/api/gifs?q=${encodeURIComponent(query)}`)
    .then((res) => res.json())
    .then((data) => {
      const resultsDiv = mediaPicker.querySelector("div");
      if (!resultsDiv) return;
      resultsDiv.innerHTML = "";
      (data.data || []).forEach((gif) => {
        const img = document.createElement("img");
        img.src = gif.images.fixed_height.url;
        img.className = "cursor-pointer w-full rounded hover:opacity-80 transition-opacity";
        img.onclick = () => {
          socket.emit("chat-message", { roomKey, username, message: { type: "gif", content: img.src } });
          mediaPicker.style.display = "none";
        };
        resultsDiv.appendChild(img);
      });
    })
    .catch(() => {
      const resultsDiv = mediaPicker.querySelector("div");
      if (resultsDiv) resultsDiv.innerHTML = `<p class="text-red-400 text-sm">Failed to load GIFs.</p>`;
    });
}
