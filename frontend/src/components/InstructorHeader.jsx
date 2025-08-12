import React, { useContext } from "react";
import { useNavigate } from "react-router-dom";
// amplify
import { signOut } from "aws-amplify/auth";
import { UserContext } from "../App";

const InstructorHeader = () => {
  const navigate = useNavigate();
  const { setIsInstructorAsStudent } = useContext(UserContext);

  const handleSignOut = (event) => {
    event.preventDefault();
    signOut()
      .then(() => {
        window.location.href = "/";
      })
      .catch((error) => {
        console.error("Error signing out: ", error);
      });
  };

  const handleViewAsStudent = () => {
    setIsInstructorAsStudent(true);
  };

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
          {/* Graduation cap (school) icon */}
          <svg
            className="w-6 h-6 text-emerald-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 7l9-4 9 4-9 4-9-4z" />
            <path d="M12 11l9-4" />
            <path d="M12 11L3 7" />
            <path d="M12 11v8" />
            <path d="M7 15c1.5 1 3.5 1 5 0s3.5-1 5 0" />
          </svg>
        </div>
        <div className="text-left">
          <h1 className="text-xl font-semibold text-gray-900 leading-tight">
            Instructor
          </h1>
          <p className="text-sm text-gray-500">Manage Simulation Groups</p>
        </div>
      </div>
      <div className="flex items-center space-x-3">
        <button
          type="button"
          className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-200"
          onClick={handleViewAsStudent}
        >
          Student View
        </button>
        <button
          type="button"
          className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium transition-colors duration-200"
          onClick={handleSignOut}
        >
          Sign Out
        </button>
      </div>
    </header>
  );
};

export default InstructorHeader;
