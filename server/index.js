const { Server } = require("socket.io");

const PORT = process.env.PORT || 8000;

const io = new Server(PORT, {
  cors: {
    origin: process.env.CLIENT_URL || "*", // Update with your Vercel client URL
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

const emailToSocketIdMap = new Map();
const socketidToEmailMap = new Map();

io.on("connection", (socket) => {
  console.log(`Socket Connected`, socket.id);
  
  socket.on("room:join", (data) => {
    const { email, room } = data;
    emailToSocketIdMap.set(email, socket.id);
    socketidToEmailMap.set(socket.id, email);
    io.to(room).emit("user:joined", { email, id: socket.id });
    socket.join(room);
    io.to(socket.id).emit("room:join", data);
  });

  socket.on("user:call", ({ to, offer }) => {
    io.to(to).emit("incomming:call", { from: socket.id, offer });
  });

  socket.on("call:accepted", ({ to, ans }) => {
    io.to(to).emit("call:accepted", { from: socket.id, ans });
  });

  socket.on("peer:nego:needed", ({ to, offer }) => {
    console.log("peer:nego:needed", offer);
    io.to(to).emit("peer:nego:needed", { from: socket.id, offer });
  });

  socket.on("peer:nego:done", ({ to, ans }) => {
    console.log("peer:nego:done", ans);
    io.to(to).emit("peer:nego:final", { from: socket.id, ans });
  });

  socket.on("hand:raised", ({ to, isRaised }) => {
    console.log("hand:raised", { from: socket.id, to, isRaised });
    io.to(to).emit("hand:raised", { from: socket.id, isRaised });
  });

  socket.on("disconnect", () => {
    console.log(`Socket Disconnected`, socket.id);
    const email = socketidToEmailMap.get(socket.id);
    if (email) {
      emailToSocketIdMap.delete(email);
      socketidToEmailMap.delete(socket.id);
    }
  });
});

console.log(`Server running on port ${PORT}`);