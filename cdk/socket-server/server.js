const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();

// Create HTTP server
const server = createServer(app);

// Configure Socket.IO with proper CORS settings
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS || "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Add middleware to handle CORS for Express
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});


let novaProcess = null;
let novaReady = false;

app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

app.get("/debug", (req, res) => {
  res.json({
    status: "healthy",
    novaReady: novaReady,
    novaProcessActive: novaProcess !== null,
    novaProcessPid: novaProcess ? novaProcess.pid : null,
    connectedClients: Object.keys(io.sockets.sockets).length,
    timestamp: new Date().toISOString(),
  });
});

io.on("connection", (socket) => {
  console.log("🔌 CLIENT CONNECTED:", socket.id);

  // Wait for the socket to be registered before counting
  setTimeout(() => {
    const clientCount = Object.keys(io.sockets.sockets).length;
    console.log(`🔌 ACTIVE CLIENTS: ${io.engine.clientsCount}`);
  }, 100); // 100ms delay

  // Setup socket error handler
  socket.on("error", (error) => {
    console.error("🔌 SOCKET ERROR:", error);
  });

  socket.on("start-nova-sonic", async (config = {}) => {
    console.log("🚀 Starting Nova Sonic session for client:", socket.id);
    console.log("🎙️ Voice configuration:", config);

    if (novaProcess) {
      console.log("⚠️ Killing existing Nova process");
      novaProcess.kill();
    }

    novaReady = false;
    novaProcess = spawn("python3", ["nova_boto3.py"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    console.log("📡 Nova process spawned with PID:", novaProcess.pid);
    
    // Send voice configuration if provided
    if (config.voice_id) {
      console.log(`🎙️ Setting voice to: ${config.voice_id}`);
      setTimeout(() => {
        if (novaProcess && novaProcess.stdin.writable) {
          const voiceConfig = JSON.stringify({ 
            type: "set_voice", 
            voice_id: config.voice_id 
          }) + "\n";
          novaProcess.stdin.write(voiceConfig);
          console.log(`💬 Voice configuration sent to Nova: ${config.voice_id}`);
        } else {
          console.error("❌ Cannot send voice config - Nova process not writable");
        }
      }, 500); // Short delay to ensure process is ready
    }

    // Start Nova session after process is ready and after voice config is sent
    setTimeout(() => {
      if (novaProcess && novaProcess.stdin.writable) {
        const startSession = JSON.stringify({ type: "start_session" }) + "\n";
        novaProcess.stdin.write(startSession);
        console.log("🚀 Start session command sent to Nova");
      }
    }, 1500); // Increased delay to ensure voice config is processed first

    novaProcess.stdout.on("data", (data) => {
      console.log("📥 NOVA OUTPUT:", data.toString());
      const lines = data
        .toString()
        .split("\n")
        .filter((line) => line.trim());

      lines.forEach((line) => {
        try {
          const parsed = JSON.parse(line);
          console.log("📤 NOVA RETURNED:", JSON.stringify(parsed));
          if (parsed.type === "audio") {
            const dataLength = parsed.data ? parsed.data.length : 0;
            const dataSize = parsed.size || "unknown";
            console.log(
              `🎵 NOVA AUDIO: length=${dataLength}, size=${dataSize}`
            );

            if (!parsed.data) {
              console.error("❌ NOVA AUDIO ERROR: Empty data!");
            } else {
              try {
                // Save audio data to file for debugging
                const fs = require("fs");
                const path = require("path");
                const debugDir = path.join(__dirname, "debug");

                // Create debug directory if it doesn't exist
                if (!fs.existsSync(debugDir)) {
                  fs.mkdirSync(debugDir);
                }

                // Save base64 audio data to file
                const timestamp = new Date()
                  .toISOString()
                  .replace(/[:.]/g, "-");
                const debugFilePath = path.join(
                  debugDir,
                  `audio-${timestamp}.txt`
                );
                fs.writeFileSync(debugFilePath, parsed.data);
                console.log(`📝 NOVA AUDIO SAVED: ${debugFilePath}`);

                try {
                  const buffer = Buffer.from(parsed.data, "base64");
                  console.log(`✅ NOVA AUDIO DECODED: ${buffer.length} bytes`);

                  // Save raw audio to file
                  const rawFilePath = path.join(
                    debugDir,
                    `audio-${timestamp}.raw`
                  );
                  fs.writeFileSync(rawFilePath, buffer);

                  // IMPORTANT: Emit to all connected clients
                  console.log("🔊 SENDING AUDIO TO FRONTEND");

                  // Create a test audio file to verify audio is working
                  io.emit("audio-chunk", { data: parsed.data });
                  console.log("🔊 AUDIO SENT TO FRONTEND");
                } catch (decodeError) {
                  console.error("❌ NOVA AUDIO DECODE ERROR:", decodeError);
                }
              } catch (audioError) {
                console.error("❌ NOVA AUDIO PROCESSING ERROR:", audioError);
              }
            }
          } else if (parsed.type === "debug") {
            console.log("🐞 NOVA DEBUG:", parsed.text);
          } else if (parsed.type === "text") {
            console.log("💬 NOVA TEXT:", parsed.text);
            io.emit("text-message", { text: parsed.text });
            if (parsed.text.includes("Nova Sonic ready")) {
              novaReady = true;
              io.emit("nova-started", { status: "Nova Sonic session started" });
            }
          }
        } catch (e) {
          console.log("📝 NOVA RAW OUTPUT:", line);
          if (line.includes("ready") || line.includes("started")) {
            novaReady = true;
            // Use io.emit instead of socket.emit to ensure all clients get the message
            io.emit("nova-started", {
              status: "Nova Sonic session started",
            });
          }
        }
      });
    });

    novaProcess.stderr.on("data", (data) => {
      const stderrLine = data.toString().trim();
      console.warn(`⚠️ Nova stderr: ${stderrLine}`);
    });

    novaProcess.on("close", (code) => {
      console.log("🔚 Nova process closed with code:", code);
      novaProcess = null;
      novaReady = false;
    });
  });

  let audioStarted = false;

  socket.on("audio-input", (data) => {
    console.log(
      "🎤 Received audio-input from frontend, size:",
      data.data ? data.data.length : "no data"
    );

    if (novaProcess && novaProcess.stdin.writable && novaReady) {
      try {
        if (!data.data || data.data.length === 0) {
          console.error("❌ Empty audio data received");
          return;
        }

        try {
          const buffer = Buffer.from(data.data, "base64");
          console.log(
            `✅ Valid base64 data, decoded size: ${buffer.length} bytes`
          );
        } catch (decodeError) {
          console.error("❌ Invalid base64 data:", decodeError);
          return;
        }

        // ✅ Only send start_audio once
        if (!audioStarted) {
          novaProcess.stdin.write(
            JSON.stringify({ type: "start_audio" }) + "\n"
          );
          audioStarted = true;
          console.log("🎬 Sent start_audio to Nova process");
        }

        const input = JSON.stringify({ type: "audio", data: data.data }) + "\n";
        novaProcess.stdin.write(input);
        console.log("📤 Sent audio to Nova process");
      } catch (error) {
        console.error("❌ Error sending audio to Nova process:", error);
      }
    } else {
      console.log(
        "❌ Cannot send audio - Nova not ready or process not writable"
      );
    }
  });

  socket.on("text-input", (data) => {
    if (novaProcess && novaProcess.stdin.writable && novaReady) {
      const input = JSON.stringify({ type: "text", data: data.text }) + "\n";
      novaProcess.stdin.write(input);
    }
  });

  socket.on("end-audio", () => {
    console.log("🛑 Received end-audio request from client:", socket.id);
    if (novaProcess && novaProcess.stdin.writable && novaReady) {
      try {
        const endAudio = JSON.stringify({ type: "end_audio" }) + "\n";
        novaProcess.stdin.write(endAudio);
        audioStarted = false; // 🧼 reset flag
        console.log("✅ End audio signal sent to Nova process");
      } catch (error) {
        console.error("❌ Error sending end-audio signal:", error);
      }
    }
  });

  socket.on("start-audio", () => {
    if (novaProcess && novaProcess.stdin.writable && novaReady) {
      const startAudio = JSON.stringify({ type: "start_audio" }) + "\n";
      novaProcess.stdin.write(startAudio);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    if (novaProcess) {
      novaProcess.kill();
      novaProcess = null;
    }
  });
});

const PORT = process.env.PORT || 3000;

// Add a root route for health checks
app.get('/', (req, res) => {
  res.status(200).send('Socket server is running');
});

// Start the server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Socket server running on port ${PORT}`);
  console.log(`CORS allowed origins: ${process.env.ALLOWED_ORIGINS || '*'}`);
});
