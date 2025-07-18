# Voice Selection Feature for Nova Sonic

This document explains how to use the voice selection feature from the frontend.

## Available Voices

The Nova Sonic API supports the following voices:

- **Feminine voices**: "amy", "tiffany", "lupe"
- **Masculine voices**: "matthew", "carlos"

## How to Set the Voice from the Frontend

### When Starting a Nova Sonic Session

Pass the voice configuration when starting the Nova Sonic session:

```javascript
// Example in JavaScript
socket.emit("start-nova-sonic", { voice_id: "matthew" });
```

This will configure the voice before the session begins.

## Frontend Implementation Example

\*Note, the array of voices listed below contains all Nova Sonic voices as of July 18th, 2025. More voices may be available, and can be found here: https://docs.aws.amazon.com/nova/latest/userguide/available-voices.html

```javascript
// Example React component
function VirtualPatient() {
  const socket = useSocket(); // Your socket connection
  const [selectedVoice, setSelectedVoice] = useState("amy");

  const voices = {
    feminine: ["amy", "tiffany", "lupe", "greta", "beatrice", "ambre"],
    masculine: ["matthew", "carlos", "lennart", "lorenzo", "florian"],
  };

  const startSession = () => {
    socket.emit("start-nova-sonic", { voice_id: selectedVoice });
  };

  return (
    <div className="virtual-patient">
      <div className="voice-selector">
        <label>Select Patient Voice:</label>
        <select
          value={selectedVoice}
          onChange={(e) => setSelectedVoice(e.target.value)}
        >
          <optgroup label="Feminine Voices">
            {voices.feminine.map((voice) => (
              <option key={voice} value={voice}>
                {voice}
              </option>
            ))}
          </optgroup>
          <optgroup label="Masculine Voices">
            {voices.masculine.map((voice) => (
              <option key={voice} value={voice}>
                {voice}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <button onClick={startSession}>Start Session</button>
    </div>
  );
}
```
