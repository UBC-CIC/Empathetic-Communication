// PCM-compatible real-time microphone audio stream using AudioContext for Nova Sonic

import { socket } from "./socket";

let audioContext;
let processor;
let input;
let globalStream;
let novaStarted = false;
let analyser;
let dataArray;
let animationId;

// Scheduling playback variables
let playbackStartTime = 0;
const LEAD_TIME = 0.2; // schedule audio this far ahead (s)
const MAX_QUEUE_DURATION = 0.5; // maximum buffered ahead time (s)

/**
 * Start the Nova Sonic session and stream microphone audio.
 */
export function startSpokenLLM(voice_id = "matthew", setLoading) {
  if (novaStarted) {
    console.warn("🔁 Nova Sonic is already started.");
    return;
  }

  // Remove any existing listener, then wait for backend ready
  socket.off("nova-started");
  socket.once("nova-started", () => {
    console.log("✅ Nova backend ready!");
    novaStarted = true;
    socket.emit("start-audio");

    setTimeout(() => {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          console.log("🎧 Microphone access granted");
          globalStream = stream;
          input = audioContext.createMediaStreamSource(stream);
          // lower buffer size for reduced latency
          processor = audioContext.createScriptProcessor(1024, 1, 1);
          processor.onaudioprocess = (e) => {
            const pcm = convertFloat32ToInt16(e.inputBuffer.getChannelData(0));
            const base64 = btoa(String.fromCharCode.apply(null, pcm));
            socket.emit("audio-input", { data: base64 });
          };
          input.connect(processor);
          processor.connect(audioContext.destination);
          setLoading(false);
          console.log("🎤 Microphone connected and streaming");
        })
        .catch((err) => {
          setLoading(false);
          console.error("🎤 Microphone access denied:", err);
        });
    }, 500);
  });

  if (!socket.connected) {
    console.log("🔌 Connecting socket...");
    socket.connect();
  }
  console.log("🚀 Requesting Nova Sonic startup");
  socket.emit("start-nova-sonic", { voice_id });
}

/**
 * Stop the Nova Sonic session and clean up resources.
 */
export function stopSpokenLLM() {
  console.log("🛑 Stopping Nova Sonic voice stream...");
  socket.emit("end-audio");
  if (processor) {
    processor.disconnect();
    processor = null;
  }
  if (input) {
    input.disconnect();
    input = null;
  }
  if (globalStream) {
    globalStream.getTracks().forEach((t) => t.stop());
    globalStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  socket.off("nova-started");
  novaStarted = false;
  analyser = null;
  dataArray = null;
  cancelAnimationFrame(animationId);
  playbackStartTime = 0;
  console.log("🛑 Nova Sonic stopped");
}

/** Convert Float32 [-1,1] to 16-bit PCM */
function convertFloat32ToInt16(buffer) {
  const len = buffer.length;
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    let s = Math.max(-1, Math.min(1, buffer[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(out.buffer);
}

// Receive and schedule audio chunks
socket.on("audio-chunk", ({ data }) => {
  if (!audioContext) return;
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const samples = new Int16Array(bytes.buffer);
  const buffer = audioContext.createBuffer(1, samples.length, 24000);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    ch[i] = samples[i] / 0x8000;
  }
  scheduleBuffer(buffer);
});

function scheduleBuffer(buffer) {
  const src = audioContext.createBufferSource();
  src.buffer = buffer;
  src.connect(audioContext.destination);

  const now = audioContext.currentTime;
  if (playbackStartTime < now) playbackStartTime = now + LEAD_TIME;
  if (playbackStartTime - now > MAX_QUEUE_DURATION)
    playbackStartTime = now + LEAD_TIME;

  src.start(playbackStartTime);
  playbackStartTime += buffer.duration;
}

/**
 * Initialize waveform visualizer on given canvas.
 */
export function initWaveform(canvasId) {
  if (!audioContext) return;
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  dataArray = new Uint8Array(analyser.fftSize);

  function draw() {
    animationId = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(dataArray);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    const slice = canvas.width / dataArray.length;
    let x = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += slice;
    }
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  }
  draw();
}

// Expose a playAudio function for StudentChat.jsx to consume raw base64 chunks
export function playAudio(data) {
  if (!audioContext) return;
  try {
    // Decode base64 to Int16 PCM
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const samples = new Int16Array(bytes.buffer);
    // Create an AudioBuffer at 24kHz sample rate
    const buffer = audioContext.createBuffer(1, samples.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      channel[i] = samples[i] / 0x8000;
    }
    // Schedule playback
    scheduleBuffer(buffer);
  } catch (e) {
    console.error("🔊 playAudio failed:", e);
  }
}
