import { useEffect, useState, useContext } from "react";
import StudentHeader from "../../components/StudentHeader";
import Container from "../Container";
import { fetchAuthSession } from "aws-amplify/auth";

import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// pulse for loading animation
import { cardio } from 'ldrs'
cardio.register()

// MUI
import {
  Card,
  CardActions,
  CardContent,
  Button,
  Typography,
  Box,
  Grid,
  Stack,
  Skeleton,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { fetchUserAttributes } from "aws-amplify/auth";
import { useNavigate } from "react-router-dom";
import { UserContext } from "../../App";
// MUI theming
const { palette } = createTheme();
const { augmentColor } = palette;
const createColor = (mainColor) => augmentColor({ color: { main: mainColor } });
const theme = createTheme({
  palette: {
    primary: createColor("#10b981"),
    bg: createColor("#f8fafc"),
  },
});

function titleCase(str) {
  if (typeof str !== "string") {
    return str;
  }
  return str
    .toLowerCase()
    .split(" ")
    .map(function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export const StudentHomepage = ({ setGroup }) => {
  const navigate = useNavigate();

  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const { isInstructorAsStudent, setIsInstructorAsStudent } =
    useContext(UserContext);

  useEffect(() => {
    if (!loading && groups.length === 0) {
      handleClickOpen();
    }
  }, [loading, groups]);

  const enterGroup = (group) => {
    setGroup(group);
    sessionStorage.clear();
    sessionStorage.setItem("group", JSON.stringify(group));
    navigate(`/student_group`);
  };

  const handleJoin = async (code) => {
    try {
      const session = await fetchAuthSession();
      const { email } = await fetchUserAttributes();

      var token = session.tokens.idToken
      const response = await fetch(
        `${
          import.meta.env.VITE_API_ENDPOINT
        }student/enroll_student?student_email=${encodeURIComponent(
          email
        )}&group_access_code=${encodeURIComponent(code)}`,
        {
          method: "POST",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        toast.success("Successfully Joined Group!", {
          position: "top-center",
          autoClose: 1000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          progress: undefined,
          theme: "colored",
        });
        fetchGroups();
        handleClose();
      } else {
        console.error("Failed to fetch groups:", response.statusText);
        toast.error("Failed to Join Group", {
          position: "top-center",
          autoClose: 1000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          progress: undefined,
          theme: "colored",
        });
      }
    } catch (error) {
      console.error("Error fetching groups:", error);
      toast.error("Failed to Join Group", {
        position: "top-center",
        autoClose: 1000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: "colored",
      });
    }
  };

  const handleClickOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
  };

  const fetchGroups = async () => {
    try {
      const session = await fetchAuthSession();
      const { email } = await fetchUserAttributes();

      var token = session.tokens.idToken
      let response;
      if (isInstructorAsStudent) {
        response = await fetch(
          `${
            import.meta.env.VITE_API_ENDPOINT
          }instructor/student_group?email=${encodeURIComponent(email)}`,
          {
            method: "GET",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );
      } else {
        response = await fetch(
          `${
            import.meta.env.VITE_API_ENDPOINT
          }student/simulation_group?email=${encodeURIComponent(email)}`,
          {
            method: "GET",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );
      }
      if (response.ok) {
        const data = await response.json();
        setGroups(data);
        setLoading(false);
      } else {
        console.error("Failed to fetch group:", response.statusText);
      }
    } catch (error) {
      console.error("Error fetching group:", error);
    }
  };

  useEffect(() => {
    sessionStorage.removeItem("group");
    sessionStorage.removeItem("patient");

    fetchGroups();
  }, []);

  return (
    <div style={{ backgroundColor: "#f8fafc", minHeight: "100vh" }}>
      <ThemeProvider theme={theme}>
        <StudentHeader />
        <Container
          sx={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
            alignItems: "stretch",
            width: "100%",
            maxWidth: "100%",
            pb: 0,
            pt: 3,
          }}
        >
        <Stack
          sx={{
            flex: 1,
            width: "100%",
            maxWidth: "100%",
          }}
        >
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
              paddingLeft: 4,
              paddingRight: 5,
              mb: 4,
              pb: 3,
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            <Typography
              component="h1"
              variant="h4"
              sx={{
                fontWeight: "700",
                color: "#1f2937",
                fontSize: "2rem",
              }}
            >
              Groups
            </Typography>
            <Button
              variant="contained"
              sx={{
                borderRadius: "12px",
                backgroundColor: "#10b981",
                fontSize: "0.875rem",
                fontWeight: "600",
                textTransform: "none",
                px: 4,
                py: 1.5,
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
                transition: "all 0.2s ease-in-out",
                "&:hover": {
                  backgroundColor: "#059669",
                  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
                  transform: "translateY(-1px)",
                },
                "&:active": {
                  transform: "translateY(0)",
                },
              }}
              onClick={handleClickOpen}
            >
              Join Group
            </Button>
          </Box>
          {loading ? (
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "80vh",
                width: "100%",
              }}
            >     
              <l-cardio
                size="50"
                stroke="4"
                speed="2" 
                color="#10b981" 
              ></l-cardio>
            </Box>
          ) : (
            <Box
              paddingLeft={3}
              paddingRight={3} // Added paddingRight
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: groups.length === 0 ? "center" : "flex-start",
                justifyContent: groups.length === 0 ? "center" : "flex-start",
                width: "100%",
                height: "calc(90vh - 100px)",
                overflowY: "auto",
                overflowX: "hidden",
              }}
            >
              {groups.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <Typography
                    variant="h6"
                    sx={{
                      color: "#374151",
                      fontWeight: "600",
                      mb: 2,
                      fontSize: "1.25rem",
                    }}
                  >
                    No groups yet
                  </Typography>
                  <Typography
                    variant="body1"
                    sx={{
                      color: "#6b7280",
                      mb: 4,
                      maxWidth: "400px",
                      mx: "auto",
                      lineHeight: 1.6,
                    }}
                  >
                    You haven't joined any simulation groups yet. Click "Join Group" above to get started with your medical training simulations.
                  </Typography>
                </div>
              ) : (
                <div className="w-full max-w-6xl mx-auto">
                  <Grid container spacing={4} sx={{ width: "100%" }}>
                    {groups.map((group, index) => (
                      <Grid item xs={12} sm={6} lg={4} key={index}>
                        <Card
                          sx={{
                            height: "100%",
                            display: "flex",
                            flexDirection: "column",
                            borderRadius: "20px",
                            border: "1px solid #e5e7eb",
                            backgroundColor: "white",
                            boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)",
                            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                            cursor: "pointer",
                            "&:hover": {
                              transform: "translateY(-8px)",
                              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
                              borderColor: "#10b981",
                              "& .group-icon": {
                                backgroundColor: "#10b981",
                                color: "white",
                              },
                              "& .continue-btn": {
                                backgroundColor: "#059669",
                                transform: "translateY(-2px)",
                              },
                            },
                          }}
                          onClick={() => enterGroup(group)}
                        >
                          {/* Card Header with Icon */}
                          <Box
                            sx={{
                              p: 4,
                              pb: 2,
                              display: "flex",
                              alignItems: "flex-start",
                              justifyContent: "space-between",
                            }}
                          >
                            <Box sx={{ flex: 1 }}>
                              <Typography
                                variant="h5"
                                sx={{
                                  fontWeight: "700",
                                  fontSize: "1.5rem",
                                  color: "#1f2937",
                                  mb: 1,
                                  lineHeight: "1.2",
                                }}
                              >
                                {titleCase(group.group_name)}
                              </Typography>
                              <Typography
                                variant="body2"
                                sx={{
                                  color: "#6b7280",
                                  fontSize: "0.875rem",
                                  fontWeight: "500",
                                }}
                              >
                                Medical Simulation Group
                              </Typography>
                            </Box>
                            <Box
                              className="group-icon"
                              sx={{
                                width: 48,
                                height: 48,
                                borderRadius: "12px",
                                backgroundColor: "#f3f4f6",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                transition: "all 0.3s ease",
                                flexShrink: 0,
                                ml: 2,
                              }}
                            >
                              <svg
                                width="24"
                                height="24"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                style={{ color: "#6b7280" }}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                                />
                              </svg>
                            </Box>
                          </Box>

                          {/* Card Content */}
                          <Box sx={{ p: 4, pt: 0, flex: 1 }}>
                            <Typography
                              variant="body2"
                              sx={{
                                color: "#9ca3af",
                                fontSize: "0.8rem",
                                fontWeight: "500",
                                mb: 3,
                                lineHeight: "1.5",
                              }}
                            >
                              Interactive AI-powered patient simulations for medical training and empathy development
                            </Typography>
                          </Box>

                          {/* Card Footer */}
                          <Box sx={{ p: 4, pt: 0 }}>
                            <Button
                              className="continue-btn"
                              fullWidth
                              variant="contained"
                              sx={{
                                borderRadius: "12px",
                                backgroundColor: "#10b981",
                                color: "white",
                                fontWeight: "600",
                                textTransform: "none",
                                py: 1.5,
                                fontSize: "0.875rem",
                                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                                transition: "all 0.3s ease",
                                "&:hover": {
                                  backgroundColor: "#059669",
                                  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                                },
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                enterGroup(group);
                              }}
                            >
                              Continue Training
                            </Button>
                          </Box>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                </div>
              )}
            </Box>
          )}
        </Stack>
      </Container>
      <Dialog
        open={open}
        onClose={handleClose}
        PaperProps={{
          component: "form",
          onSubmit: (event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const formJson = Object.fromEntries(formData.entries());
            const code = formJson.code;
            handleJoin(code);
          },
        }}
      >
        <DialogTitle>Join Group</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Please enter the access code provided by an instructor.
          </DialogContentText>
          <TextField
            autoFocus
            required
            margin="dense"
            id="name"
            name="code"
            label="Access Code"
            fullWidth
            variant="standard"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button type="submit">Join</Button>
        </DialogActions>
      </Dialog>
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
      </ThemeProvider>
    </div>
  );
};

export default StudentHomepage;
