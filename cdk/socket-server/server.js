const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

// ─── Socket.IO Connection ─────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("🔌 CLIENT CONNECTED:", socket.id);
  console.log(
    process.env.SM_DB_CREDENTIALS
      ? "🔐 DB CREDENTIALS LOADED"
      : "❌ NO DB CREDENTIALS"
  );
  console.log(
    process.env.RDS_PROXY_ENDPOINT ? "🔐 RDS PROXY LOADED" : "❌ NO RDS PROXY"
  );

  let novaProcess = null;
  let novaReady = false;

  // Small delay then log active client count
  setTimeout(() => {
    console.log(`🔌 ACTIVE CLIENTS: ${io.engine.clientsCount}`);
  }, 100);

  socket.on("error", (err) => {
    console.error("🔌 SOCKET ERROR:", err);
  });

  // ─── Start Nova Sonic ──────────────────────────────────────────────────────
  socket.on("start-nova-sonic", (config = {}) => {
    console.log("🚀 Starting Nova Sonic session for client:", socket.id);
    console.log("🎙️ Voice configuration:", config);

    audioStarted = false;

    // Kill any previous process
    if (novaProcess) {
      console.log("⚠️ Killing existing Nova process");
      novaProcess.kill();
      novaProcess = null;
    }
    novaReady = false;

    // Spawn the actual CLI entrypoint, unbuffered, passing env vars
    const PORT = process.env.PORT || 80;
    novaProcess = spawn("python3", ["nova_sonic.py"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,

        SOCKET_URL: `http://127.0.0.1:${PORT}`,
        SESSION_ID: config.session_id || "default",
        VOICE_ID: config.voice_id || "",
        SSL_VERIFY: "false",
        SM_DB_CREDENTIALS: process.env.SM_DB_CREDENTIALS || "",
        RDS_PROXY_ENDPOINT: process.env.RDS_PROXY_ENDPOINT || "",
      },
    });
    console.log("📡 Nova process spawned with PID:", novaProcess.pid);

    // Capture stdout and stderr
    novaProcess.stdout.on("data", (data) => {
      data
        .toString()
        .split("\n")
        .filter(Boolean)
        .forEach((line) => {
          try {
            const parsed = JSON.parse(line);
            console.log("📤 NOVA JSON:", parsed);

            // ─ Audio chunks ───────────────────────────────────────────────
            if (parsed.type === "audio") {
              // Save debug files
              const debugDir = path.join(__dirname, "debug");
              if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);
              const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
              const txtPath = path.join(debugDir, `audio-${timestamp}.txt`);
              fs.writeFileSync(txtPath, parsed.data);
              console.log(`📝 NOVA AUDIO SAVED: ${txtPath}`);

              const buffer = Buffer.from(parsed.data, "base64");
              const rawPath = path.join(debugDir, `audio-${timestamp}.raw`);
              fs.writeFileSync(rawPath, buffer);
              console.log(`✅ NOVA AUDIO DECODED: ${buffer.length} bytes`);

              // Emit to clients
              socket.emit("audio-chunk", { data: parsed.data });
              console.log("🔊 AUDIO SENT TO FRONTEND");
            }
            // ─ Debug messages ───────────────────────────────────────────
            else if (parsed.type === "debug") {
              console.log("🐞 NOVA DEBUG:", parsed.text);
            }
            // ─ Text messages ─────────────────────────────────────────────
            else if (parsed.type === "text") {
              console.log("💬 NOVA TEXT:", parsed.text);
              socket.emit("text-message", { text: parsed.text });
              if (parsed.text.includes("Nova Sonic ready")) {
                novaReady = true;
                socket.emit("nova-started", {
                  status: "Nova Sonic session started",
                });
              }
            }
          } catch {
            // Plain‑text fallback
            console.log("[python]", line);
            if (line.includes("Nova Sonic ready")) {
              novaReady = true;
              socket.emit("nova-started", {
                status: "Nova Sonic session started",
              });
            }
          }
        });
    });

    novaProcess.stderr.on("data", (data) => {
      console.warn("⚠️ Nova stderr:", data.toString().trim());
    });

    novaProcess.on("close", (code) => {
      console.log("🔚 Nova process closed with code:", code);
      novaProcess = null;
      novaReady = false;
    });
  });

  // ─── Audio‑input from client ──────────────────────────────────────────────
  let audioStarted = false;
  socket.on("audio-input", (msg) => {
    console.log(
      "🎤 Received audio-input, size:",
      msg.data ? msg.data.length : "no data"
    );
    if (novaProcess && novaProcess.stdin.writable && novaReady) {
      if (!audioStarted) {
        novaProcess.stdin.write(JSON.stringify({ type: "start_audio" }) + "\n");
        audioStarted = true;
        console.log("🎬 Sent start_audio to Nova process");
      }
      novaProcess.stdin.write(
        JSON.stringify({ type: "audio", data: msg.data }) + "\n"
      );
      console.log("📤 Sent audio to Nova process");
    } else {
      console.log("❌ Cannot send audio - not ready or stdin closed");
    }
  });

  // ─── Text‑input from client ───────────────────────────────────────────────
  socket.on("text-input", (msg) => {
    if (novaProcess && novaProcess.stdin.writable && novaReady) {
      novaProcess.stdin.write(
        JSON.stringify({ type: "text", data: msg.text }) + "\n"
      );
      console.log("📝 Sent text to Nova process");
    }
  });

  // ─── End‑audio event ─────────────────────────────────────────────────────
  socket.on("end-audio", () => {
    if (novaProcess && novaProcess.stdin.writable && novaReady) {
      novaProcess.stdin.write(JSON.stringify({ type: "end_audio" }) + "\n");
      audioStarted = false;
      console.log("🛑 Sent end_audio to Nova process");
    }
  });

  // ─── Optional Stop event ────────────────────────────────────────────────
  socket.on("stop-nova-sonic", () => {
    console.log("🛑 Stop requested by client");
    if (novaProcess) {
      novaProcess.kill();
      novaProcess = null;
      novaReady = false;
    }
  });

  // ─── Do NOT kill on disconnect ──────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log("🔌 CLIENT DISCONNECTED:", socket.id, "- Nova still running");
  });
});

// ─── Start HTTP server on port 80 ─────────────────────────────────────────
const PORT = process.env.PORT || 80;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Socket server running on port ${PORT}`);
});
