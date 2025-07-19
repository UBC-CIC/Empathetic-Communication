// PCM-compatible real-time microphone audio stream using AudioContext for Nova Sonic

import { socket } from "./socket";

let audioContext;
let processor;
let input;
let globalStream;
let novaStarted = false;
let novaStartListenerAttached = false;

export function startSpokenLLM(voice_id = "matthew") {
  if (novaStarted) {
    console.warn("🔁 Nova Sonic is already started.");
    return;
  }

  // Clean up any existing listeners to prevent duplicates
  socket.off("nova-started");

  // Use once instead of on to ensure the handler runs only once
  socket.once("nova-started", () => {
    if (novaStarted) return;
    console.log("✅ Nova backend ready!");
    novaStarted = true;
    socket.emit("start-audio");

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
            console.log("🎤 Sending audio data, length:", pcmData.length);
          };

          input.connect(processor);
          processor.connect(audioContext.destination);
          console.log("🎤 Microphone connected and streaming");
        })
        .catch((err) => {
          console.error("🎤 Microphone access denied:", err);
        });
    }, 500);
  });

  // Make sure socket is connected
  if (!socket.connected) {
    socket.connect();
  }

  console.log("🚀 Requesting Nova Sonic startup");
  socket.emit("start-nova-sonic", { voice_id: voice_id });
}

export function stopSpokenLLM() {
  console.log("🛑 Stopping Nova Sonic voice stream...");

  // First send the end-audio signal
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

  // Remove any lingering event listeners
  socket.off("nova-started");

  novaStarted = false;
  console.log("🛑 Stopped PCM voice stream");
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

    // Add the new chunk to our buffer
    audioBuffer.push(audioBytes);
    console.log(
      "🔊 Added audio chunk to buffer, current chunks:",
      audioBuffer.length
    );

    // Clear any existing timeout
    if (bufferTimeout) {
      clearTimeout(bufferTimeout);
    }

    // Wait for more chunks to arrive before playing
    // This is the key to smooth playback - collect more data before starting
    const bufferThreshold = 5; // Collect more chunks for smoother playback
    const initialDelay = 300; // Longer initial delay for better buffering

    if (!isPlaying) {
      bufferTimeout = setTimeout(playBufferedAudio, initialDelay);
    }

    // If we have enough chunks already, play immediately
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
  console.log("🔊 Playing buffered audio, chunks:", audioBuffer.length);

  try {
    // Combine all audio chunks
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

    // Create a single combined array
    const combinedArray = new Uint8Array(totalLength);
    let offset = 0;
    byteArrays.forEach((array) => {
      combinedArray.set(array, offset);
      offset += array.length;
    });

    // Create WAV header for 24kHz 16-bit mono audio
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    // "RIFF" chunk descriptor
    view.setUint8(0, "R".charCodeAt(0));
    view.setUint8(1, "I".charCodeAt(0));
    view.setUint8(2, "F".charCodeAt(0));
    view.setUint8(3, "F".charCodeAt(0));

    view.setUint32(4, 36 + combinedArray.length, true); // File size - 8

    // "WAVE" format
    view.setUint8(8, "W".charCodeAt(0));
    view.setUint8(9, "A".charCodeAt(0));
    view.setUint8(10, "V".charCodeAt(0));
    view.setUint8(11, "E".charCodeAt(0));

    // "fmt " subchunk
    view.setUint8(12, "f".charCodeAt(0));
    view.setUint8(13, "m".charCodeAt(0));
    view.setUint8(14, "t".charCodeAt(0));
    view.setUint8(15, " ".charCodeAt(0));

    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, 1, true); // NumChannels (1 for mono)
    view.setUint32(24, 24000, true); // SampleRate (24kHz)
    view.setUint32(28, 24000 * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
    view.setUint16(32, 2, true); // BlockAlign (NumChannels * BitsPerSample/8)
    view.setUint16(34, 16, true); // BitsPerSample (16 bits)

    // "data" subchunk
    view.setUint8(36, "d".charCodeAt(0));
    view.setUint8(37, "a".charCodeAt(0));
    view.setUint8(38, "t".charCodeAt(0));
    view.setUint8(39, "a".charCodeAt(0));

    view.setUint32(40, combinedArray.length, true); // Subchunk2Size

    // Combine header and audio data
    const wavBlob = new Blob([wavHeader, combinedArray], { type: "audio/wav" });

    // Create audio element and play
    const audio = new Audio();
    audio.src = URL.createObjectURL(wavBlob);
    audio.volume = 1.0; // Ensure volume is at maximum

    // Store the current buffer for potential reuse
    const currentBuffer = [...audioBuffer];
    // Clear the buffer for new incoming chunks
    audioBuffer = [];

    audio.onloadedmetadata = () => {
      console.log("🔊 Audio metadata loaded, duration:", audio.duration);
    };

    audio.onplay = () => {
      console.log("🔊 Audio playback started");
    };

    audio.onended = () => {
      console.log("🔊 Audio playback completed");
      URL.revokeObjectURL(audio.src);
      isPlaying = false;

      // Check if new chunks arrived during playback
      if (audioBuffer.length >= 3) {
        setTimeout(playBufferedAudio, 50);
      } else if (audioBuffer.length > 0) {
        // Wait a bit longer for more chunks if we don't have enough
        setTimeout(playBufferedAudio, 200);
      }
    };

    audio.onerror = (e) => {
      console.error("🔊 Audio playback error:", e);
      isPlaying = false;
    };

    // Play the audio
    audio.play().catch((err) => {
      console.error("🔊 Failed to play audio:", err);
      isPlaying = false;
    });
  } catch (error) {
    console.error("🔊 Audio buffer processing failed:", error);
    isPlaying = false;
    audioBuffer = []; // Clear the buffer on error
  }
}