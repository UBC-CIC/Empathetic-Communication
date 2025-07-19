import { useEffect, useRef } from "react";
import Wave from "@foobar404/wave";

const NovaVisualizer = ({ audio }) => {
  const canvasRef = useRef(null);
  const waveInstance = useRef(null);

  useEffect(() => {
    if (!audio || !canvasRef.current) return;

    const wave = new Wave();
    waveInstance.current = wave;

    wave.fromElement(audio, canvasRef.current, {
      type: "bars",
      colors: ["#3b82f6", "#93c5fd"],
      stroke: 0,
      volume: 1,
      frequency: 0.7,
    });

    return () => {
      wave.stop();
    };
  }, [audio]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={120}
      style={{
        maxWidth: "90%",
        borderRadius: "10px",
        marginBottom: "1rem",
      }}
    />
  );
};

export default NovaVisualizer;
