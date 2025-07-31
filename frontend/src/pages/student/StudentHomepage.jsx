import { useEffect, useState, useContext } from "react";
import StudentHeader from "../../components/StudentHeader";
import { fetchAuthSession } from "aws-amplify/auth";

import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// pulse for loading animation
import { cardio } from "ldrs";
cardio.register();

// MUI
import {
  Button,
  Typography,
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

      var token = session.tokens.idToken;
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

      var token = session.tokens.idToken;
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
    <div className="min-h-screen bg-gray-50">
      <ThemeProvider theme={theme}>
        <StudentHeader />

        {/* Main Content Container */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header Section */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <div>
                <Typography
                  component="h1"
                  variant="h3"
                  className="text-3xl font-bold text-gray-900 mb-2"
                >
                  Medical Training Groups
                </Typography>
                <Typography variant="body1" className="text-gray-600 text-lg">
                  Join simulation groups to practice patient interactions and
                  develop your medical communication skills
                </Typography>
              </div>

              {/* Join Group Button */}
              <Button
                onClick={handleClickOpen}
                variant="contained"
                sx={{
                  backgroundColor: "#10b981",
                  borderRadius: "12px",
                  textTransform: "none",
                  fontSize: "1rem",
                  fontWeight: "600",
                  px: 4,
                  py: 1.5,
                  boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                  transition: "all 0.2s ease-in-out",
                  "&:hover": {
                    backgroundColor: "#059669",
                    transform: "translateY(-2px)",
                    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                  },
                }}
              >
                + Join Group
              </Button>
            </div>
          </div>

          {/* Content Area */}
          {loading ? (
            <div className="flex items-center justify-center min-h-96">
              <div className="text-center">
                <l-cardio
                  size="50"
                  stroke="4"
                  speed="2"
                  color="#10b981"
                ></l-cardio>
                <Typography className="mt-4 text-gray-600 font-medium">
                  Loading your groups...
                </Typography>
              </div>
            </div>
          ) : groups.length === 0 ? (
            <div className="flex items-center justify-center min-h-96">
              <div className="text-center max-w-md">
                <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg
                    className="w-12 h-12 text-emerald-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                </div>
                <Typography
                  variant="h5"
                  className="text-gray-900 font-semibold mb-3"
                >
                  No groups yet
                </Typography>
                <Typography
                  variant="body1"
                  className="text-gray-600 mb-6 leading-relaxed"
                >
                  You haven't joined any simulation groups yet. Click "Join
                  Group" above to get started with your medical training
                  simulations.
                </Typography>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {groups.map((group, index) => (
                <div
                  key={index}
                  onClick={() => enterGroup(group)}
                  className="group cursor-pointer bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-xl hover:border-emerald-300 transition-all duration-300 hover:-translate-y-2 overflow-hidden"
                >
                  {/* Card Header */}
                  <div className="p-6 pb-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <Typography
                          variant="h6"
                          className="text-xl font-bold text-gray-900 mb-2 group-hover:text-emerald-700 transition-colors duration-200"
                        >
                          {titleCase(group.group_name)}
                        </Typography>
                        <Typography
                          variant="body2"
                          className="text-gray-500 font-medium"
                        >
                          Medical Simulation Group
                        </Typography>
                      </div>
                      <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center group-hover:bg-emerald-500 transition-colors duration-300 flex-shrink-0 ml-4">
                        <svg
                          className="w-6 h-6 text-emerald-600 group-hover:text-white transition-colors duration-300"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                          />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="px-6 pb-6">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        enterGroup(group);
                      }}
                      className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 transform hover:-translate-y-1 hover:shadow-lg"
                    >
                      Continue Training
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dialog for Join Group */}
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
            sx: {
              borderRadius: "16px",
              padding: "8px",
            },
          }}
        >
          <DialogTitle sx={{ pb: 1, fontSize: "1.5rem", fontWeight: "600" }}>
            Join Group
          </DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2, color: "#6b7280" }}>
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
              variant="outlined"
              sx={{
                "& .MuiOutlinedInput-root": {
                  borderRadius: "12px",
                  "&.Mui-focused fieldset": {
                    borderColor: "#10b981",
                  },
                },
                "& .MuiInputLabel-root.Mui-focused": {
                  color: "#10b981",
                },
              }}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button
              onClick={handleClose}
              sx={{
                borderRadius: "8px",
                textTransform: "none",
                color: "#6b7280",
                "&:hover": {
                  backgroundColor: "#f3f4f6",
                },
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              sx={{
                borderRadius: "8px",
                textTransform: "none",
                backgroundColor: "#10b981",
                "&:hover": {
                  backgroundColor: "#059669",
                },
              }}
            >
              Join
            </Button>
          </DialogActions>
        </Dialog>

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
      </ThemeProvider>
    </div>
  );
};

export default StudentHomepage;
