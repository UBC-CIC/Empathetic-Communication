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
import { io } from "socket.io-client";

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
import RecordVoiceOverIcon from "@mui/icons-material/RecordVoiceOver";

// Importing l-mirage animation
import { mirage } from "ldrs";
mirage.register();

// TypingIndicator using l-mirage
const TypingIndicator = ({ patientName }) => (
  <div className="flex items-center mx-20 mb-4">
    <l-mirage size="60" speed="2.5" color="black"></l-mirage>
    <span className="ml-2 text-black font-roboto">
      {patientName ? `${titleCase(patientName)} is typing...` : "Typing..."}
    </span>
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
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [newMessage, setNewMessage] = useState(null);
  const [isAItyping, setIsAItyping] = useState(false);
  const [loading, setLoading] = useState(true);

  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isPatientInfoOpen, setIsPatientInfoOpen] = useState(false);
  const [isAnswerKeyOpen, setIsAnswerKeyOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const [patientInfoFiles, setPatientInfoFiles] = useState([]);
  const [isInfoLoading, setIsInfoLoading] = useState(false);

  const [answerKeyFiles, setAnswerKeyFiles] = useState([]);
  const [isAnswerLoading, setIsAnswerLoading] = useState(false);

  const [profilePicture, setProfilePicture] = useState({});

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
      if (currentSessionId === session.session_id) {
        setMessages((prevItems) => [...prevItems, newMessage]);
      }
      setNewMessage(null);
    }
  }, [session, newMessage, currentSessionId]);

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
          setSession(data[data.length - 1]);
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

  // Connect to WebSocket server
  const socket = io(import.meta.env.VITE_SOCKET_URL);

  // Debug WebSocket connection
  socket.on("connect", () => {
    console.log("✅ WebSocket connected:", socket.id);
  });

  socket.on("disconnect", () => {
    console.log("❌ WebSocket disconnected");
  });

  socket.on("connect_error", (error) => {
    console.error("🔥 WebSocket connection error:", error);
  });

  // Listen for Nova Sonic audio
  socket.on("audio-chunk", (data) => {
    console.log("🎵 Received audio chunk:", data);
    const audioBytes = atob(data.data);
    playAudio(audioBytes);
  });

  // Listen for text messages
  socket.on("text-message", (data) => {
    console.log("💬 Nova Sonic:", data.text);
  });

  // Start Nova Sonic session
  async function startSpokenLLM() {
    console.log("🚀 Starting Nova Sonic session");
    console.log("Socket URL:", import.meta.env.VITE_SOCKET_URL);
    console.log("Socket connected:", socket.connected);

    // Start microphone
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          const reader = new FileReader();
          reader.onload = () => {
            const audioData = reader.result.split(",")[1]; // Remove data:audio/webm;base64,
            socket.emit("audio-input", { data: audioData });
          };
          reader.readAsDataURL(event.data);
        }
      };

      recorder.start(100); // Send audio chunks every 100ms
      setMediaRecorder(recorder);
      setIsRecording(true);

      socket.emit("start-nova-sonic");
      console.log("📡 Emitted start-nova-sonic event");
    } catch (error) {
      console.error("🎤 Microphone access denied:", error);
    }
  }

  // Stop recording
  function stopSpokenLLM() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
      setMediaRecorder(null);
      console.log("🛑 Stopped recording");
    }
  }

  // Send text to Nova Sonic
  function sendTextToNova() {
    if (novaTextInput.trim()) {
      console.log("📝 Sending text to Nova:", novaTextInput);
      socket.emit("text-input", { text: novaTextInput });
      setNovaTextInput("");
    }
  }

  function playAudio(audioBytes) {
    try {
      // Create audio element and play
      const audio = new Audio(`data:audio/wav;base64,${audioBytes}`);
      audio.play().catch((e) => console.error("Audio play failed:", e));
    } catch (error) {
      console.error("Audio processing failed:", error);
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
        console.log(data);
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
        setProfilePicture(profilePicture);
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

  useEffect(() => {
    if (patient) {
      fetchFiles();
    }
  }, [patient]);

  async function retrieveKnowledgeBase(message, sessionId) {
    try {
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
          setNewMessage(data[0]);
        } else {
          console.error("Failed to retreive message:", response.statusText);
        }
      } catch (error) {
        console.error("Error retreiving message:", error);
      }
    } catch (error) {
      console.error("Error retrieving message from knowledge base:", error);
    }
  }

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

        return fetch(textGenUrl, {
          method: "POST",
          headers: {
            Authorization: authToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message_content: message,
          }),
        });
      })
      .then((textGenResponse) => {
        if (!textGenResponse.ok) {
          throw new Error(
            `Failed to generate text: ${textGenResponse.statusText}`
          );
        }
        return textGenResponse.json();
      })
      .then((textGenData) => {
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
          textGenData,
        ]);
      })
      .then(([response1, response2, textGenData]) => {
        if (!response1.ok || !response2.ok) {
          throw new Error("Failed to fetch endpoints");
        }

        return retrieveKnowledgeBase(
          textGenData.llm_output,
          newSession.session_id
        );
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

        return fetch(textGenUrl, {
          method: "POST",
          headers: {
            Authorization: authToken,
            "Content-Type": "application/json",
          },
        });
      })
      .then((textResponse) => {
        if (!textResponse.ok) {
          throw new Error(
            `Failed to create initial message: ${textResponse.statusText}`
          );
        }
        return textResponse.json();
      })
      .then((textResponseData) => {
        retrieveKnowledgeBase(
          textResponseData.llm_output,
          sessionData.session_id
        );
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
        setMessages(data);
      } else {
        console.error("Failed to retreive session:", response.statusText);
        setMessages([]);
      }
    } catch (error) {
      console.error("Error fetching session:", error);
      setMessages([]);
    }
  };
  useEffect(() => {
    if (session) {
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
    <div className="flex flex-row h-screen">
      {/* Sidebar */}
      <div
        className="flex flex-col bg-[#99DFB2] h-full"
        style={{ width: sidebarWidth }}
      >
        {/* Back Button and Patient Name */}
        <div
          className="flex flex-row mt-3 mb-3 ml-4"
          style={{
            justifyContent: sidebarWidth <= 160 ? "" : "flex-start",
          }}
        >
          <img
            onClick={() => handleBack()}
            className="w-8 h-8 cursor-pointer"
            src="./ArrowCircleDownRounded.png"
            alt="back"
          />
          {sidebarWidth > 160 && (
            <div className="ml-3 pt-0.5 text-black font-roboto font-bold text-lg">
              {titleCase(patient.patient_name)} {/* Patient Name */}
              <span className="text-sm ml-1">
                ({patient.patient_gender}, {patient.patient_age}){" "}
                {/* Patient Gender and Age */}
              </span>
            </div>
          )}
        </div>

        {/* New Chat Button */}
        <button
          onClick={() => {
            if (!creatingSession) {
              setCreatingSession(true);
              handleNewChat();
            }
          }}
          className="border border-black ml-8 mr-8 mt-0 mb-0 bg-transparent pt-1.5 pb-1.5 hover:scale-105 transition-transform duration-300"
        >
          <div
            className="flex items-center gap-2"
            style={{
              justifyContent: sidebarWidth <= 160 ? "center" : "flex-start",
            }}
          >
            <div className="text-md font-roboto text-[#212427]">+</div>
            {sidebarWidth > 160 && (
              <div className="text-md font-roboto font-bold text-[#212427]">
                New Chat
              </div>
            )}
          </div>
        </button>

        <button
          onClick={() => {
            if (isRecording) {
              stopSpokenLLM();
            } else {
              startSpokenLLM();
            }
          }}
          className={`border border-black ml-8 mr-8 mt-0 mb-0 pt-1.5 pb-1.5 hover:scale-105 transition-transform duration-300 ${
            isRecording ? "bg-red-500 text-white" : "bg-transparent"
          }`}
        >
          <div
            className="flex items-center gap-2"
            style={{
              justifyContent: sidebarWidth <= 160 ? "center" : "flex-start",
            }}
          >
            {sidebarWidth > 160 && (
              <div className="text-md font-roboto font-bold">
                {isRecording ? "🎤 Stop Voice Chat" : "🎤 Start Voice Chat"}
              </div>
            )}
          </div>
        </button>

        {/* Text input for Nova Sonic */}
        <div className="mx-8 mt-2">
          <input
            type="text"
            value={novaTextInput}
            onChange={(e) => setNovaTextInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendTextToNova()}
            placeholder="Type to Nova Sonic..."
            className="w-full p-2 text-sm border border-black bg-white"
          />
          <button
            onClick={sendTextToNova}
            className="w-full mt-1 p-1 bg-blue-500 text-white text-sm hover:bg-blue-600"
          >
            Send Text
          </button>
        </div>

        <div className="my-4">
          <hr className="border-t border-black" />
        </div>

        {/* Session List */}
        <div className="flex-grow overflow-y-auto mt-2 mb-6">
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

        {/* Notes and Patient Info Buttons */}
        <div className="mt-auto px-8 mb-8">
          <button
            onClick={() => setIsNotesOpen(true)}
            className="border border-black bg-transparent pt-2 pb-2 w-full hover:scale-105 transition-transform duration-300"
          >
            <div
              className="flex items-center justify-center"
              style={{
                justifyContent: sidebarWidth <= 160 ? "center" : "flex-start",
              }}
            >
              <DescriptionIcon
                className={sidebarWidth <= 160 ? "mx-auto" : "mr-2"}
                style={{ color: "black" }}
              />
              {sidebarWidth > 160 && <span className="text-black">Notes</span>}
            </div>
          </button>

          <button
            onClick={() => setIsPatientInfoOpen(true)}
            className="border border-black bg-transparent pt-2 pb-2 w-full mt-4 hover:scale-105 transition-transform duration-300"
          >
            <div
              className="flex items-center justify-center"
              style={{
                justifyContent: sidebarWidth <= 160 ? "center" : "flex-start",
              }}
            >
              <InfoIcon
                className={sidebarWidth <= 160 ? "mx-auto" : "mr-2"}
                style={{ color: "black" }}
              />
              {sidebarWidth > 160 && (
                <span className="text-black">Patient Info</span>
              )}
            </div>
          </button>

          {/* Reveal LLM Patient Diagnosis Button */}
          <button
            onClick={handleOpenConfirm}
            className="border border-black bg-transparent pt-2 pb-2 w-full mt-4 hover:scale-105 transition-transform duration-300"
          >
            <div
              className="flex items-center justify-center"
              style={{
                justifyContent: sidebarWidth <= 160 ? "center" : "flex-start",
              }}
            >
              <KeyIcon
                className={sidebarWidth <= 160 ? "mx-auto" : "mr-2"}
                style={{ color: "black" }}
              />
              {sidebarWidth > 160 && (
                <span className="text-black">Reveal Answer</span>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* Sidebar Resize Handle */}
      <div
        onMouseDown={startResizing}
        style={{
          width: "5px",
          cursor: "col-resize",
          height: "100vh",
          backgroundColor: "#F8F9FD",
          position: "relative",
        }}
      />

      {/* Chat Area */}
      <div className="flex flex-col-reverse flex-grow bg-[#F8F9FD]">
        {/* Sign-Out Button */}
        <div className="absolute top-4 right-4">
          <button
            type="button"
            className="bg-gray-800 text-white px-4 py-2 rounded hover:bg-gray-700 transition duration-200"
            onClick={handleSignOut}
          >
            Sign Out
          </button>
        </div>

        <div className="flex items-center justify-between border bg-[#f2f0f0] border-[#8C8C8C] py-2 mb-12 mx-20">
          <textarea
            ref={textareaRef}
            className="text-sm w-full outline-none bg-[#f2f0f0] text-black resize-none max-h-32 ml-2 mr-2"
            style={{ maxHeight: "8rem" }}
            maxLength={2096}
          />
          <img
            onClick={handleSubmit}
            className="cursor-pointer w-4 h-4 mr-5"
            src="./send.png"
            alt="send"
            style={{
              filter:
                "invert(58%) sepia(80%) saturate(600%) hue-rotate(100deg) brightness(90%) contrast(95%)",
            }}
          />
        </div>
        <div className="flex-grow overflow-y-auto p-4 h-full">
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
                profilePicture={profilePicture} // Pass profile picture URL to AIMessage
                name={patient?.patient_name} // Pass patient's name to display as fallback
              />
            )
          )}

          {/* TypingIndicator: Pass patient's name */}
          {isAItyping && (
            <TypingIndicator patientName={patient?.patient_name} />
          )}

          <div ref={messagesEndRef} />
        </div>
        <div className="font-roboto font-bold text-2xl text-center mt-6 mb-6 text-black">
          AI Patient
        </div>
      </div>

      {/* Draggable Notes */}
      {isNotesOpen && (
        <DraggableNotes
          isOpen={isNotesOpen}
          sessionId={session.session_id}
          onClose={() => setIsNotesOpen(false)}
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

      {/* Confirmation Dialog for Reveal */}
      <Dialog open={isConfirmOpen} onClose={handleCloseConfirm}>
        <DialogTitle>Confirm Reveal</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to reveal the Patient's Diagnosis? This action
            will show the entire answer.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseConfirm} color="primary">
            Cancel
          </Button>
          <Button onClick={handleConfirmReveal} color="error">
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </div> //
  );
};

export default StudentChat;
