import { useState, useEffect } from "react";
import {
  TextField,
  Button,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
  Box,
  Chip,
  Typography,
  OutlinedInput,
  FormControlLabel,
  Switch,
  Paper,
  Toolbar,
  Autocomplete,
} from "@mui/material";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { fetchAuthSession } from "aws-amplify/auth";

const CHARACTER_LIMIT = 1000;

function generateAccessCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 16; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Format the code into the pattern XXXX-XXXX-XXXX-XXXX
  return code.match(/.{1,4}/g).join("-");
}

function formatInstructors(instructorsArray) {
  return instructorsArray.map((instructor, index) => ({
    id: index + 1,
    name:
      instructor.first_name && instructor.last_name
        ? `${instructor.first_name} ${instructor.last_name}`
        : instructor.user_email,
    email: instructor.user_email,
  }));
}

export const AdminCreateSimulationGroup = ({ setSelectedComponent }) => {
  const [simulationGroupName, setSimulationGroupName] = useState("");
  const [simulationGroupPrompt, setSimulationGroupPrompt] = useState(
    `Pretend to be a patient with the context you are given. You are helping the pharmacist practice their skills interacting with a patient. Engage with the pharmacist by describing your symptoms to provide them hints on what condition(s) you have. If you feel like the pharmacist is going down the wrong path, nudge them in the right direction by giving them more information. This is to help the pharmacist identify the proper diagnosis of the patient you are pretending to be.`
  );
  const [groupDescription, setGroupDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [empathyEnabled, setEmpathyEnabled] = useState(true);
  const [adminVoiceEnabled, setAdminVoiceEnabled] = useState(true);
  const [instructorVoiceEnabled, setInstructorVoiceEnabled] = useState(true);
  const [selectedInstructors, setSelectedInstructors] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const handleStatusChange = (event) => {
    setIsActive(event.target.checked);
  };

  const handleSimulationGroupCodeChange = (e) => {
    const value = e.target.value;
    if (/^\d*$/.test(value)) {
      // This regex ensures only digits
      setSimulationGroupCode(value); 
    }
  };
  useEffect(() => {
    const fetchInstructors = async () => {
      try {
        const session = await fetchAuthSession();
        var token = session.tokens.idToken
        //replace if analytics for admin actions is needed
        const response = await fetch(
          `${
            import.meta.env.VITE_API_ENDPOINT
          }admin/instructors?instructor_email=replace`,
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
          setInstructors(formatInstructors(data));
        } else {
          console.error("Failed to fetch instructors:", response.statusText);
        }
      } catch (error) {
        console.error("Error fetching instructors:", error);
      }
    };

    fetchInstructors();
  }, []);
  const handleCreate = async () => {
    // Validation
    if (!simulationGroupName.trim()) {
      toast.error("Group Name is required", {
        position: "top-center",
        autoClose: 2000,
        theme: "colored",
      });
      setSubmitting(false);
      return;
    }
    if (!groupDescription.trim()) {
      toast.error("Group Description is required", {
        position: "top-center",
        autoClose: 2000,
        theme: "colored",
      });
      setSubmitting(false);
      return;
    }

    const access_code = generateAccessCode();
    // Handle the create simulationGroup logic here
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken

      const response = await fetch(
        `${
          import.meta.env.VITE_API_ENDPOINT
        }admin/create_simulation_group?group_name=${encodeURIComponent(
          simulationGroupName
        )}&group_description=${encodeURIComponent(
          groupDescription
        )}&group_access_code=${encodeURIComponent(
          access_code
        )}&group_student_access=${encodeURIComponent(isActive)}&empathy_enabled=${encodeURIComponent(empathyEnabled)}&admin_voice_enabled=${encodeURIComponent(adminVoiceEnabled)}&instructor_voice_enabled=${encodeURIComponent(instructorVoiceEnabled)}`,
        {
          method: "POST",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            system_prompt: simulationGroupPrompt,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const { simulation_group_id } = data;   
        console.log('selectedInstructors',selectedInstructors)     
        const enrollPromises = selectedInstructors.map((instructor) =>
          fetch(
            `${
              import.meta.env.VITE_API_ENDPOINT
            }admin/enroll_instructor?simulation_group_id=${encodeURIComponent(
              simulation_group_id
            )}&instructor_email=${encodeURIComponent(instructor.email)}`,
            {
              method: "POST",
              headers: {
                Authorization: token,
                "Content-Type": "application/json",
              },
            }
          ).then((enrollResponse) => {
            if (enrollResponse.ok) {
              return enrollResponse.json().then((enrollData) => {
                return { success: true };
              });
            } else {
              console.error(
                "Failed to enroll instructor:",
                enrollResponse.statusText
              );
              toast.error("Enroll Instructor Failed", {
                position: "top-center",
                autoClose: 1000,
                hideProgressBar: false,
                closeOnClick: true,
                pauseOnHover: true,
                draggable: true,
                progress: undefined,
                theme: "colored",
              });
              return { success: false };
            }
          })
        );

        const enrollResults = await Promise.all(enrollPromises);
        const allEnrolledSuccessfully = enrollResults.every(
          (result) => result.success
        );

        if (allEnrolledSuccessfully || selectedInstructors.length === 0) {
          toast.success("Simulation Group Created!", {
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
            setSelectedComponent("AdminSimulationGroups");
          }, 1000);
        } else {
          toast.error("Some instructors could not be enrolled", {
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
      } else {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || response.statusText || "Unknown error";
        console.error("Failed to create simulation group:", errorMessage);
        toast.error(`Creation Failed: ${errorMessage}`, {
          position: "top-center",
          autoClose: 3000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          progress: undefined,
          theme: "colored",
        });
      }
    } catch (error) {
      console.error("Error creating simulation group:", error);
      toast.error(`Creation Failed: ${error.message || "Network error"}`, {
        position: "top-center",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: "colored",
        transition: "Bounce",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (event, newValue) => {
    setSelectedInstructors(newValue);
  };
  return (
    <Box
      component="main"
      sx={{
        width: "100%",
        overflowY: "auto",
        flexGrow: 1,
        p: 2,
        marginTop: 0.5,
        marginBottom: 1,
      }}
    >
      <Toolbar />
      <Paper
        sx={{
          maxWidth: "800px",
          overflow: "hidden",
          marginTop: 1,
          marginBottom: 1,
          p: 4,
          borderRadius: 2,
        }}
      >
        <Typography
          color="black"
          fontStyle="semibold"
          textAlign="left"
          variant="h6"
        >
          Create a new Simulation Group
        </Typography>
        <form noValidate autoComplete="off">
          <TextField
            fullWidth
            label="Group Name"
            value={simulationGroupName}
            onChange={(e) => setSimulationGroupName(e.target.value)}
            margin="normal"
            backgroundColor="default"
            inputProps={{ maxLength: 50 }}
            required
          />
          <TextField
            fullWidth
            label="Group Description"
            value={groupDescription}
            onChange={(e) => setGroupDescription(e.target.value)}
            margin="normal"
            backgroundColor="default"
            inputProps={{ maxLength: 100 }}
            required
          />
          <TextField
            fullWidth
            label="System Prompt"
            value={simulationGroupPrompt}
            onChange={(e) => setSimulationGroupPrompt(e.target.value)}
            margin="normal"
            multiline
            rows={4}
            inputProps={{ maxLength: 1000 }}
            helperText={`${simulationGroupPrompt.length}/${CHARACTER_LIMIT}`}
          />
          <FormControl fullWidth sx={{ marginBottom: 2, marginTop: 2 }}>
            <Autocomplete
              multiple
              id="autocomplete-instructors"
              options={instructors}
              getOptionLabel={(option) => option.name}
              value={selectedInstructors}
              onChange={handleChange}
              isOptionEqualToValue={(option, value) =>
                option.email === value.email
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="outlined"
                  label="Assign Instructors"
                  placeholder="Search instructors"
                />
              )}
              renderTags={(tags, getTagProps) => (
                <Box
                  sx={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 0.5,
                  }}
                >
                  {tags.map((tag, index) => (
                    <Chip
                      key={tag.email}
                      label={tag.name}
                      {...getTagProps({ index })}
                    />
                  ))}
                </Box>
              )}
              filterSelectedOptions
            />
          </FormControl>
          <FormControlLabel
            control={
              <Switch checked={isActive} onChange={handleStatusChange} />
            }
            label={isActive ? "Active" : "Inactive"}
            sx={{
              color: "black",
              textAlign: "left",
              justifyContent: "flex-start",
            }}
          />
          <FormControlLabel
            control={
              <Switch 
                checked={empathyEnabled} 
                onChange={(e) => setEmpathyEnabled(e.target.checked)} 
              />
            }
            label="Enable empathy coach"
            sx={{
              color: "black",
              textAlign: "left",
              justifyContent: "flex-start",
            }}
          />
          <FormControlLabel
            control={
              <Switch 
                checked={adminVoiceEnabled} 
                onChange={(e) => setAdminVoiceEnabled(e.target.checked)} 
              />
            }
            label="Enable voice (Admin control)"
            sx={{
              color: "black",
              textAlign: "left",
              justifyContent: "flex-start",
            }}
          />
          <FormControlLabel
            control={
              <Switch 
                checked={instructorVoiceEnabled && adminVoiceEnabled} 
                onChange={(e) => setInstructorVoiceEnabled(e.target.checked)}
                disabled={!adminVoiceEnabled}
              />
            }
            label="Enable voice (Instructor control)"
            sx={{
              color: adminVoiceEnabled ? "black" : "gray",
              textAlign: "left",
              justifyContent: "flex-start",
            }}
          />
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 0.5,
              backgroundColor: "transparent",
              color: "black",
            }}
          >
            {selectedInstructors.map((instructor) => (
              <Chip key={instructor.email} label={instructor.name} />
            ))}
          </Box>
          <Button
            variant="contained"
            color="primary"
            onClick={() => {
              if (!submitting) {
                setSubmitting(true);
                handleCreate();
              }
            }}
            fullWidth
            sx={{ mt: 2 }}
          >
            CREATE
          </Button>
        </form>
        <ToastContainer
          position="top-center"
          autoClose={5000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="colored"
        />
      </Paper>
    </Box>
  );
};
export default AdminCreateSimulationGroup;
