import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { dracula } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { Avatar } from "@mui/material";
import ReactMarkdown from "react-markdown";

// Custom renderer for markdown response
const MarkdownRender = ({ content }) => {
  return (
    <ReactMarkdown
      children={content}
      components={{
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          return !inline && match ? (
            <SyntaxHighlighter
              style={dracula}
              language={match[1]}
              PreTag="div"
              customStyle={{ fontSize: "0.85em" }}
              {...props}
            >
              {String(children).replace(/\n$/, "")}
            </SyntaxHighlighter>
          ) : (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
      }}
    />
  );
};

const AIMessage = ({
  message,
  profilePicture,
  name = "AI",
  isStreaming = false,
}) => {
  // Process the message to remove duplicated content
  const processedMessage = useMemo(() => {
    // Check if the message contains duplicated text
    if (!message) return "";

    // Split by "Patient Response:" if it exists multiple times
    const parts = message.split("**Patient Response:**");
    if (parts.length > 1) {
      // Keep the empathy feedback (if any) and the last patient response
      const empathyFeedback = parts[0];
      const lastResponse = parts[parts.length - 1];
      return empathyFeedback + "**Patient Response:**" + lastResponse;
    }

    // Check for other types of duplications
    const lines = message.split("\n");
    const uniqueLines = [];
    const seenLines = new Set();

    for (const line of lines) {
      const trimmedLine = line.trim();
      // Skip empty lines or very short lines (likely not duplicates)
      if (trimmedLine.length < 5) {
        uniqueLines.push(line);
        continue;
      }

      if (!seenLines.has(trimmedLine)) {
        seenLines.add(trimmedLine);
        uniqueLines.push(line);
      }
    }

    return uniqueLines.join("\n");
  }, [message]);

  return (
    <div className="flex justify-start mb-4">
      <div className="flex items-start space-x-3 max-w-[70%]">
        {/* AI Avatar */}
        <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
          {profilePicture ? (
            <img
              src={profilePicture}
              alt={name}
              className="w-8 h-8 rounded-full object-cover"
              onError={(e) => {
                console.error(
                  "Failed to load profile picture:",
                  profilePicture
                );
                e.target.style.display = "none";
                e.target.nextSibling.style.display = "block";
              }}
            />
          ) : null}
          <svg
            className="w-5 h-5 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            style={{ display: profilePicture ? "none" : "block" }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>

        {/* Chat Bubble for AI Message */}
        <div
          className="bg-white border border-gray-200 rounded-2xl rounded-bl-lg px-4 py-3 shadow-sm"
          style={{ textAlign: "left" }}
        >
          <div className="text-sm text-gray-900 leading-relaxed">
            <MarkdownRender content={processedMessage} />
            {isStreaming && (
              <span className="inline-block w-2 h-5 bg-emerald-500 ml-1 animate-pulse" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

AIMessage.propTypes = {
  message: PropTypes.string.isRequired,
  profilePicture: PropTypes.string,
  name: PropTypes.string,
  isStreaming: PropTypes.bool,
};

export default AIMessage;
