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
    
    audioStarted = false;

    // Kill any previous process
    if (novaProcess) {
      novaProcess.kill();
      novaProcess = null;
    }
    novaReady = false;

    // Get Cognito Identity Pool credentials for user-specific access
    console.log("🔑 Getting Cognito Identity Pool credentials for user:", socket.userEmail);
    let stsCredentials;
    try {
      stsCredentials = await getStsCredentials(socket.handshake.auth.token);
      console.log("✅ Successfully obtained Cognito Identity Pool credentials");
    } catch (error) {
      console.error("❌ Failed to get Cognito credentials:", error.message);
      socket.emit("nova-error", { error: "Failed to authenticate with AWS services" });
      return;
    }

    const PORT = process.env.PORT || 80;
    
    // Try python3 first, then python if that fails
    const pythonCmd = process.env.PYTHON_CMD || "python3";
    console.log(`🐍 PYTHON_CMD env var: ${process.env.PYTHON_CMD}`);
    console.log(`🐍 Using command: ${pythonCmd}`);
    console.log(`🐍 Attempting to spawn: ${pythonCmd} nova_sonic.py`);
    
    try {
      novaProcess = spawn(pythonCmd, ["nova_sonic.py"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          SESSION_ID: config.session_id || "default",
          VOICE_ID: config.voice_id || "",
          USER_ID: socket.userId || "anonymous",
          AWS_ACCESS_KEY_ID: stsCredentials.AccessKeyId,
          AWS_SECRET_ACCESS_KEY: stsCredentials.SecretKey,
          AWS_SESSION_TOKEN: stsCredentials.SessionToken,
          SM_DB_CREDENTIALS: process.env.SM_DB_CREDENTIALS || "",
          RDS_PROXY_ENDPOINT: process.env.RDS_PROXY_ENDPOINT || "",
          PATIENT_NAME: config.patient_name || "",
          PATIENT_PROMPT: config.patient_prompt || "",
          PATIENT_ID: config.patient_id || "",
          LLM_COMPLETION: config.llm_completion ? "true" : "false",
          EXTRA_SYSTEM_PROMPT: config.system_prompt || "",
          APPSYNC_GRAPHQL_URL: process.env.APPSYNC_GRAPHQL_URL || "",
          COGNITO_TOKEN: socket.handshake.auth.token || "",
        },
      });
      console.log("📡 Nova process spawned with PID:", novaProcess.pid);
    } catch (error) {
      console.error("❌ Failed to spawn Nova process:", error.message);
      socket.emit("nova-error", { error: "Failed to start voice system" });
      return;
    }

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
              // Skip debug file saving for better performance
              socket.emit("audio-chunk", { data: parsed.data });
            }
            // ─ Debug messages ───────────────────────────────────────────
            else if (parsed.type === "debug") {
              console.log("🐞 NOVA DEBUG:", parsed.text);
            }
            // ─ Voice empathy evaluation results ──────────────────────────
            else if (parsed.type === "voice_empathy_result") {
              console.log("🎤 VOICE EMPATHY RESULT:", parsed.content?.substring(0, 100));
              socket.emit("voice-empathy-result", { content: parsed.content });
            }
            // ─ Text messages ─────────────────────────────────────────────
            else if (parsed.type === "text") {
              console.log("💬 NOVA TEXT:", parsed.text);
              socket.emit("text-message", { text: parsed.text });
              if (parsed.text.includes("Nova Sonic ready")) {
                novaReady = true;
                console.log("✅ NOVA SONIC READY - Voice empathy evaluation enabled");
                socket.emit("nova-started", {
                  status: "Nova Sonic session started",
                });
              }
            }
            // ─ Empathy feedback ──────────────────────────────────────────
            else if (parsed.type === "empathy") {
              console.log("🧠 VOICE EMPATHY FEEDBACK:", parsed.content?.substring(0, 100));
              socket.emit("empathy-feedback", { content: parsed.content });
            }
            // ─ Raw empathy data for frontend processing ──────────────────────────────────────────
            else if (parsed.type === "empathy_data") {
              console.log("🧠 RAW VOICE EMPATHY DATA RECEIVED:", parsed.content?.substring(0, 100));
              try {
                const empathyData = JSON.parse(parsed.content);
                console.log("🧠 PARSED EMPATHY DATA:", {
                  empathy_score: empathyData.empathy_score,
                  perspective_taking: empathyData.perspective_taking,
                  emotional_resonance: empathyData.emotional_resonance
                });
                
                // Transform to match StudentChat format with voice indicator
                const transformedData = {
                  overall_score: empathyData.empathy_score || 3,
                  avg_perspective_taking: empathyData.perspective_taking || 3,
                  avg_emotional_resonance: empathyData.emotional_resonance || 3,
                  avg_acknowledgment: empathyData.acknowledgment || 3,
                  avg_language_communication: empathyData.language_communication || 3,
                  avg_cognitive_empathy: empathyData.cognitive_empathy || 3,
                  avg_affective_empathy: empathyData.affective_empathy || 3,
                  realism_assessment: empathyData.realism_flag === "realistic" ? "Your voice responses are generally realistic" : "Your voice response is unrealistic",
                  realism_explanation: empathyData.judge_reasoning?.realism_justification || "",
                  coach_assessment: empathyData.judge_reasoning?.overall_assessment || "",
                  strengths: empathyData.feedback?.strengths || [],
                  areas_for_improvement: empathyData.feedback?.areas_for_improvement || [],
                  recommendations: empathyData.feedback?.improvement_suggestions || [],
                  recommended_approach: empathyData.feedback?.alternative_phrasing || "",
                  timestamp: Date.now(),
                  source: "voice", // Mark as voice-generated empathy data
                };
                console.log("🧠 SENDING VOICE EMPATHY DATA TO FRONTEND - Score:", transformedData.overall_score);
                socket.emit("empathy-data", transformedData);
              } catch (e) {
                console.error("❌ Failed to parse voice empathy data:", e);
                console.error("❌ Raw empathy content:", parsed.content);
              }
            }
            // ─ Diagnosis completion ──────────────────────────────────────
            else if (parsed.type === "diagnosis_complete") {
              console.log("🎯 DIAGNOSIS COMPLETE:", parsed.text);
              socket.emit("diagnosis-complete", { message: parsed.text });
            }
            else if (parsed.type === "diagnosis_verdict") {
              console.log("🩺 DIAGNOSIS VERDICT:", parsed.verdict);
              if (parsed.verdict) {
                socket.emit("diagnosis-complete", { message: "Session completed successfully" });
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
            if (line.includes("**Empathy Coach:**") || line.includes("**🎤 Voice Empathy Coach:**")) {
              socket.emit("empathy-feedback", { content: line });
            }
            // Forward voice transcriptions to text chat for empathy evaluation
            if (line.includes("User:") || line.includes("Assistant:")) {
              console.log("📝 FORWARDING VOICE TEXT:", line.substring(0, 50));
              socket.emit("text-message", { text: line });
            }
            // Handle empathy evaluation status updates
            if (line.includes("MANUAL EMPATHY:") || line.includes("🧠") || line.includes("VOICE EMPATHY:")) {
              console.log("🧠 EMPATHY STATUS:", line);
              // Forward empathy status to frontend for debugging
              socket.emit("empathy-status", { message: line, timestamp: Date.now() });
            }
            // Handle diagnosis completion in plain text fallback
            if (line.includes("SESSION COMPLETED")) {
              socket.emit("diagnosis-complete", { message: "Session completed successfully" });
            }
          }
        });
    });

    novaProcess.stderr.on("data", (data) => {
      const stderrText = data.toString().trim();
      console.warn("⚠️ Nova stderr:", stderrText);
      
      // Forward important stderr messages to frontend for debugging
      if (stderrText.includes("EMPATHY") || stderrText.includes("🧠") || stderrText.includes("ERROR")) {
        socket.emit("nova-debug", { 
          type: "stderr", 
          message: stderrText,
          timestamp: Date.now()
        });
      }
    });

    novaProcess.on("error", (error) => {
      console.error("❌ Nova process error:", error.message);
      console.error("❌ Nova process error details:", error);
      
      // Send error details to frontend
      socket.emit("nova-error", { 
        error: error.message,
        code: error.code,
        details: error.toString()
      });
      
      if (error.code === "ENOENT") {
        console.log("🐍 Trying 'python' instead of 'python3'");
        // Retry with 'python' command
        try {
          novaProcess = spawn("python", ["nova_sonic.py"], {
            stdio: ["pipe", "pipe", "pipe"],
            env: {
              ...process.env,
              SESSION_ID: config.session_id || "default",
              VOICE_ID: config.voice_id || "",
              USER_ID: socket.userId || "anonymous",
              AWS_ACCESS_KEY_ID: stsCredentials.AccessKeyId,
              AWS_SECRET_ACCESS_KEY: stsCredentials.SecretKey,
              AWS_SESSION_TOKEN: stsCredentials.SessionToken,
              SM_DB_CREDENTIALS: process.env.SM_DB_CREDENTIALS || "",
              RDS_PROXY_ENDPOINT: process.env.RDS_PROXY_ENDPOINT || "",
              PATIENT_NAME: config.patient_name || "",
              PATIENT_PROMPT: config.patient_prompt || "",
              PATIENT_ID: config.patient_id || "",
              LLM_COMPLETION: config.llm_completion ? "true" : "false",
              EXTRA_SYSTEM_PROMPT: config.system_prompt || "",
              APPSYNC_GRAPHQL_URL: process.env.APPSYNC_GRAPHQL_URL || "",
              COGNITO_TOKEN: socket.handshake.auth.token || "",
            },
          });
          console.log("📡 Nova process spawned with 'python', PID:", novaProcess.pid);
        } catch (retryError) {
          console.error("❌ Failed to spawn with 'python' too:", retryError.message);
          socket.emit("nova-error", { error: "Python not found" });
        }
      } else {
        socket.emit("nova-error", { error: error.message });
      }
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

  // ─── Voice transcription for manual empathy evaluation ──────────────────
  socket.on("voice-transcription", (data) => {
    console.log("🎤 VOICE TRANSCRIPTION: Received for empathy evaluation:", data.text?.substring(0, 50));
    console.log("🎤 VOICE TRANSCRIPTION: Session ID:", data.session_id);
    console.log("🎤 VOICE TRANSCRIPTION: Nova ready:", novaReady);
    console.log("🎤 VOICE TRANSCRIPTION: Nova process exists:", !!novaProcess);
    console.log("🎤 VOICE TRANSCRIPTION: Stdin writable:", novaProcess?.stdin?.writable);
    
    if (novaProcess && novaProcess.stdin.writable && novaReady) {
      try {
        // Send transcription to Nova Sonic for empathy evaluation
        const message = {
          type: "evaluate_empathy",
          text: data.text,
          session_id: data.session_id || "default"
        };
        
        console.log("🎤 VOICE TRANSCRIPTION: Sending message to Nova:", JSON.stringify(message).substring(0, 100));
        novaProcess.stdin.write(JSON.stringify(message) + "\n");
        console.log("✅ VOICE TRANSCRIPTION: Successfully sent to Nova for empathy evaluation");
        
        // Also emit confirmation to frontend
        socket.emit("transcription-received", { 
          status: "processing", 
          text: data.text?.substring(0, 50) + "..."
        });
        
      } catch (error) {
        console.error("❌ VOICE TRANSCRIPTION: Error sending to Nova:", error);
        socket.emit("transcription-error", { error: error.message });
      }
    } else {
      console.log("❌ VOICE TRANSCRIPTION: Cannot send - Nova not ready or stdin not writable");
      console.log("   - Nova process:", !!novaProcess);
      console.log("   - Stdin writable:", novaProcess?.stdin?.writable);
      console.log("   - Nova ready:", novaReady);
      
      socket.emit("transcription-error", { 
        error: "Voice system not ready",
        details: {
          novaProcess: !!novaProcess,
          stdinWritable: novaProcess?.stdin?.writable,
          novaReady: novaReady
        }
      });
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
