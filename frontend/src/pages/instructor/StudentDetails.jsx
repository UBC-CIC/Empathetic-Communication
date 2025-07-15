import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { fetchAuthSession, fetchUserAttributes } from "aws-amplify/auth";
import { toast, ToastContainer } from "react-toastify";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import "react-toastify/dist/ReactToastify.css";
import PageContainer from "../Container";
import {
  Box,
  Typography,
  Divider,
  Button,
  Paper,
  IconButton,
  Tabs,
  Tab,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Switch,
  FormControlLabel,
  Tooltip,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import jsPDF from "jspdf";

const handleBackClick = () => {
  window.history.back();
};

// Formatting messages for PDF export
const formatMessagesForPDF = (messages, studentName, patientName) =>
  messages
    .map(
      (msg) =>
        `${msg.student_sent ? `${studentName} (Student)` : `${patientName} (LLM)`}: ${msg.message_content.trim()}`
    )
    .join("\n");

const formatNotesForPDF = (notes) =>
  `Notes: ${notes || "No notes taken."}`;

// Helper function to format chat messages with distinct styling
const formatMessages = (messages, studentName, patientName) => {
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "Invalid Date";
    return date
      .toLocaleDateString(undefined, {
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/\//g, "-");
  };

  const groupedMessages = messages.reduce((acc, message) => {
    const date = formatDate(message.time_sent);
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(message);
    return acc;
  }, {});

  return Object.keys(groupedMessages).map((date) => (
    <Box key={date} sx={{ my: 2 }}>
      <Typography variant="body2" sx={{ fontWeight: "bold", mb: 1 }}>
        {date}
      </Typography>
      {groupedMessages[date].map((message, idx) => (
        <Box
          key={idx}
          sx={{
            backgroundColor: message.student_sent ? "lightgreen" : "lightblue",
            borderRadius: 2,
            p: 1,
            mb: 1,
            maxWidth: "80%",
            alignSelf: message.student_sent ? "flex-end" : "flex-start",
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: "bold" }}>
            {message.student_sent ? `${studentName} (Student)` : `${patientName} (LLM)`}
          </Typography>
          <Typography variant="body1">{message.message_content.trim()}</Typography>
        </Box>
      ))}
    </Box>
  ));
};

// Helper function to format notes consistently
const formatNotes = (noteText) => (
  <Box
    sx={{
      backgroundColor: "lightyellow",
      borderRadius: 2,
      p: 1,
      mt: 2,
      whiteSpace: "pre-line",
    }}
  >
    <Typography variant="body2" sx={{ fontWeight: "bold" }}>
      Notes:
    </Typography>
    <Typography variant="body1">{noteText || "No notes available."}</Typography>
  </Box>
);

const StudentDetails = () => {
  const { studentId } = useParams();
  const simulation_group_id = localStorage.getItem("selectedGroupId");
  const student = JSON.parse(localStorage.getItem("selectedStudent"));
  const [tabs, setTabs] = useState([]);
  const [sessions, setSessions] = useState({});
  const [activeTab, setActiveTab] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [completionStatuses, setCompletionStatuses] = useState([]);
  const [empathySummary, setEmpathySummary] = useState(null);
  const [empathyDialogOpen, setEmpathyDialogOpen] = useState(false);
  const sessionRefs = useRef({});
  

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens.idToken;
        const response = await fetch(
          `${
            import.meta.env.VITE_API_ENDPOINT
          }instructor/student_patients_messages?simulation_group_id=${encodeURIComponent(
            simulation_group_id
          )}&student_email=${encodeURIComponent(student.email)}`,
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
          setTabs(Object.keys(data)); // Tabs will represent patient names
        } else {
          console.error("Failed to fetch student data:", response.statusText);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchHistory();
  }, [simulation_group_id, student.email]);

  useEffect(() => {
    const fetchCompletionStatuses = async () => {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens.idToken;
        const response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT            
          }instructor/get_completion_status?simulation_group_id=${encodeURIComponent(
            simulation_group_id
          )}&student_email=${encodeURIComponent(student.email)}`,
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
          setCompletionStatuses(data); // Set state with completion statuses
        } else {
          console.error("Failed to fetch completion statuses:", response.statusText);
        }
      } catch (error) {
        console.error("Error fetching completion statuses:", error);
      }
    };
  
    fetchCompletionStatuses();
  }, [simulation_group_id, student.email]);

  const toggleCompletionStatus = async (studentInteractionId) => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken;
      const response = await fetch(
        `${import.meta.env.VITE_API_ENDPOINT          
        }instructor/toggle_completion?student_interaction_id=${studentInteractionId}`,
        {
          method: "PUT",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );
  
      if (response.ok) {
        const data = await response.json();
        setCompletionStatuses((prevStatuses) =>
          prevStatuses.map((status) =>
            status.student_interaction_id === studentInteractionId
              ? { ...status, is_completed: data.is_completed }
              : status
          )
        );
      } else {
        console.error("Failed to toggle completion status:", response.statusText);
      }
    } catch (error) {
      console.error("Error toggling completion status:", error);
    }
  };

  const handleDialogOpen = () => {
    setDialogOpen(true);
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
  };

  const handleEmpathyDialogOpen = () => {
    setEmpathyDialogOpen(true);
  };

  const handleEmpathyDialogClose = () => {
    setEmpathyDialogOpen(false);
  };

  const handleUnenroll = async () => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken;
      const { email } = await fetchUserAttributes();
      const response = await fetch(
        `${
          import.meta.env.VITE_API_ENDPOINT
        }instructor/delete_student?simulation_group_id=${encodeURIComponent(
          simulation_group_id
        )}&user_email=${encodeURIComponent(
          student.email
        )}&instructor_email=${encodeURIComponent(email)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );
      if (response.ok) {
        toast.success("Student unenrolled successfully", {
          position: "top-center",
          autoClose: 1000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          progress: undefined,
          theme: "colored",
        });
        setTimeout(() => {
          window.history.back();
        }, 1000);
      } else {
        toast.error("Failed to unenroll student", {
          position: "top-center",
          autoClose: 1000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          progress: undefined,
          theme: "colored",
        });
        console.error("Failed to unenroll student:", response.statusText);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  const handleDownloadChatPDF = (session, patientName) => {
    const pdf = new jsPDF("p", "mm", "a4");
    pdf.setFontSize(12);
    const pageWidth = pdf.internal.pageSize.width;
    const margin = 10;
    const maxLineWidth = pageWidth - 2 * margin;
    let yOffset = 10;

    pdf.text(`Session Chat: ${session.sessionName}`, margin, yOffset);
    yOffset += 10;

    const messages = formatMessagesForPDF(session.messages, studentId, patientName);

    messages.split("\n").forEach((line, index, lines) => {
      const splitLine = pdf.splitTextToSize(line, maxLineWidth);

      splitLine.forEach((textLine) => {
        if (yOffset > 280) {
          pdf.addPage();
          yOffset = 10;
        }
        pdf.text(textLine, margin, yOffset);
        yOffset += 8;
      });

      if (lines[index + 1]) {
        yOffset += 8;
      }
    });

    pdf.save(`${studentId}-${session.sessionName}-chat.pdf`);
  };

  const handleDownloadNotesPDF = (session) => {
    const pdf = new jsPDF("p", "mm", "a4");
    pdf.setFontSize(12);
    const margin = 10;
    let yOffset = 10;

    pdf.text(`Session Notes: ${session.sessionName}`, margin, yOffset);
    yOffset += 10;

    const notes = formatNotesForPDF(session.notes);
    const notesContent = notes.split("\n");

    notesContent.forEach((line) => {
      if (yOffset > 280) {
        pdf.addPage();
        yOffset = 10;
      }
      pdf.text(line, margin, yOffset);
      yOffset += 8;
    });

    pdf.save(`${studentId}-${session.sessionName}-notes.pdf`);
  };

  const fetchEmpathySummary = async () => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken;
      const response = await fetch(
        `${import.meta.env.VITE_API_ENDPOINT}instructor/empathy_summary?simulation_group_id=${encodeURIComponent(
          simulation_group_id
        )}&student_email=${encodeURIComponent(student.email)}`,
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
        handleEmpathyDialogOpen();
      } else {
        toast.error("Failed to fetch empathy summary", {
          position: "top-center",
          autoClose: 3000,
        });
      }
    } catch (error) {
      console.error("Error fetching empathy summary:", error);
      toast.error("Error fetching empathy summary", {
        position: "top-center",
        autoClose: 3000,
      });
    }
  };

  
  

  return (
    <>
      <PageContainer>
        <IconButton
          onClick={handleBackClick}
          sx={{ position: "absolute", top: 44, left: 30 }}
          aria-label="Go back"
        >
          <ArrowBackIcon />
        </IconButton>
        <Paper
          sx={{
            width: "100%",
            overflow: "auto",
            padding: 2,
            overflowY: "scroll",
            marginTop: 4,
          }}
        >
          <Box mb={2} sx={{ flexGrow: 1, p: 3, textAlign: "left", mt: 6 }}>
            <Typography variant="h5">Student Name: {studentId}</Typography>
            <Divider sx={{ my: 2 }} />
            <Typography variant="body1">Email: {student.email}</Typography>

            <Box sx={{ display: 'flex', gap: 2, marginBottom: 6 }}>
              <Button
                onClick={handleDialogOpen}
                variant="contained"
                color="primary"
              >
                Unenroll Student
              </Button>
              <Button
                onClick={fetchEmpathySummary}
                variant="contained"
                color="secondary"
              >
                View Empathy Coach Summary
              </Button>
            </Box>

            <Dialog
              open={dialogOpen}
              onClose={handleDialogClose}
              aria-labelledby="confirm-unenroll-dialog"
            >
              <DialogTitle id="confirm-unenroll-dialog">
                Confirm Unenroll
              </DialogTitle>
              <DialogContent>
                <DialogContentText>
                  Are you sure you want to unenroll {studentId} from this
                  simulation group?
                </DialogContentText>
              </DialogContent>
              <DialogActions>
                <Button onClick={handleDialogClose} color="primary">
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    handleDialogClose();
                    handleUnenroll();
                  }}
                  color="error"
                >
                  Confirm
                </Button>
              </DialogActions>
            </Dialog>

            <Dialog
              open={empathyDialogOpen}
              onClose={handleEmpathyDialogClose}
              maxWidth="md"
              fullWidth
            >
              <DialogTitle>Empathy Coach Summary - {studentId}</DialogTitle>
              <DialogContent>
                {empathySummary ? (
                  <Box>
                    <Typography variant="h6" sx={{ mb: 2 }}>
                      Overall Empathy Performance
                    </Typography>
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="body1" sx={{ mb: 1 }}>
                        <strong>Average Empathy Score:</strong> {empathySummary.overall_score}/5 
                        ({empathySummary.overall_level})
                      </Typography>
                      <Typography variant="body1" sx={{ mb: 1 }}>
                        <strong>Total Interactions:</strong> {empathySummary.total_interactions}
                      </Typography>
                      <Typography variant="body1" sx={{ mb: 2 }}>
                        <strong>Interactions with Empathy Feedback:</strong> {empathySummary.empathy_interactions}
                      </Typography>
                    </Box>
                    
                    <Typography variant="h6" sx={{ mb: 2 }}>
                      Category Breakdown
                    </Typography>
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="body2">• Perspective-Taking: {empathySummary.avg_perspective_taking}/5</Typography>
                      <Typography variant="body2">• Emotional Resonance: {empathySummary.avg_emotional_resonance}/5</Typography>
                      <Typography variant="body2">• Acknowledgment: {empathySummary.avg_acknowledgment}/5</Typography>
                      <Typography variant="body2">• Language & Communication: {empathySummary.avg_language_communication}/5</Typography>
                      <Typography variant="body2">• Cognitive Empathy: {empathySummary.avg_cognitive_empathy}/5</Typography>
                      <Typography variant="body2">• Affective Empathy: {empathySummary.avg_affective_empathy}/5</Typography>
                    </Box>

                    <Typography variant="h6" sx={{ mb: 2 }}>
                      Empathy Summary
                    </Typography>
                    <Paper sx={{ p: 2, backgroundColor: '#f5f5f5' }}>
                      <Typography variant="body1" sx={{ whiteSpace: 'pre-line' }}>
                        {empathySummary.summary}
                      </Typography>
                    </Paper>
                  </Box>
                ) : (
                  <Typography>Loading empathy summary...</Typography>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={handleEmpathyDialogClose} color="primary">
                  Close
                </Button>
              </DialogActions>
            </Dialog>

            <Typography variant="h5" sx={{ mb: 2 }}>
              Chat History:
            </Typography>

            <Box
              sx={{
                borderBottom: 1,
                borderColor: "divider",
                overflowX: "auto",
              }}
            >
              <Tabs
                value={activeTab}
                onChange={(_, newValue) => setActiveTab(newValue)}
                variant="scrollable"
                scrollButtons="auto"
              >
                {tabs.map((tabName, index) => (
                  <Tab key={index} label={tabName} />
                ))}
              </Tabs>
            </Box>

            {sessions[tabs[activeTab]]?.length > 0 ? (
              sessions[tabs[activeTab]].map((session, index) => (
                <Accordion key={index}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography>{session.sessionName}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box
                      ref={(el) => (sessionRefs.current[session.sessionName] = el)}
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        maxHeight: 400,
                        overflowY: "auto",
                      }}
                    >
                      {formatMessages(session.messages, studentId, tabs[activeTab])}
                      {formatNotes(session.notes)}
                    </Box>
                    
                    {/* Button for downloading only the chat responses */}
                    <Button
                      onClick={() => handleDownloadChatPDF(session, tabs[activeTab])}
                      variant="contained"
                      color="secondary"
                      sx={{ mt: 2, mr: 2 }}
                    >
                      Download Chat PDF
                    </Button>

                    {/* Button for downloading only the notes */}
                    <Button
                      onClick={() => handleDownloadNotesPDF(session)}
                      variant="contained"
                      color="secondary"
                      sx={{ mt: 2 }}
                    >
                      Download Notes PDF
                    </Button>
                  </AccordionDetails>
                </Accordion>
              ))
            ) : (
              <Typography sx={{ ml: 2, mt: 4 }} variant="body1">
                Student does not have chat history.
              </Typography>
            )}


            {/* Tooltip-wrapped Completion Switch with student's name */}
            {/* <Tooltip title={`Manually set the completion status for ${studentId}`} arrow>
              <FormControlLabel
                control={
                  <Switch
                    checked={completion}
                    onChange={() => setCompletion((prev) => !prev)}
                  />
                }
                label="Completion"
                sx={{ mt: 4 }}
              />
            </Tooltip> */}
            <Typography variant="h5" sx={{ mt: 4, mb: 2 }}>
              Patient Completion Status:
            </Typography>
            {/* Render each patient's completion status with toggle */}
            {completionStatuses.map((status) => (
              <Tooltip
                key={status.student_interaction_id}
                title={`Toggle completion status for ${status.patient_name}`}
                arrow
              >
                <FormControlLabel
                  control={
                    <Switch
                      checked={status.is_completed}
                      onChange={() => toggleCompletionStatus(status.student_interaction_id)}
                    />
                  }
                  label={`${status.patient_name} Completion`}
                  sx={{ mt: 2 }}
                />
              </Tooltip>
            ))}
          </Box>
        </Paper>
      </PageContainer>
      <ToastContainer />
    </>
  );
};

export default StudentDetails;
