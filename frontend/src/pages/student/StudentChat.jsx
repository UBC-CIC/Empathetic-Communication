import { useEffect, useRef, useState } from "react";
import AIMessage from "../../components/AIMessage";
import Session from "../../components/Session";
import StudentMessage from "../../components/StudentMessage";
import VoiceConversation from "../../components/VoiceConversation";
import { fetchAuthSession } from "aws-amplify/auth";
import { useNavigate } from "react-router-dom";
import { fetchUserAttributes } from "aws-amplify/auth";
import DraggableNotes from "./DraggableNotes";
import FilesPopout from "./FilesPopout";
import EmpathyCoachSummary from "../../components/EmpathyCoachSummary";
import { getSocket } from "../../utils/socket";
import NovaVisualizer from "../../components/NovaVisualizer";
import {
  startSpokenLLM,
  stopSpokenLLM,
  playAudio,
  stopAudioPlayback,
} from "../../utils/voiceStream";

import { signOut } from "aws-amplify/auth";

import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Button,
  Typography,
} from "@mui/material";

// Importing icons
import DescriptionIcon from "@mui/icons-material/Description";
import InfoIcon from "@mui/icons-material/Info";
import KeyIcon from "@mui/icons-material/Key";
import MicIcon from "@mui/icons-material/Mic";
import CloseIcon from "@mui/icons-material/Close";
import PsychologyIcon from "@mui/icons-material/Psychology";

import RecordVoiceOverIcon from "@mui/icons-material/RecordVoiceOver";

// Add Amplify GraphQL client for AppSync streaming
import { generateClient } from "aws-amplify/api";
const gqlClient = generateClient();

// AppSync subscription for streaming text
const ON_TEXT_STREAM = /* GraphQL */ `
  subscription OnTextStream($sessionId: String!) {
    onTextStream(sessionId: $sessionId) {
      sessionId
      data
    }
  }
`;

// Importing l-mirage animation
import { mirage } from "ldrs";
mirage.register();

// Temporary ID used for the streaming bubble
const STREAMING_TEMP_ID = "STREAMING_TEMP_ID";

// TypingIndicator using l-mirage
const TypingIndicator = ({ patientName }) => (
  <div className="flex items-center justify-center py-4">
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-4 flex items-center space-x-3">
      <l-mirage size="24" speed="2.5" color="#10b981"></l-mirage>
      <span className="text-gray-600 font-medium text-sm">
        {patientName ? `${titleCase(patientName)} is typing...` : "Typing..."}
      </span>
    </div>
  </div>
);

function titleCase(str) {
  if (typeof str !== "string") {
    return str;
  }
  return str
    .split(" ")
    .map(function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1); // Capitalize only the first letter, leave the rest of the word unchanged
    })
    .join(" ");
}

const StudentChat = ({ group, patient, setPatient, setGroup }) => {
  const textareaRef = useRef(null);
  const messagesEndRef = useRef(null);
  const audioRef = useRef(null);
  const [novaStarted, setNovaStarted] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [showVoiceOverlay, setShowVoiceOverlay] = useState(false);
  const [micStartPos, setMicStartPos] = useState(null);
  const micRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [novaTextInput, setNovaTextInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [newMessage, setNewMessage] = useState(null);
  const [isAItyping, setIsAItyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isPatientInfoOpen, setIsPatientInfoOpen] = useState(false);
  const [isAnswerKeyOpen, setIsAnswerKeyOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isEmpathyCoachOpen, setIsEmpathyCoachOpen] = useState(false);
  const [empathySummary, setEmpathySummary] = useState(null);
  const [isEmpathyLoading, setIsEmpathyLoading] = useState(false);

  const [patientInfoFiles, setPatientInfoFiles] = useState([]);
  const [isInfoLoading, setIsInfoLoading] = useState(false);
  const [answerKeyFiles, setAnswerKeyFiles] = useState([]);
  const [isAnswerLoading, setIsAnswerLoading] = useState(false);
  const [profilePicture, setProfilePicture] = useState(null);

  // Real-time empathy chunks from AppSync stream
  const [realtimeEmpathy, setRealtimeEmpathy] = useState([]);

  // Remove global AppSync subscription approach; we'll subscribe per request
  // const streamSubRef = useRef(null);


  const navigate = useNavigate();

  // Sidebar resizing logic
  const [sidebarWidth, setSidebarWidth] = useState(280);

  const handleMouseMove = (e) => {
    const newWidth = e.clientX; // Get the new width based on the mouse position
    if (newWidth >= 115 && newWidth <= 400) {
      // Limit resizing between 100px and 400px
      setSidebarWidth(newWidth);
    }
  };

  const stopResizing = () => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", stopResizing);
  };

  const startResizing = (e) => {
    e.preventDefault(); // Prevent default behavior
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", stopResizing);
  };

  // Handle nova-started event once
  useEffect(() => {
    const setupSocket = async () => {
      const socket = await getSocket();
      socket.off("nova-started");
      socket.on("nova-started", () => {
        console.log("✅ Nova backend ready in StudentChat!");
        setNovaStarted(true);
      });
    };
    setupSocket();
  }, []);

  useEffect(() => {
    if (
      !loading &&
      !creatingSession &&
      !isSubmitting &&
      !isAItyping &&
      sessions.length === 0
    ) {
      setCreatingSession(true);
      handleNewChat();
    }
  }, [sessions, creatingSession]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (newMessage !== null) {
      if (currentSessionId === session?.session_id) {
        // Enhanced duplicate detection
        const contentKey = `${
          newMessage.student_sent ? "student" : "ai"
        }-${newMessage.message_content.trim()}`;

        // Check if this message already exists in the messages array to prevent duplication
        const messageExists = messages.some(
          (msg) =>
            msg.message_id === newMessage.message_id ||
            `${
              msg.student_sent ? "student" : "ai"
            }-${msg.message_content.trim()}` === contentKey
        );

        if (!messageExists) {
          // Only add the message if it doesn't already exist
          setMessages((prevItems) => {
            // Double-check for duplicates again to be extra safe
            const isDuplicate = prevItems.some(
              (msg) =>
                msg.message_id === newMessage.message_id ||
                `${
                  msg.student_sent ? "student" : "ai"
                }-${msg.message_content.trim()}` === contentKey
            );

            if (isDuplicate) {
              console.log("Prevented duplicate message from being added");
              return prevItems;
            } else {
              console.log("Adding new message to chat");
              return [...prevItems, newMessage];
            }
          });
        } else {
          console.log("Message already exists in chat, not adding duplicate");
        }
      }
      setNewMessage(null);
    }
  }, [session, newMessage, currentSessionId, messages]);

  useEffect(() => {
    const fetchPatient = async () => {
      setLoading(true);
      if (!group || !patient) {
        return;
      }

      try {
        const session = await fetchAuthSession();
        const { email } = await fetchUserAttributes();
        const token = session.tokens.idToken;
        const response = await fetch(
          `${
            import.meta.env.VITE_API_ENDPOINT
          }student/patient?email=${encodeURIComponent(
            email
          )}&simulation_group_id=${encodeURIComponent(
            group.simulation_group_id
          )}&patient_id=${encodeURIComponent(patient.patient_id)}`,
          {
            method: "GET",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );
        if (response.ok) {
          const data = await response.json();
          setSessions(data);
          const latestSession = data[data.length - 1];
          setSession(latestSession);
          if (latestSession) {
            setCurrentSessionId(latestSession.session_id);
          }
        } else {
          console.error("Failed to fetch patient:", response.statusText);
        }
      } catch (error) {
        console.error("Error fetching patient:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchPatient();
  }, [group, patient]);

  const getMostRecentStudentMessageIndex = () => {
    const studentMessages = messages
      .map((message, index) => ({ ...message, index }))
      .filter((message) => message.student_sent);
    return studentMessages.length > 0
      ? studentMessages[studentMessages.length - 1].index
      : -1;
  };

  const hasAiMessageAfter = (messages, recentStudentMessageIndex) => {
    return messages
      .slice(recentStudentMessageIndex + 1)
      .some((message) => !message.student_sent);
  };

  const fetchVoiceID = async () => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken;
      const response = await fetch(
        `${
          import.meta.env.VITE_API_ENDPOINT
        }student/patient_voice_id?patient_id=${encodeURIComponent(
          patient.patient_id
        )}`,
        {
          method: "GET",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        return data.voice_id;
      } else {
        console.warn(
          "Failed to fetch voice ID, defaulting to tiffany:",
          response.statusText
        );
        return "tiffany";
      }
    } catch (error) {
      console.warn("Error fetching voice ID, defaulting to tiffany:", error);
      return "tiffany";
    }
  };

  useEffect(() => {
    const setupSocketListeners = async () => {
      const socket = await getSocket();
      if (!socket.connected) socket.connect();

      const handleConnect = () => {
        console.log("✅ WebSocket connected:", socket.id);
      };

      const handleDisconnect = () => {
        console.log("❌ WebSocket disconnected");
      };

      const handleError = (error) => {
        console.error("🔥 WebSocket connection error:", error);
      };

      const handleText = (data) => {
        console.log("💬 Nova Sonic:", data.text);
      };

      const handleAudio = (data) => {
        console.log("🎵 Received audio chunk, length:", data.data?.length || 0);
        if (data.data) {
          console.log("🔊 Playing audio from StudentChat");
          playAudio(data.data);
        }
      };

      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");
      socket.off("text-message");
      socket.off("audio-chunk");

      socket.on("connect", handleConnect);
      socket.on("disconnect", handleDisconnect);
      socket.on("connect_error", handleError);
      socket.on("text-message", handleText);
      socket.on("audio-chunk", handleAudio);
    };
    setupSocketListeners();
  }, []);

  async function playNovaPcmBase64Audio(base64Data) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)(
      { sampleRate: 24000 }
    ); // Nova uses 24kHz output

    const rawData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
    const audioBuffer = audioContext.createBuffer(1, rawData.length / 2, 24000); // mono, 16-bit = 2 bytes/sample

    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < channelData.length; i++) {
      const sample = (rawData[i * 2 + 1] << 8) | rawData[i * 2]; // Little-endian
      channelData[i] =
        sample > 32767 ? (sample - 65536) / 32768 : sample / 32768;
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start();
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

  // Send text to Nova Sonic
  async function sendTextToNova() {
    if (novaTextInput.trim()) {
      console.log("📝 Sending text to Nova:", novaTextInput);
      const socket = await getSocket();
      socket.emit("text-input", { text: novaTextInput });
      setNovaTextInput("");
    }
  }

  const fetchFiles = async () => {
    setIsInfoLoading(true);
    setIsAnswerLoading(true);
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken;

      const response = await fetch(
        `${
          import.meta.env.VITE_API_ENDPOINT
        }student/get_all_files?simulation_group_id=${encodeURIComponent(
          group.simulation_group_id
        )}&patient_id=${encodeURIComponent(
          patient.patient_id
        )}&patient_name=${encodeURIComponent(patient.patient_name)}`,
        {
          method: "GET",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        console.log("Simulation group data:", data);
        const infoFiles = Object.entries(data.info_files).map(
          ([fileName, fileDetails]) => ({
            name: fileName,
            url: fileDetails.url,
            type: fileName.split(".").pop().toLowerCase(),
            metadata: fileDetails.metadata,
          })
        );
        const answerKeyFiles = Object.entries(data.answer_key_files).map(
          ([fileName, fileDetails]) => ({
            name: fileName,
            url: fileDetails.url,
            type: fileName.split(".").pop().toLowerCase(),
            metadata: fileDetails.metadata,
          })
        );
        const profilePicture = data.profile_picture_url;
        console.log("Profile picture data:", profilePicture);
        // Handle different data structures for profile picture
        const profileUrl =
          typeof profilePicture === "string"
            ? profilePicture
            : profilePicture?.url ||
              profilePicture?.profile_picture_url ||
              null;
        setProfilePicture(profileUrl || null);
        setPatientInfoFiles(infoFiles);
        setAnswerKeyFiles(answerKeyFiles);
      } else {
        console.error(
          "Failed to fetch patient info files:",
          response.statusText
        );
      }
    } catch (error) {
      console.error("Error fetching patient info files:", error);
    } finally {
      setIsInfoLoading(false);
      setIsAnswerLoading(false);
    }
  };

  // Function to fetch empathy summary
  const fetchEmpathySummary = async () => {
    if (!session || !patient) return;

    // Prefer real-time empathy if available
    if (realtimeEmpathy.length > 0) {
      setEmpathySummary({ realtime_feedback: realtimeEmpathy });
      setIsEmpathyCoachOpen(true);
      return;
    }


    setIsEmpathyLoading(true);
    try {
      const authSession = await fetchAuthSession();
      const { email } = await fetchUserAttributes();
      const token = authSession.tokens.idToken;

      const response = await fetch(
        `${
          import.meta.env.VITE_API_ENDPOINT
        }student/empathy_summary?session_id=${encodeURIComponent(
          session.session_id
        )}&email=${encodeURIComponent(
          email
        )}&simulation_group_id=${encodeURIComponent(
          group.simulation_group_id
        )}&patient_id=${encodeURIComponent(patient.patient_id)}`,
        {
          method: "GET",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setEmpathySummary(data);
        setIsEmpathyCoachOpen(true);
      } else {
        console.error("Failed to fetch empathy summary:", response.statusText);
      }
    } catch (error) {
      console.error("Error fetching empathy summary:", error);
    } finally {
      setIsEmpathyLoading(false);
    }
  };

  useEffect(() => {
    if (patient) {
      fetchFiles();
    }
  }, [patient]);

  async function retrieveKnowledgeBase(message, sessionId) {
    try {
      // Create a normalized version of the message for comparison
      const normalizedMessage = message.trim();

      // First check if this message already exists to avoid creating duplicates
      const messageExists = messages.some(
        (msg) =>
          !msg.student_sent && msg.message_content.trim() === normalizedMessage
      );

      if (messageExists) {
        console.log("Message already exists in chat, skipping API call");
        return;
      }

      const authSession = await fetchAuthSession();
      const { email } = await fetchUserAttributes();
      const token = authSession.tokens.idToken;
      try {
        const response = await fetch(
          `${
            import.meta.env.VITE_API_ENDPOINT
          }student/create_ai_message?session_id=${encodeURIComponent(
            sessionId
          )}&email=${encodeURIComponent(
            email
          )}&simulation_group_id=${encodeURIComponent(
            group.simulation_group_id
          )}&patient_id=${encodeURIComponent(patient.patient_id)}`,
          {
            method: "POST",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message_content: message,
            }),
          }
        );

        if (response.ok) {
          const data = await response.json();

          // Create a content key for the new message
          const contentKey = `ai-${data[0].message_content.trim()}`;

          // Double-check if this message already exists in the messages array
          const messageExists = messages.some(
            (msg) =>
              msg.message_id === data[0].message_id ||
              (!msg.student_sent &&
                msg.message_content.trim() === data[0].message_content.trim())
          );

          if (!messageExists) {
            console.log("Adding new AI message to chat");
            setNewMessage(data[0]);
          } else {
            console.log("Duplicate AI message detected, not adding to chat");
          }
        } else {
          console.error("Failed to retrieve message:", response.statusText);
        }
      } catch (error) {
        console.error("Error retrieving message:", error);
      }
    } catch (error) {
      console.error("Error retrieving message from knowledge base:", error);
    }
  }

  // Streaming helpers for AppSync text stream
  const STREAMING_TEMP_ID = "STREAMING_TEMP_ID";

  const startStreamingBubble = () => {
    setMessages((prev) => [
      ...prev,
      {
        message_id: STREAMING_TEMP_ID,
        student_sent: false,
        message_content: " ", // space ensures bubble renders
      },
    ]);
    setIsAItyping(false);
  };

  const appendStreamingChunk = (text) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.message_id === STREAMING_TEMP_ID
          ? {
              ...m,
              message_content:
                (m.message_content === " " ? "" : m.message_content) + text,
            }
          : m
      )
    );
  };

  const finalizeStreamingBubble = async (finalText, sessionId) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.message_id === STREAMING_TEMP_ID
          ? { ...m, message_id: `ai_${Date.now()}`, message_content: finalText }
          : m
      )
    );
  };

  const handleStreamingResponse = async (
    url,
    authToken,
    message,
    overrideSessionId = null
  ) => {
    let fullResponse = "";

    try {
      const { generateClient } = await import("aws-amplify/api");
      const { fetchAuthSession } = await import("aws-amplify/auth");

      const authSession = await fetchAuthSession();
      const client = generateClient({
        authMode: "userPool",
        authToken: authSession.tokens?.idToken?.toString(),
      });

      const currentSessionId = overrideSessionId || session?.session_id;
      if (!currentSessionId)
        throw new Error("No session ID available for streaming");

      const subscription = client
        .graphql({
          query: `
            subscription OnTextStream($sessionId: String!) {
              onTextStream(sessionId: $sessionId) {
                sessionId
                data
              }
            }
          `,
          variables: { sessionId: currentSessionId },
        })
        .subscribe({
          next: async ({ data }) => {
            try {
              const streamData = JSON.parse(data.onTextStream.data);
              const t = streamData?.type;
              const content = streamData?.content || "";

              if (t === "empathy") {
                setRealtimeEmpathy((prev) => [
                  ...prev,
                  { content, timestamp: Date.now() },
                ]);
              } else if (t === "start") {
                startStreamingBubble();
              } else if (t === "chunk") {
                fullResponse += content;
                appendStreamingChunk(content);
              } else if (t === "end") {
                await finalizeStreamingBubble(fullResponse, currentSessionId);
                subscription.unsubscribe();
              } else if (t === "error") {
                console.error("❌ AppSync error:", content);
                setMessages((prev) =>
                  prev.filter((m) => m.message_id !== STREAMING_TEMP_ID)
                );
                subscription.unsubscribe();
              }
            } catch (err) {
              console.error("Error processing stream data:", err);
            }
          },
          error: (error) => {
            console.error("❌ AppSync subscription error:", error);
            setMessages((prev) =>
              prev.filter((m) => m.message_id !== STREAMING_TEMP_ID)
            );
          },
        });

      // Kick off text generation request after subscribing
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: authToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message_content: message }),
      });

      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("❌ AppSync streaming error:", error);
      setMessages((prev) =>
        prev.filter((m) => m.message_id !== STREAMING_TEMP_ID)
      );
      throw error;
    }
  };

  const handleSubmit = () => {
    if (isSubmitting || isAItyping || creatingSession) return;
    setIsSubmitting(true);
    let newSession;
    let authToken;
    let userEmail;
    let messageContent = textareaRef.current.value.trim();
    let getSession;

    if (!messageContent) {
      console.warn("Message content is empty or contains only spaces.");
      setIsSubmitting(false);
      return;
    }
    if (session) {
      getSession = Promise.resolve(session);
    } else {
      if (!creatingSession) {
        setCreatingSession(true);
        handleNewChat();
      }
      setIsSubmitting(false);
      return;
    }

    getSession
      .then((retrievedSession) => {
        newSession = retrievedSession;
        setCurrentSessionId(newSession.session_id);
        return fetchAuthSession();
      })
      .then((authSession) => {
        authToken = authSession.tokens.idToken;
        return fetchUserAttributes();
      })
      .then(({ email }) => {
        userEmail = email;
        const messageUrl = `${
          import.meta.env.VITE_API_ENDPOINT
        }student/create_message?session_id=${encodeURIComponent(
          newSession.session_id
        )}&email=${encodeURIComponent(
          userEmail
        )}&simulation_group_id=${encodeURIComponent(
          group.simulation_group_id
        )}&patient_id=${encodeURIComponent(patient.patient_id)}`;

        return fetch(messageUrl, {
          method: "POST",
          headers: {
            Authorization: authToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message_content: messageContent,
          }),
        });
      })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to create message: ${response.statusText}`);
        }
        return response.json();
      })
      .then((messageData) => {
        setNewMessage(messageData[0]);
        setIsAItyping(true);
        textareaRef.current.value = "";

        const message = messageData[0].message_content;

        const textGenUrl = `${
          import.meta.env.VITE_API_ENDPOINT
        }student/text_generation?simulation_group_id=${encodeURIComponent(
          group.simulation_group_id
        )}&session_id=${encodeURIComponent(
          newSession.session_id
        )}&patient_id=${encodeURIComponent(
          patient.patient_id
        )}&session_name=${encodeURIComponent(newSession.session_name)}`;

        console.log("🚀 Using AppSync streaming");
        return handleStreamingResponse(
          textGenUrl,
          authToken,
          message,
          newSession.session_id
        );
      })
      .then((textGenData) => {
        // Update session name and patient score as before, but do NOT add AI message here (stream handles it)
        setSession((prevSession) => ({
          ...prevSession,
          session_name: textGenData.session_name,
        }));
        const updateSessionName = `${
          import.meta.env.VITE_API_ENDPOINT
        }student/update_session_name?session_id=${encodeURIComponent(
          newSession.session_id
        )}`;

        setSessions((prevSessions) => {
          return prevSessions.map((s) =>
            s.session_id === newSession.session_id
              ? { ...s, session_name: titleCase(textGenData.session_name) }
              : s
          );
        });

        const updatePatientScore = `${
          import.meta.env.VITE_API_ENDPOINT
        }student/update_patient_score?patient_id=${encodeURIComponent(
          patient.patient_id
        )}&student_email=${encodeURIComponent(
          userEmail
        )}&simulation_group_id=${encodeURIComponent(
          group.simulation_group_id
        )}&llm_verdict=${encodeURIComponent(textGenData.llm_verdict)}`;

        return Promise.all([
          fetch(updateSessionName, {
            method: "PUT",
            headers: {
              Authorization: authToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              session_name: textGenData.session_name,
            }),
          }),
          fetch(updatePatientScore, {
            method: "POST",
            headers: {
              Authorization: authToken,
              "Content-Type": "application/json",
            },
          }),
        ]);
      })
      .then(([response1, response2, textGenData]) => {
        if (!response1.ok || !response2.ok) {
          throw new Error("Failed to fetch endpoints");
        }

        return textGenData;

      })
      .catch((error) => {
        setIsSubmitting(false);
        setIsAItyping(false);
        console.error("Error:", error);
      })
      .finally(() => {
        setIsSubmitting(false);
        setIsAItyping(false);
      });
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const handleBack = () => {
    sessionStorage.removeItem("patient");
    navigate(-1);
  };

  const handleSignOut = async (event) => {
    event.preventDefault();
    try {
      await signOut();
      window.location.href = "/";
    } catch (error) {
      console.error("Error signing out: ", error);
    }
  };

  const handleNewChat = () => {
    let sessionData;
    let userEmail;
    let authToken;

    setTimeout(() => setIsAItyping(true), 775);

    return fetchAuthSession()
      .then((session) => {
        authToken = session.tokens.idToken;
        return fetchUserAttributes();
      })
      .then(({ email }) => {
        userEmail = email;
        const session_name = "New chat";
        const url = `${
          import.meta.env.VITE_API_ENDPOINT
        }student/create_session?email=${encodeURIComponent(
          userEmail
        )}&simulation_group_id=${encodeURIComponent(
          group.simulation_group_id
        )}&patient_id=${encodeURIComponent(
          patient.patient_id
        )}&session_name=${encodeURIComponent(session_name)}`;

        return fetch(url, {
          method: "POST",
          headers: {
            Authorization: authToken,
            "Content-Type": "application/json",
          },
        });
      })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to create session: ${response.statusText}`);
        }
        return response.json();
      })
      .then((data) => {
        sessionData = data[0];
        console.log("New session created:", sessionData.session_id);
        setCurrentSessionId(sessionData.session_id);
        setSessions((prevItems) => [...prevItems, sessionData]);
        setSession(sessionData);
        setCreatingSession(false);

        const textGenUrl = `${
          import.meta.env.VITE_API_ENDPOINT
        }student/text_generation?simulation_group_id=${encodeURIComponent(
          group.simulation_group_id
        )}&session_id=${encodeURIComponent(
          sessionData.session_id
        )}&patient_id=${encodeURIComponent(
          patient.patient_id
        )}&session_name=${encodeURIComponent("New chat")}`;

        console.log("Session data for text generation:", sessionData);

        // Use the same AppSync streaming flow for the initial message
        return handleStreamingResponse(
          textGenUrl,
          authToken,
          "",
          sessionData.session_id
        );
      })
      .then((textResponseData) => {
        // Do not call retrieveKnowledgeBase here; stream already persisted the AI message.

        console.log("sessionData:", sessionData);
        return sessionData;
      })
      .catch((error) => {
        console.error("Error creating new chat:", error);
        setCreatingSession(false);
        setIsAItyping(false);
      })
      .finally(() => {
        setIsAItyping(false);
      });
  };

  const handleDeleteSession = async (sessionDelete) => {
    try {
      const authSession = await fetchAuthSession();
      const { email } = await fetchUserAttributes();
      const token = authSession.tokens.idToken;
      const response = await fetch(
        `${
          import.meta.env.VITE_API_ENDPOINT
        }student/delete_session?email=${encodeURIComponent(
          email
        )}&simulation_group_id=${encodeURIComponent(
          group.simulation_group_id
        )}&patient_id=${encodeURIComponent(
          patient.patient_id
        )}&session_id=${encodeURIComponent(sessionDelete.session_id)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        setSessions((prevSessions) =>
          prevSessions.filter(
            (isession) => isession.session_id !== sessionDelete.session_id
          )
        );
        if (sessionDelete.session_id === session.session_id) {
          setSession(null);
          setMessages([]);
        }
      } else {
        console.error("Failed to create session:", response.statusText);
      }
    } catch (error) {
      console.error("Error creating session:", error);
    }
  };

  const handleDeleteMessage = async (message) => {
    // remember to set is submitting true/false
    const authSession = await fetchAuthSession();
    const { email } = await fetchUserAttributes();
    const token = authSession.tokens.idToken;
    try {
      const response = await fetch(
        `${
          import.meta.env.VITE_API_ENDPOINT
        }student/delete_last_message?session_id=${encodeURIComponent(
          session.session_id
        )}`,
        {
          method: "DELETE",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setMessages((prevMessages) => {
          if (prevMessages.length >= 2) {
            return prevMessages.slice(0, -2);
          } else {
            return [];
          }
        });
      } else {
        console.error("Failed to delete message:", response.statusText);
      }
    } catch (error) {
      console.error("Error deleting message:", error);
    }
  };
  useEffect(() => {
    const handleResize = () => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;

        // Enforce max-height and add scroll when needed
        if (textarea.scrollHeight > parseInt(textarea.style.maxHeight)) {
          textarea.style.overflowY = "auto";
        } else {
          textarea.style.overflowY = "hidden";
        }
      }
    };

    handleResize();
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.addEventListener("input", handleResize);

      textarea.addEventListener("keydown", handleKeyDown);
    }

    // Cleanup event listener on unmount
    return () => {
      if (textarea) {
        textarea.removeEventListener("input", handleResize);
        textarea.removeEventListener("keydown", handleKeyDown);
      }
    };
  }, [textareaRef.currrent, handleKeyDown]);
  useEffect(() => {
    const storedPatient = sessionStorage.getItem("patient");
    if (storedPatient) {
      setPatient(JSON.parse(storedPatient));
    }
  }, [setPatient]);

  useEffect(() => {
    const storedGroup = sessionStorage.getItem("group");
    if (storedGroup) {
      setGroup(JSON.parse(storedGroup));
    }
  }, [setGroup]);

  const getMessages = async () => {
    try {
      const authSession = await fetchAuthSession();
      const { email } = await fetchUserAttributes();
      const token = authSession.tokens.idToken;
      const response = await fetch(
        `${
          import.meta.env.VITE_API_ENDPOINT
        }student/get_messages?session_id=${encodeURIComponent(
          session.session_id
        )}`,
        {
          method: "GET",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );
      if (response.ok) {
        const data = await response.json();

        // Enhanced duplicate detection and removal
        const uniqueMessages = [];
        const messageIds = new Set();
        const messageContentMap = new Map(); // Track message content with sender type

        // First sort by time_sent to ensure we keep the earliest messages
        const sortedData = [...data].sort((a, b) => {
          return new Date(a.time_sent) - new Date(b.time_sent);
        });

        sortedData.forEach((message) => {
          // Filter out initial message
          if (message.message_content.trim() === "introduce yourself briefly") {
            return;
          }

          // Create a unique key combining content and sender type
          const contentKey = `${
            message.student_sent ? "student" : "ai"
          }-${message.message_content.trim()}`;

          // Check for duplicates by ID or content
          if (
            !messageIds.has(message.message_id) &&
            !messageContentMap.has(contentKey)
          ) {
            messageIds.add(message.message_id);
            messageContentMap.set(contentKey, true);
            uniqueMessages.push(message);
          } else {
            console.log(
              "Filtered out duplicate message:",
              message.message_content.substring(0, 30) + "..."
            );
          }
        });

        console.log(
          `Filtered ${data.length} messages to ${uniqueMessages.length} unique messages`
        );
        setMessages(uniqueMessages);
      } else {
        console.error("Failed to retrieve session:", response.statusText);
        setMessages([]);
      }
    } catch (error) {
      console.error("Error fetching session:", error);
      setMessages([]);
    }
  };
  useEffect(() => {
    if (session) {
      setCurrentSessionId(session.session_id);
      getMessages();
    }
  }, [session]);

  // Open the confirmation dialog
  const handleOpenConfirm = () => {
    setIsConfirmOpen(true);
  };

  // Close the confirmation dialog
  const handleCloseConfirm = () => {
    setIsConfirmOpen(false);
  };

  // Open the modal for Answer Key(s) after confirmation
  const handleConfirmReveal = () => {
    setIsConfirmOpen(false);
    setIsAnswerKeyOpen(true);
  };

  if (!patient) {
    return <div>Loading...</div>;
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Modern Sidebar */}
      <div
        className="flex flex-col bg-white border-r border-gray-200 shadow-sm"
        style={{
          width: sidebarWidth,
          minWidth: sidebarWidth <= 160 ? "120px" : "280px",
        }}
      >
        {/* Header Section */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleBack}
              className="p-2 rounded-lg bg-[rgba(0,0,0,0)] hover:bg-gray-100 transition-colors duration-200 flex-shrink-0"
            >
              <svg
                className="w-5 h-5 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            {sidebarWidth > 160 && (
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-gray-900 truncate">
                  {titleCase(patient.patient_name)}
                </h2>
                <p className="text-sm text-gray-500">
                  {patient.patient_gender}, {patient.patient_age} years old
                </p>
              </div>
            )}
          </div>
        </div>

        {/* New Chat Button */}
        <div className="p-4">
          <button
            onClick={() => {
              if (!creatingSession) {
                setCreatingSession(true);
                handleNewChat();
              }
            }}
            disabled={creatingSession}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg py-3 px-4 font-medium transition-colors duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            {sidebarWidth > 160 && <span>New Chat</span>}
          </button>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className="space-y-2">
            {sessions
              .slice()
              .reverse()
              .map((iSession) => (
                <Session
                  key={iSession.session_id}
                  text={sidebarWidth > 160 ? iSession.session_name : ""}
                  session={iSession}
                  setSession={setSession}
                  deleteSession={handleDeleteSession}
                  selectedSession={session}
                  setMessages={setMessages}
                  setSessions={setSessions}
                  sessions={sessions}
                />
              ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 border-t border-gray-100 space-y-3">
          {/* Empathy Coach Button */}
          <button
            onClick={fetchEmpathySummary}
            disabled={isEmpathyLoading}
            className="w-full bg-white border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 text-gray-700 hover:text-emerald-700 rounded-lg py-3 px-4 font-medium transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PsychologyIcon className="w-5 h-5" />
            {sidebarWidth > 160 && <span>Empathy Coach</span>}
          </button>

          {/* Notes Button */}
          <button
            onClick={() => setIsNotesOpen(true)}
            className="w-full bg-white border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 text-gray-700 hover:text-emerald-700 rounded-lg py-3 px-4 font-medium transition-all duration-200 flex items-center justify-center space-x-2"
          >
            <DescriptionIcon className="w-5 h-5" />
            {sidebarWidth > 160 && <span>Notes</span>}
          </button>

          {/* Patient Info Button */}
          <button
            onClick={() => setIsPatientInfoOpen(true)}
            className="w-full bg-white border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 text-gray-700 hover:text-emerald-700 rounded-lg py-3 px-4 font-medium transition-all duration-200 flex items-center justify-center space-x-2"
          >
            <InfoIcon className="w-5 h-5" />
            {sidebarWidth > 160 && <span>Patient Info</span>}
          </button>

          {/* Reveal Answer Button */}
          <button
            onClick={handleOpenConfirm}
            className="w-full bg-white border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 text-gray-700 hover:text-emerald-700 rounded-lg py-3 px-4 font-medium transition-all duration-200 flex items-center justify-center space-x-2"
          >
            <KeyIcon className="w-5 h-5" />
            {sidebarWidth > 160 && <span>Reveal Answer</span>}
          </button>
        </div>
      </div>

      {/* Sidebar Resize Handle */}
      <div
        onMouseDown={startResizing}
        className="w-1 bg-gray-200 hover:bg-emerald-300 cursor-col-resize transition-colors duration-200"
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Top Bar */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
              <svg
                className="w-6 h-6 text-emerald-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <div style={{ textAlign: "left" }} className="flex flex-col">
              <h1 className="text-xl font-semibold text-gray-900">
                AI Patient
              </h1>
              <p className="text-sm text-gray-500">
                Interactive medical simulation
              </p>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium transition-colors duration-200"
          >
            Sign Out
          </button>
        </div>

        {/* Move messages below the fixed header by adding a top margin equal to header height */}
        <div className="flex-grow overflow-y-auto p-4 h-full flex flex-col">
          {messages.map((message, index) =>
            message.student_sent ? (
              <StudentMessage
                key={message.message_id}
                message={message.message_content}
                isMostRecent={getMostRecentStudentMessageIndex() === index}
                onDelete={() => handleDeleteMessage(message)}
                hasAiMessageAfter={() =>
                  hasAiMessageAfter(
                    messages,
                    getMostRecentStudentMessageIndex()
                  )
                }
              />
            ) : (
              <AIMessage
                key={message.message_id}
                message={message.message_content}
                profilePicture={profilePicture}
                name={patient?.patient_name}
                isStreaming={message._streaming === true}
              />
            )
          )}

          {/* TypingIndicator */}

          {isAItyping && (
            <TypingIndicator patientName={patient?.patient_name} />
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-200 p-6">
          <div className="bg-gray-50 border border-gray-200 rounded-2xl flex items-end space-x-3 p-4 focus-within:border-emerald-300 focus-within:bg-white transition-all duration-200">
            {/* Voice Button */}
            <button
              onClick={() => {
                if (isRecording) {
                  stopSpokenLLM();
                  setIsRecording(false);
                  setShowVoiceOverlay(false);
                  setLoading(false);
                } else {
                  setShowVoiceOverlay(true);
                  fetchVoiceID().then((voice_id) => {
                    console.log("Session ID:", currentSessionId);
                    startSpokenLLM(voice_id, setLoading, currentSessionId);
                  });
                  setIsRecording(true);
                  setLoading(true);
                }
              }}
              className={`p-2 rounded-lg transition-colors duration-200 flex-shrink-0 ${
                isRecording
                  ? "bg-red-100 text-red-600 hover:bg-red-200"
                  : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              <MicIcon className="w-5 h-5" />
            </button>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              placeholder="Type your message..."
              className="flex-1 bg-transparent text-gray-900 placeholder-gray-500 resize-none outline-none max-h-32 py-1"
              style={{ maxHeight: "2.4rem" }}
              maxLength={2096}
            />

            {/* Send Button */}
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || isAItyping || creatingSession}
              className="p-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors duration-200 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Draggable Notes */}
      {isNotesOpen && (
        <DraggableNotes
          isOpen={isNotesOpen}
          sessionId={session.session_id}
          onClose={() => setIsNotesOpen(false)}
          zIndex={showVoiceOverlay ? 3500 : 50}
        />
      )}

      <FilesPopout
        open={isPatientInfoOpen}
        onClose={() => setIsPatientInfoOpen(false)}
        files={patientInfoFiles}
        isLoading={isInfoLoading}
      />

      <FilesPopout
        open={isAnswerKeyOpen}
        onClose={() => setIsAnswerKeyOpen(false)}
        files={answerKeyFiles}
        isLoading={isAnswerLoading}
      />

      {/* Empathy Coach Dialog */}
      <Dialog
        open={isEmpathyCoachOpen}
        onClose={() => setIsEmpathyCoachOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: "16px",
            padding: "8px",
          },
        }}
      >
        <DialogTitle
          sx={{
            fontSize: "1.25rem",
            fontWeight: 600,
            color: "#111827",
            borderBottom: "1px solid #f3f4f6",
            pb: 2,
          }}
        >
          Empathy Coach Summary
          {patient && ` - ${patient.patient_name}`}
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {isEmpathyLoading ? (
            <div className="flex items-center space-x-3 py-8">
              <l-mirage size="32" speed="2.5" color="#10b981"></l-mirage>
              <Typography className="text-gray-600">
                Loading empathy summary...
              </Typography>
            </div>
          ) : (
            <EmpathyCoachSummary empathyData={empathySummary} />
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 2 }}>
          <Button
            onClick={() => setIsEmpathyCoachOpen(false)}
            sx={{
              backgroundColor: "#f3f4f6",
              color: "#374151",
              "&:hover": {
                backgroundColor: "#e5e7eb",
              },
              borderRadius: "8px",
              textTransform: "none",
              fontWeight: 500,
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirmation Dialog for Reveal */}
      <Dialog
        open={isConfirmOpen}
        onClose={handleCloseConfirm}
        PaperProps={{
          sx: {
            borderRadius: "16px",
            padding: "8px",
          },
        }}
      >
        <DialogTitle
          sx={{
            fontSize: "1.25rem",
            fontWeight: 600,
            color: "#111827",
            borderBottom: "1px solid #f3f4f6",
            pb: 2,
          }}
        >
          Confirm Reveal
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <DialogContentText sx={{ color: "#6b7280", lineHeight: 1.6 }}>
            Are you sure you want to reveal the Patient's Diagnosis? This action
            will show the entire answer.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 2, gap: 1 }}>
          <Button
            onClick={handleCloseConfirm}
            sx={{
              backgroundColor: "#f3f4f6",
              color: "#374151",
              "&:hover": {
                backgroundColor: "#e5e7eb",
              },
              borderRadius: "8px",
              textTransform: "none",
              fontWeight: 500,
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmReveal}
            sx={{
              backgroundColor: "#ef4444",
              color: "white",
              "&:hover": {
                backgroundColor: "#dc2626",
              },
              borderRadius: "8px",
              textTransform: "none",
              fontWeight: 500,
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
      {/* Loading screen - Modern design */}
      {loading && (
        <div className="fixed inset-0 bg-white bg-opacity-95 backdrop-blur-sm z-[2000] flex flex-col items-center justify-center">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 flex flex-col items-center space-y-4">
            <l-mirage size="48" speed="2.5" color="#10b981" />
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                Starting conversation...
              </h3>
              <p className="text-sm text-gray-500">Connecting to AI patient</p>
            </div>
          </div>
        </div>
      )}

      {/* Voice Overlay - Modern design */}
      {showVoiceOverlay && (
        <>
          <div className="fixed inset-0 z-[2500] flex items-center justify-center bg-white bg-opacity-95 backdrop-blur-lg">
            {/* Loading state while mic initializes */}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm z-[3002]">
                <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 flex flex-col items-center space-y-4">
                  <l-mirage size="48" speed="2.5" color="#10b981" />
                  <div className="text-center">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      Preparing microphone...
                    </h3>
                    <p className="text-sm text-gray-500">
                      Setting up voice stream
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="text-center">
              <div className="relative z-[3001] w-32 h-32 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6 overflow-hidden shadow-lg">
                {profilePicture ? (
                  <img
                    src={profilePicture}
                    alt={patient?.patient_name}
                    className="relative z-[3001] w-32 h-32 object-cover"
                    onError={() => setProfilePicture(null)}
                  />
                ) : (
                  <MicIcon className="relative z-[3001] w-16 h-16 text-emerald-600" />
                )}
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Voice Mode Active
              </h3>
              <p className="text-gray-600 mb-8">
                Speak naturally to interact with the AI patient
              </p>

              {/* Animated voice waves - render immediately even before audio starts */}
              <div className="flex justify-center space-x-1 mb-8">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1 bg-emerald-500 rounded-full animate-pulse"
                    style={{
                      height: Math.random() * 30 + 20 + "px",
                      animationDelay: i * 0.1 + "s",
                      opacity: loading ? 0.5 : 1,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Visualizer canvas kept visible at all times while overlay is open */}
            <canvas
              id="audio-visualizer"
              width={window.innerWidth}
              height={window.innerHeight}
              className="fixed top-0 left-0 pointer-events-none z-[2000] opacity-30"
            />


            {/* Bottom control island with Close (red) and Notes (white) */}
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[3003] bg-white/90 backdrop-blur-md border border-gray-200 shadow-lg rounded-full px-3 py-2 flex items-center space-x-3">
              <button
                onClick={() => {
                  stopAudioPlayback();
                  stopSpokenLLM();
                  setIsRecording(false);
                  setShowVoiceOverlay(false);
                  setLoading(false);
                }}
                aria-label="Close voice overlay"
                className="w-12 h-12 rounded-full bg-[#ff6666] hover:bg-[#c74545] flex items-center justify-center shadow-md"
              >
                <CloseIcon className="w-6 h-6 text-white" />
              </button>

              <button
                onClick={() => setIsNotesOpen(true)}
                aria-label="Open notes"
                className="w-12 h-12 rounded-full bg-white hover:bg-gray-50 border border-gray-200 flex items-center justify-center shadow-md"
              >
                <DescriptionIcon className="w-6 h-6 text-gray-700" />
              </button>
            </div>
          </div>

        </>
      )}
    </div>
  );
};

export default StudentChat;
