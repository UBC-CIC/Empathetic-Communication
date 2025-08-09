// PCM-compatible real-time microphone audio stream using AudioContext for Nova Sonic

import { getSocket } from "./socket";

let audioContext;
let processor;
let input;
let globalStream;
let novaStarted = false;
let analyser;
let dataArray;
let animationId;
let novaStartListenerAttached = false;

// Track last playback to allow immediate stop
let lastAudio = null;
let lastAudioCtx = null;


export async function startSpokenLLM(
  voice_id = "matthew",
  setLoading,
  session_id
) {

  if (novaStarted) {
    console.warn("🔁 Nova Sonic is already started.");
    return;
  }

  const socket = await getSocket();

  // Clean up any existing listeners to prevent duplicates
  socket.off("nova-started");

  // Use once instead of on to ensure the handler runs only once
  socket.once("nova-started", () => {
    if (novaStarted) return;
    console.log("✅ Nova backend ready!");
    novaStarted = true;

    // Set a small delay to ensure the start-audio is processed
    setTimeout(() => {
      const bufferSize = 4096;
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });

      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          globalStream = stream;
          input = audioContext.createMediaStreamSource(stream);
          processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

          processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = convertFloat32ToInt16(inputData);
            const base64 = btoa(String.fromCharCode.apply(null, pcmData));
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
    socket.connect();
  }

  console.log("🚀 Requesting Nova Sonic startup");
  socket.emit("start-nova-sonic", {
    voice_id: voice_id,
    session_id: session_id || "default",
  });
}

export async function stopSpokenLLM() {
  console.log("🛑 Stopping Nova Sonic voice stream...");

  const socket = await getSocket();
  socket.emit("end-audio");

  // Then clean up audio resources
  if (processor) {
    try {
      processor.disconnect();
      console.log("✅ Processor disconnected");
    } catch (e) {
      console.error("❌ Error disconnecting processor:", e);
    }
    processor = null;
  }

  if (input) {
    try {
      input.disconnect();
      console.log("✅ Input disconnected");
    } catch (e) {
      console.error("❌ Error disconnecting input:", e);
    }
    input = null;
  }

  if (globalStream) {
    try {
      globalStream.getTracks().forEach((track) => {
        track.stop();
        console.log("✅ Audio track stopped");
      });
    } catch (e) {
      console.error("❌ Error stopping audio tracks:", e);
    }
    globalStream = null;
  }

  if (audioContext) {
    try {
      audioContext.close();
      console.log("✅ Audio context closed");
    } catch (e) {
      console.error("❌ Error closing audio context:", e);
    }
    audioContext = null;
  }

  const socketRef = await getSocket();
  socketRef.off("nova-started");

  novaStarted = false;
  console.log("🛑 Stopped PCM voice stream");
}

export function stopAudioPlayback() {
  try {
    // Cancel visualizer animation
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    // Stop any currently playing audio element
    if (lastAudio) {
      try {
        lastAudio.pause();
        lastAudio.src && URL.revokeObjectURL(lastAudio.src);
      } catch (e) {
        console.error("❌ Error stopping audio element:", e);
      }
      lastAudio = null;
    }

    // Close the last audio context used for playback
    if (lastAudioCtx && typeof lastAudioCtx.close === "function") {
      lastAudioCtx.close().catch(() => {});
      lastAudioCtx = null;
    }

    // Reset playback buffer state
    isPlaying = false;
    audioBuffer = [];

    console.log("🔇 Audio playback stopped");
  } catch (e) {
    console.error("❌ Failed to stop audio playback:", e);
  }
}

function convertFloat32ToInt16(buffer) {
  const l = buffer.length;
  const buf = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    let s = Math.max(-1, Math.min(1, buffer[i]));
    buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(buf.buffer);
}

// Audio buffer to collect chunks before playing
let audioBuffer = [];
let isPlaying = false;
let bufferTimeout = null;

export function playAudio(audioBytes) {
  try {
    if (!audioBytes || audioBytes.length === 0) {
      console.error("🔊 Empty audio data received");
      return;
    }

    audioBuffer.push(audioBytes);
    console.log(
      "🔊 Added audio chunk to buffer, current chunks:",
      audioBuffer.length
    );

    if (bufferTimeout) {
      clearTimeout(bufferTimeout);
    }

    const bufferThreshold = 5;
    const initialDelay = 300;

    if (!isPlaying) {
      bufferTimeout = setTimeout(playBufferedAudio, initialDelay);
    }

    if (audioBuffer.length >= bufferThreshold && !isPlaying) {
      clearTimeout(bufferTimeout);
      playBufferedAudio();
    }
  } catch (error) {
    console.error("🔊 Audio processing failed:", error);
  }
}

function playBufferedAudio() {
  if (audioBuffer.length === 0 || isPlaying) return;

  isPlaying = true;

  try {
    let totalLength = 0;
    const byteArrays = audioBuffer.map((chunk) => {
      const byteChars = atob(chunk);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        bytes[i] = byteChars.charCodeAt(i);
      }
      totalLength += bytes.length;
      return bytes;
    });

    const combinedArray = new Uint8Array(totalLength);
    let offset = 0;
    byteArrays.forEach((array) => {
      combinedArray.set(array, offset);
      offset += array.length;
    });

    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    view.setUint8(0, "R".charCodeAt(0));
    view.setUint8(1, "I".charCodeAt(0));
    view.setUint8(2, "F".charCodeAt(0));
    view.setUint8(3, "F".charCodeAt(0));
    view.setUint32(4, 36 + combinedArray.length, true);
    view.setUint8(8, "W".charCodeAt(0));
    view.setUint8(9, "A".charCodeAt(0));
    view.setUint8(10, "V".charCodeAt(0));
    view.setUint8(11, "E".charCodeAt(0));
    view.setUint8(12, "f".charCodeAt(0));
    view.setUint8(13, "m".charCodeAt(0));
    view.setUint8(14, "t".charCodeAt(0));
    view.setUint8(15, " ".charCodeAt(0));
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true);
    view.setUint32(28, 24000 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint8(36, "d".charCodeAt(0));
    view.setUint8(37, "a".charCodeAt(0));
    view.setUint8(38, "t".charCodeAt(0));
    view.setUint8(39, "a".charCodeAt(0));
    view.setUint32(40, combinedArray.length, true);

    const wavBlob = new Blob([wavHeader, combinedArray], { type: "audio/wav" });
    const audio = new Audio();
    audio.src = URL.createObjectURL(wavBlob);
    audio.volume = 1.0;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaElementSource(audio);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    const bufferLength = analyser.fftSize;
    dataArray = new Uint8Array(bufferLength);

    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    startWaveformVisualizer(bufferLength);

    // Save refs for immediate stop later
    lastAudio = audio;
    lastAudioCtx = audioCtx;

    audioBuffer = [];

    audio.onloadedmetadata = () => {
      console.log("🔊 Audio metadata loaded, duration:", audio.duration);
    };

    audio.onended = () => {
      URL.revokeObjectURL(audio.src);
      isPlaying = false;

      if (audioBuffer.length >= 3) {
        setTimeout(playBufferedAudio, 50);
      } else if (audioBuffer.length > 0) {
        setTimeout(playBufferedAudio, 200);
      }
    };

    audio.onerror = (e) => {
      console.error("🔊 Audio playback error:", e);
      isPlaying = false;
    };

    audio.play().catch((err) => {
      console.error("🔊 Failed to play audio:", err);
      isPlaying = false;
    });
  } catch (error) {
    console.error("🔊 Audio buffer processing failed:", error);
    isPlaying = false;
    audioBuffer = [];
  }

  function startWaveformVisualizer(bufferLength) {
    const canvas = document.getElementById("audio-visualizer");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    const baseRadius = Math.min(cx, cy) * 0.6;
    const amplitude = Math.min(cx, cy) * 1.5;
    const smoothing = 0.1;
    const smoothed = new Float32Array(bufferLength).fill(baseRadius);

    function draw() {
      animationId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.beginPath();

      const step = 8;
      const avgRange = 4;
      const amplitude = 140;
      const smoothing = 0.1;

      const getAveragedValue = (i, range = avgRange) => {
        let sum = 0;
        let count = 0;
        for (let j = i - range; j <= i + range; j++) {
          if (j >= 0 && j < bufferLength) {
            sum += dataArray[j];
            count++;
          }
        }
        return sum / count;
      };

      for (let i = 0; i < bufferLength; i += step) {
        const v = getAveragedValue(i) / 255;
        const targetR = baseRadius + (v - 0.5) * amplitude * 2;
        smoothed[i] += (targetR - smoothed[i]) * smoothing;

        const angle = (i / bufferLength) * Math.PI * 2;
        const x = cx + smoothed[i] * Math.cos(angle);
        const y = cy + smoothed[i] * Math.sin(angle);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.closePath();
      ctx.fillStyle = "rgba(0, 255, 180, 0.8)";
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 255, 180, 0.8)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    draw();
  }
}
