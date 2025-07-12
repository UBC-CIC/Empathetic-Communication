import asyncio
import json
import sys
import boto3

async def main():
    print(json.dumps({"type": "text", "text": "Nova Sonic ready! Ask me anything."}), flush=True)
    
    # Simple echo for testing
    while True:
        try:
            line = await asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline)
            if not line:
                break
                
            data = json.loads(line.strip())
            if data['type'] == 'text':
                # Echo back the text
                response = f"I heard you say: {data['data']}"
                print(json.dumps({"type": "text", "text": response}), flush=True)
            elif data['type'] == 'audio':
                # Respond to audio input
                response = "I heard your voice!"
                print(json.dumps({"type": "text", "text": response}), flush=True)
            elif data['type'] == 'end_audio':
                # Process audio and respond
                response = "Thanks for speaking!"
                print(json.dumps({"type": "text", "text": response}), flush=True)
                # Generate a simple beep sound (440Hz sine wave)
                import wave
                import struct
                import math
                import io
                
                sample_rate = 24000
                duration = 0.5
                frequency = 440
                
                frames = []
                for i in range(int(sample_rate * duration)):
                    value = int(32767 * math.sin(2 * math.pi * frequency * i / sample_rate))
                    frames.append(struct.pack('<h', value))
                
                # Create WAV in memory
                wav_buffer = io.BytesIO()
                with wave.open(wav_buffer, 'wb') as wav_file:
                    wav_file.setnchannels(1)
                    wav_file.setsampwidth(2)
                    wav_file.setframerate(sample_rate)
                    wav_file.writeframes(b''.join(frames))
                
                import base64
                audio_data = base64.b64encode(wav_buffer.getvalue()).decode('utf-8')
                print(json.dumps({"type": "audio", "data": audio_data}), flush=True)
                
        except Exception as e:
            print(json.dumps({"type": "error", "text": str(e)}), flush=True)

if __name__ == "__main__":
    asyncio.run(main())