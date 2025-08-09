import React, { useState, useRef, useEffect } from "react";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { fetchAuthSession } from "aws-amplify/auth";
import HighlightOffIcon from '@mui/icons-material/HighlightOff';

function DraggableNotes({ onClose, sessionId, zIndex = 50 }) {
  const [noteContent, setNoteContent] = useState("");
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [dimensions, setDimensions] = useState({ width: 400, height: 300 });
  const noteRef = useRef(null);
  const isDragging = useRef(false);
  const isResizing = useRef(false);

  // Load notes when component mounts
  useEffect(() => {
    if (sessionId) {
      fetchNotes(sessionId);
    }
  }, [sessionId]);

  const fetchNotes = async (sessionId) => {
    try {
      const authSession = await fetchAuthSession();
      const token = authSession.tokens.idToken;

      const response = await fetch(
        `${import.meta.env.VITE_API_ENDPOINT}student/get_notes?session_id=${encodeURIComponent(sessionId)}`,
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
        setNoteContent(data.notes || "");
      } else {
        console.error("Failed to fetch notes.");
      }
    } catch (error) {
      console.error("Error fetching notes:", error);
    }
  };

  const handleNoteChange = (e) => {
    setNoteContent(e.target.value);
  };

  const handleSave = async () => {
    try {
      const authSession = await fetchAuthSession();
      const token = authSession.tokens.idToken;

      const response = await fetch(
        `${import.meta.env.VITE_API_ENDPOINT}student/update_notes?session_id=${encodeURIComponent(sessionId)}`,
        {
          method: "PUT",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ notes: noteContent }),
        }
      );

      if (response.ok) {
        toast.success("Notes saved successfully!", {
          position: "top-center",
          autoClose: 1000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          theme: "colored",
        });
      } else {
        console.error("Failed to save notes.");
      }
    } catch (error) {
      console.error("Error saving notes:", error);
    }
  };

  const handleMouseDown = (e) => {
    if (e.target.tagName.toLowerCase() === "textarea" || isResizing.current) return;

    isDragging.current = true;
    noteRef.current.style.cursor = "grabbing";

    const offsetX = e.clientX - position.x;
    const offsetY = e.clientY - position.y;

    const handleMouseMove = (moveEvent) => {
      if (isDragging.current) {
        setPosition({
          x: moveEvent.clientX - offsetX,
          y: moveEvent.clientY - offsetY,
        });
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      noteRef.current.style.cursor = "grab";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleResizeMouseDown = (e) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = dimensions.width;
    const startHeight = dimensions.height;

    const onMouseMove = (moveEvent) => {
      const newWidth = startWidth + (moveEvent.clientX - startX);
      const newHeight = startHeight + (moveEvent.clientY - startY);

      setDimensions({
        width: newWidth > 200 ? newWidth : 200,
        height: newHeight > 150 ? newHeight : 150,
      });
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div
      ref={noteRef}
      onMouseDown={handleMouseDown}
      className="fixed bg-white border border-gray-200 rounded-2xl shadow-lg"
      style={{
        top: `${position.y}px`,
        left: `${position.x}px`,
        width: `${dimensions.width}px`,
        height: `${dimensions.height}px`,
        cursor: "grab",
        zIndex: zIndex,
      }}
    >
      {/* Header */}
      <div className="bg-emerald-500 text-white px-4 py-3 rounded-t-2xl flex justify-between items-center">
        <span className="font-semibold">Notes</span>
        <button
          onClick={onClose}
          className="p-1 hover:bg-emerald-600 rounded-lg transition-colors duration-200"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Textarea */}
      <div className="p-4 h-full" style={{ height: "calc(100% - 120px)" }}>
        <textarea
          className="w-full h-full p-3 border border-gray-200 rounded-lg bg-gray-50 text-gray-900 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          placeholder="Write your notes here..."
          value={noteContent}
          onChange={handleNoteChange}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
            }
          }}
        />
      </div>

      {/* Save Button */}
      <div className="px-4 pb-4 text-right">
        <button
          onClick={handleSave}
          className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200"
        >
          Save
        </button>
      </div>

      {/* Resizer Handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="absolute bottom-0 right-0 w-4 h-4 bg-gray-300 hover:bg-gray-400 cursor-nwse-resize rounded-bl-lg"
        style={{
          borderRadius: "0 0 16px 0",
        }}
      />

      {/* Toast Container */}
      <ToastContainer
        position="top-center"
        autoClose={1000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="colored"
      />
    </div>
  );
}

export default DraggableNotes;
