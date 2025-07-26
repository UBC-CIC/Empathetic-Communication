const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { spawn } = require("child_process");

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

let novaProcess = null;
let novaReady = false;

// Health check route
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    socket_ok: !!io,
    timestamp: new Date().toISOString(),
  });
});

io.on("connection", (socket) => {
  console.log("🔌 CLIENT CONNECTED:", socket.id);

  socket.on("start-nova-sonic", async (config = {}) => {
    console.log("🚀 Starting Nova Sonic session");

    if (novaProcess) {
      novaProcess.kill();
    }
    novaReady = false;

    // spawn the CLI that actually starts the session, unbuffered
    novaProcess = spawn("python3", ["-u", "nova_sonic.py"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        SOCKET_URL: "http://localhost:80",
      },
    });

    novaProcess.stdout.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "audio" && parsed.data) {
            io.emit("audio-chunk", { data: parsed.data });
          } else if (parsed.type === "text" && parsed.text) {
            io.emit("text-message", { text: parsed.text });
            if (parsed.text.includes("Nova Sonic ready")) {
              novaReady = true;
              io.emit("nova-started", { status: "Nova Sonic ready" });
            }
          }
        } catch {
          // ignore non‑JSON output
        }
      }
    });

    novaProcess.stderr.on("data", (data) => {
      console.warn("Nova stderr:", data.toString().trim());
    });

    novaProcess.on("close", (code) => {
      console.log("Nova process closed with code:", code);
      novaProcess = null;
      novaReady = false;
    });

    // Optionally send voice_id and start_session here...
  });

  socket.on("audio-input", (data) => {
    if (novaProcess && novaProcess.stdin.writable && novaReady) {
      novaProcess.stdin.write(
        JSON.stringify({ type: "audio", data: data.data }) + "\n"
      );
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    if (novaProcess) novaProcess.kill();
  });
});

// Listen on port 80
server.listen(80, "0.0.0.0", () => {
  console.log("Socket server (HTTP) running on port 80");
});
