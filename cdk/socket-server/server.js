const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { verifyToken, getStsCredentials } = require("./auth");

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
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication token required"));
    }

    const decoded = await verifyToken(token);
    socket.userId = decoded.sub;
    socket.userEmail = decoded.email;
    console.log("🔐 User authenticated:", socket.userEmail);
    next();
  } catch (err) {
    console.error("🔐 Authentication failed:", err.message);
    next(new Error("Authentication failed"));
  }
});

io.on("connection", (socket) => {
  console.log("🔌 CLIENT CONNECTED:", socket.id, "User:", socket.userEmail);
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
  socket.on("start-nova-sonic", async (config = {}) => {
    console.log("🚀 Starting Nova Sonic session for client:", socket.id);
    console.log("🎙️ Voice configuration:", config);
    
    // Check user token limits before starting voice session
    try {
      const response = await fetch(
        `${process.env.TEXT_GENERATION_ENDPOINT}/student/check_tokens?session_id=${config.session_id}`,
        {
          headers: {
            Authorization: socket.handshake.auth.token,
          },
        }
      );
      
      if (response.status === 429) {
        const errorData = await response.json();
        socket.emit("token-limit-exceeded", errorData);
        return;
      }
    } catch (error) {
      console.warn("Token limit check failed, proceeding:", error.message);
    }

    audioStarted = false;

    // Kill any previous process
    if (novaProcess) {
      console.log("⚠️ Killing existing Nova process");
      novaProcess.kill();
      novaProcess = null;
    }
    novaReady = false;

    // Get STS credentials from Cognito token
    const stsCredentials = await getStsCredentials(socket.handshake.auth.token);

    // Spawn the actual CLI entrypoint, unbuffered, passing env vars
    const PORT = process.env.PORT || 80;
    novaProcess = spawn("python3", ["nova_sonic.py"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        SOCKET_URL: `http://127.0.0.1:${PORT}`,
        SESSION_ID: config.session_id || "default",
        VOICE_ID: config.voice_id || "",
        USER_ID: socket.userId || "anonymous",
        AWS_ACCESS_KEY_ID: stsCredentials.AccessKeyId,
        AWS_SECRET_ACCESS_KEY: stsCredentials.SecretKey,
        AWS_SESSION_TOKEN: stsCredentials.SessionToken,
        SSL_VERIFY: "false",
        SM_DB_CREDENTIALS: process.env.SM_DB_CREDENTIALS || "",
        RDS_PROXY_ENDPOINT: process.env.RDS_PROXY_ENDPOINT || "",
        // ─ Patient simulation context for Nova Sonic ─
        PATIENT_NAME: config.patient_name || "",
        PATIENT_PROMPT: config.patient_prompt || "",
        PATIENT_ID: config.patient_id || "",
        LLM_COMPLETION: config.llm_completion ? "true" : "false",
        // Optional extra instructions to mirror chat.py system_prompt if needed
        EXTRA_SYSTEM_PROMPT: config.system_prompt || "",
        // AppSync configuration for empathy feedback
        APPSYNC_GRAPHQL_URL: process.env.APPSYNC_GRAPHQL_URL || "",
        COGNITO_TOKEN: socket.handshake.auth.token || "",
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
            // ─ Empathy feedback ──────────────────────────────────────────
            else if (parsed.type === "empathy") {
              console.log("🧠 EMPATHY FEEDBACK:", parsed.content?.substring(0, 100));
              socket.emit("empathy-feedback", { content: parsed.content });
            }
            // ─ Diagnosis completion ──────────────────────────────────────
            else if (parsed.type === "diagnosis_complete") {
              console.log("🎯 DIAGNOSIS COMPLETE:", parsed.text);
              socket.emit("diagnosis-complete", { message: parsed.text });
            }
            else if (parsed.type === "diagnosis_verdict") {
              console.log("🩺 DIAGNOSIS VERDICT:", parsed.verdict);
              if (parsed.verdict) {
                socket.emit("diagnosis-complete", { message: "Proper diagnosis achieved" });
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
            // Handle empathy feedback in plain text fallback
            if (line.includes("**Empathy Coach:**")) {
              socket.emit("empathy-feedback", { content: line });
            }
            // Handle diagnosis completion in plain text fallback
            if (line.includes("Proper diagnosis achieved")) {
              socket.emit("diagnosis-complete", { message: "Proper diagnosis achieved" });
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

  // ─── Text generation streaming ─────────────────────────────────────────────
  socket.on("text-generation", async (data) => {
    console.log("🚀 Text generation request:", data);

    try {
      const response = await fetch(
        `${process.env.TEXT_GENERATION_ENDPOINT}/student/text_generation?simulation_group_id=${data.simulation_group_id}&session_id=${data.session_id}&patient_id=${data.patient_id}&session_name=${data.session_name}&stream=true`,
        {
          method: "POST",
          headers: {
            Authorization: data.token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message_content: data.message }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const eventData = JSON.parse(line.slice(6));
              socket.emit("text-stream", eventData);
            } catch (e) {
              console.warn("Failed to parse SSE:", line);
            }
          }
        }
      }
    } catch (error) {
      console.error("Text generation error:", error);
      socket.emit("text-stream", {
        type: "error",
        content: "Failed to generate response",
      });
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
