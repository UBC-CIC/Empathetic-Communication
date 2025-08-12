import React, { useEffect, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import { fetchUserAttributes } from "aws-amplify/auth";

import { signOut } from "aws-amplify/auth";

import { BiCheck } from "react-icons/bi";
import { FaInfoCircle } from "react-icons/fa";

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Avatar,
  Tooltip,
} from "@mui/material";
import { useNavigate } from "react-router-dom";

// Function to calculate the color based on the average score
const calculateColor = (score) => {
  if (score === null) {
    return "bg-red-500"; // Red for null scores
  }

  const redStart = 255; // Starting red component for red
  const redMiddle = 255; // Red component for less vibrant yellow
  const redEnd = 0; // Ending red component for green

  const greenStart = 0; // Starting green component for red
  const greenMiddle = 200; // Less vibrant yellow (lower green component)
  const greenEnd = 150; // Ending green component for green

  const blueStart = 0; // Starting blue component for red
  const blueMiddle = 0; // Blue component for less vibrant yellow
  const blueEnd = 0; // Ending blue component for green

  let r, g, b;

  if (score <= 50) {
    // Transition from red to less vibrant yellow
    const ratio = score / 50; // Ratio from 0 to 1
    r = redStart;
    g = greenStart + ratio * (greenMiddle - greenStart);
    b = blueStart + ratio * (blueMiddle - blueStart);
  } else {
    // Transition from less vibrant yellow to green
    const ratio = (score - 50) / 50; // Ratio from 0 to 1
    r = redMiddle + ratio * (redEnd - redMiddle);
    g = greenMiddle + ratio * (greenEnd - greenMiddle);
    b = blueMiddle + ratio * (blueEnd - blueMiddle);
  }

  return `rgb(${r}, ${g}, ${b})`;
};

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

export const GroupView = ({ group, setPatient, setGroup }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profilePictures, setProfilePictures] = useState({});
  const [completionStatuses, setCompletionStatuses] = useState({});

  const navigate = useNavigate();
  const enterPatient = (patient) => {
    setPatient(patient);
    sessionStorage.setItem("patient", JSON.stringify(patient));
    navigate(`/student_chat`);
  };

  const handleBack = () => {
    sessionStorage.removeItem("group");
    navigate("/home");
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

  useEffect(() => {
    const fetchGroupPage = async () => {
      try {
        const session = await fetchAuthSession();
        const { email } = await fetchUserAttributes();

        const token = session.tokens.idToken;
        const response = await fetch(
          `${
            import.meta.env.VITE_API_ENDPOINT
          }student/simulation_group_page?email=${encodeURIComponent(
            email
          )}&simulation_group_id=${encodeURIComponent(
            group.simulation_group_id
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
          setData(data);
          await fetchProfilePictures(data);
          fetchCompletionStatuses();
          setLoading(false);
          console.log(data);
        } else {
          console.error("Failed to fetch name:", response.statusText);
        }
      } catch (error) {
        console.error("Error fetching name:", error);
      }
    };

    const fetchCompletionStatuses = async () => {
      try {
        const session = await fetchAuthSession();
        const { email } = await fetchUserAttributes();
        const token = session.tokens.idToken;

        const response = await fetch(
          `${
            import.meta.env.VITE_API_ENDPOINT
          }student/get_completion_status?simulation_group_id=${encodeURIComponent(
            group.simulation_group_id
          )}&student_email=${encodeURIComponent(email)}`,
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
          const completionMap = data.reduce((acc, entry) => {
            acc[entry.patient_name] = entry.is_completed;
            return acc;
          }, {});
          setCompletionStatuses(completionMap);
        } else {
          console.error(
            "Failed to fetch completion statuses:",
            response.statusText
          );
        }
      } catch (error) {
        console.error("Error fetching completion statuses:", error);
      }
    };

    const fetchProfilePictures = async (patients) => {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens.idToken;

        const response = await fetch(
          `${
            import.meta.env.VITE_API_ENDPOINT
          }student/get_profile_pictures?simulation_group_id=${encodeURIComponent(
            group.simulation_group_id
          )}`,
          {
            method: "POST",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              patient_ids: patients.map((p) => p.patient_id),
            }),
          }
        );

        if (response.ok) {
          const profilePics = await response.json();
          setProfilePictures(profilePics);
        } else {
          console.error(
            "Failed to fetch profile pictures:",
            response.statusText
          );
        }
      } catch (error) {
        console.error("Error fetching profile pictures:", error);
      }
    };

    fetchGroupPage();
  }, [group]);

  useEffect(() => {
    sessionStorage.removeItem("patient");
    const storedGroup = sessionStorage.getItem("group");
    if (storedGroup) {
      setGroup(JSON.parse(storedGroup));
    }
  }, [setGroup]);

  if (loading) {
    return (
      <div className="bg-white w-screen flex justify-center items-center h-screen">
        <l-cardio
          size="50" // pulse for loading animation
          stroke="4"
          speed="2"
          color="black"
        ></l-cardio>
      </div>
    );
  }

  if (!group) {
    return <div>Loading...</div>;
  }

  return (
    <div className="bg-white min-h-screen">
      {/* Modern Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => handleBack()}
            className="p-2 rounded-lg bg-[rgba(0,0,0,0)] hover:bg-gray-100 transition-colors duration-200"
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
          <div className="flex flex-col text-left">
            <h1 className="text-xl font-semibold text-gray-900 leading-tight">
              Patients
            </h1>
            <p className="text-sm text-gray-500">
              Select a case to continue training
            </p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium transition-colors duration-200"
        >
          Sign Out
        </button>
      </header>

      <div className="p-6">
        <div className="flex justify-center">
          {data.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-100">
                <svg
                  className="w-12 h-12 text-emerald-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                No patients available
              </h3>
              <p className="text-gray-500 max-w-md mx-auto">
                There are currently no patients assigned to this simulation
                group.
              </p>
            </div>
          ) : (
            <div className="w-full max-w-6xl">
              <TableContainer
                component={Paper}
                sx={{
                  borderRadius: "16px",
                  boxShadow:
                    "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.05)",
                  border: "1px solid #e5e7eb",
                  overflow: "hidden",
                }}
              >
                <Table>
                  <TableHead>
                    <TableRow sx={{ backgroundColor: "#f9fafb" }}>
                      <TableCell
                        sx={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          letterSpacing: ".05em",
                          textTransform: "uppercase",
                          color: "#374151",
                          borderBottom: "2px solid #e5e7eb",
                          py: 2.5,
                        }}
                      >
                        Patient
                      </TableCell>
                      <TableCell
                        sx={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          letterSpacing: ".05em",
                          textTransform: "uppercase",
                          color: "#374151",
                          borderBottom: "2px solid #e5e7eb",
                          py: 2.5,
                        }}
                      >
                        LLM Evaluation
                      </TableCell>
                      <TableCell
                        sx={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          letterSpacing: ".05em",
                          textTransform: "uppercase",
                          color: "#374151",
                          borderBottom: "2px solid #e5e7eb",
                          py: 2.5,
                        }}
                      >
                        Instructor Evaluation
                      </TableCell>
                      <TableCell
                        sx={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          letterSpacing: ".05em",
                          textTransform: "uppercase",
                          color: "#374151",
                          borderBottom: "2px solid #e5e7eb",
                          py: 2.5,
                        }}
                      >
                        Review
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.map((entry, index) => (
                      <TableRow
                        key={entry.patient_id + index}
                        hover
                        sx={{ transition: "background-color .15s" }}
                      >
                        <TableCell sx={{ fontSize: "0.95rem" }}>
                          <div className="flex flex-row gap-3 items-center">
                            <Avatar
                              src={profilePictures[entry.patient_id] || ""}
                              alt={`${titleCase(entry.patient_name)} profile`}
                              sx={{
                                width: 44,
                                height: 44,
                                backgroundColor: "#f0fdf4",
                                color: "#065f46",
                                fontSize: "0.9rem",
                                fontWeight: 600,
                              }}
                            >
                              {!profilePictures[entry.patient_id] &&
                                titleCase(entry.patient_name).charAt(0)}
                            </Avatar>
                            <div className="flex flex-col">
                              <span className="text-gray-900 font-medium">
                                {titleCase(entry.patient_name)}
                              </span>
                              <span className="text-xs text-gray-500 tracking-wide uppercase">
                                Case #{index + 1}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell sx={{ fontSize: "0.9rem" }}>
                          {entry.llm_completion ? (
                            entry.patient_score === 100 ? (
                              <span className="bg-emerald-500/90 text-white rounded-lg px-3 py-1 text-sm font-medium inline-block">
                                Complete
                              </span>
                            ) : (
                              "Incomplete"
                            )
                          ) : (
                            <span className="bg-gray-400 text-white rounded-lg px-3 py-1 text-sm font-medium inline-block">
                              LLM is not checking
                            </span>
                          )}
                        </TableCell>
                        <TableCell sx={{ fontSize: "0.9rem" }}>
                          {completionStatuses[entry.patient_name] ? (
                            <span className="bg-emerald-500/90 text-white rounded-lg px-3 py-1 text-sm font-medium inline-block">
                              Complete
                            </span>
                          ) : (
                            "Incomplete"
                          )}
                        </TableCell>
                        <TableCell sx={{ fontSize: "0.9rem" }}>
                          <Button
                            variant="contained"
                            onClick={() => enterPatient(entry)}
                            sx={{
                              textTransform: "none",
                              fontSize: "0.8rem",
                              backgroundColor: "#10b981",
                              borderRadius: "10px",
                              fontWeight: 600,
                              px: 2.5,
                              py: 1,
                              boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                              "&:hover": {
                                backgroundColor: "#059669",
                                boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
                              },
                            }}
                          >
                            Review
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GroupView;
