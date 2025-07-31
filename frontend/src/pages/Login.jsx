import { useState } from "react";

// logo
import heartbeatImage from "../assets/heartbeat.png";


import './LoginStyles.css'; // Adjust the path if necessary


// amplify
import {
  signIn,
  signUp,
  confirmSignIn,
  confirmSignUp,
  resendSignUpCode,
  resetPassword,
  confirmResetPassword,
  fetchAuthSession,
} from "aws-amplify/auth";
// MUI
import {
  Button,
  CssBaseline,
  TextField,
  Link,
  Paper,
  Grid,
  Box,
  Typography,
} from "@mui/material";

import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
// login assets
import PageContainer from "./Container";
// cognito verifier
import { CognitoJwtVerifier } from "aws-jwt-verify";
// MUI theming
import { createTheme, ThemeProvider } from "@mui/material/styles";
const { palette } = createTheme();
const { augmentColor } = palette;
const createColor = (mainColor) => augmentColor({ color: { main: mainColor } });
const theme = createTheme({
  palette: {
    primary: createColor("#36bd78"),
    bg: createColor("#F8F9FD"),
  },
});

export const Login = () => {
  // auth account variables
  const [newSignUp, setNewSignUp] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [newPassword, setNewPassword] = useState(false);
  const [newUserPassword, setNewUserPassword] = useState(false);
  // auth status variables
  const [signUpConfirmation, setSignUpConfirmation] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [confirmationError, setConfirmationError] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [step, setStep] = useState("requestReset");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");


  const verifyJwtToken = async (token) => {
    try {
      const verifier = CognitoJwtVerifier.create({
        userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
        tokenUse: "id", // Can be either 'id' or 'access'
        clientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID,
      });
      // Verify the token
      const payload = await verifier.verify(token);

      // Check if 'groups' property is present
      if (payload["cognito:groups"]) {
        console.log("Groups:");
      } else {
        console.log("No groups found in the token.");
      }

      return payload;
    } catch (error) {
      console.error("Token verification failed:", error);
      throw new Error("Unauthorized jwt token");
    }
  };

  // existing user sign in
  const handleSignIn = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      const user = await signIn({
        username: username,
        password: password,
      });
      console.log(
        "USER SUCCESSFULLY LOGGED IN:",
        user.isSignedIn,
        user.nextStep.signInStep
      );
      if (!user.isSignedIn) {
        if (
          user.nextStep.signInStep ===
          "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"
        ) {
          setNewUserPassword(true);
          setLoading(false);
        } else if (user.nextStep.signInStep === "CONFIRM_SIGN_UP") {
          setSignUpConfirmation(true);
          setLoading(false);
        }
      } else {
        setNewSignUp(false);
        window.location.reload();
      }
    } catch (error) {
      toast.error(`Error logging in: ${error}`, {
        position: "top-center",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: "colored",
      });
      console.log("Error logging in:", error);
      setLoading(false);
    }
  };

  // user signs up
  const handleSignUp = async (event) => {
    event.preventDefault();

    // Check for empty fields
    if (!username || !password || !confirmPassword || !firstName || !lastName) {
      toast.error("All fields are required", {
        position: "top-center",
        autoClose: 3000,
        theme: "colored",
      });
      return;
    }

    // Password validation: match, length, uppercase, lowercase, and number
    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match");
      toast.error("Passwords do not match", { theme: "colored" });
      return;
    }

    if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters long");
      toast.error("Password must be at least 8 characters long", { theme: "colored" });
      return;
    }

    if (!/[a-z]/.test(password)) {
      setPasswordError("Password must contain at least one lowercase letter");
      toast.error("Password must contain at least one lowercase letter", { theme: "colored" });
      return;
    }

    if (!/[A-Z]/.test(password)) {
      setPasswordError("Password must contain at least one uppercase letter");
      toast.error("Password must contain at least one uppercase letter", { theme: "colored" });
      return;
    }

    if (!/[0-9]/.test(password)) {
      setPasswordError("Password must contain at least one number");
      toast.error("Password must contain at least one number", { theme: "colored" });
      return;
    }

    setPasswordError(""); // Clear any previous errors

    try {
      setLoading(true);
      console.log("signing up");

      const { isSignUpComplete, nextStep } = await signUp({
        username: username,
        password: password,
        attributes: {
          email: username,
        },
      });

      console.log("signed up successfully:", isSignUpComplete, nextStep);

      setNewSignUp(false);
      if (!isSignUpComplete && nextStep?.signUpStep === "CONFIRM_SIGN_UP") {
        setSignUpConfirmation(true); // Transition to confirmation UI
        toast.success("Account created. Check your email for the confirmation code.", {
          theme: "colored",
        });
      }
    } catch (error) {
      const errorMessage =
        error.message.includes("PreSignUp failed with error")
          ? "Your email domain is not allowed. Please use a valid email address."
          : `Error signing up: ${error.message}`;
      toast.error(errorMessage, {
        position: "top-center",
        autoClose: 3000,
        theme: "colored",
      });
      console.log("Error signing up:", error);
      setLoading(false);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };



  // user gets new password
  const handleNewUserPassword = async (event) => {
    event.preventDefault();
    const newPassword = event.target.newPassword.value;
    const confirmNewPassword = event.target.confirmNewPassword.value;

    if (newPassword !== confirmNewPassword) {
      setPasswordError("Passwords do not match!");
      toast.error(`Passwords do not match!`, {
        position: "top-center",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: "colored",
      });
      return;
    }
    setPasswordError("");
    try {
      setLoading(true);
      console.log("Setting new password for user:", username);
      const attributes = {};
      const user = await confirmSignIn({
        challengeResponse: newPassword,
        options: {
          userAttributes: attributes,
        },
      });
      console.log("User logged in:", user.isSignedIn, user.nextStep.signInStep);
      if (user.isSignedIn) {
        window.location.reload();
      }
    } catch (error) {
      toast.error(`Error: ${error}`, {
        position: "top-center",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: "colored",
      });
      console.log("Error setting new password:", error);
      setLoading(false);
      setNewUserPassword(false);
    }
  };

  // user signup confirmation
  const handleConfirmSignUp = async (event) => {
    event.preventDefault();
    const confirmationCode = event.target.confirmationCode.value;
    try {
      setLoading(true);
      await confirmSignUp({
        username: username,
        confirmationCode: confirmationCode,
      });

      console.log("code", confirmationCode);

      // Automatically log in the user
      const user = await signIn({
        username: username,
        password: password,
      });

      console.log("handle auto sign in", user.isSignedIn);

      if (user.isSignedIn) {
        // Send user data to backend
        const session = await fetchAuthSession();
        const token = session.tokens.idToken

        const response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT
          }student/create_user?user_email=${encodeURIComponent(
            username
          )}&username=${encodeURIComponent(
            username
          )}&first_name=${encodeURIComponent(
            firstName
          )}&last_name=${encodeURIComponent(
            lastName
          )}&preferred_name=${encodeURIComponent(firstName)}`,
          {
            method: "POST",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );
        const data = await response.json();
        console.log("Response from backend:", data);

        setLoading(false);
        setNewSignUp(false);
        window.location.reload();
      } else {
        setLoading(false);
        setError("Automatic login failed. Please try signing in manually.");
      }
    } catch (error) {
      toast.error(`Error: ${error}`, {
        position: "top-center",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: "colored",
      });
      console.log("Error confirming sign-up:", error);
      setLoading(false);
      setConfirmationError(error.message);
    }
  };

  const resendConfirmationCode = async () => {
    try {
      setLoading(true);
      await resendSignUpCode({ username: username });
      setLoading(false);
      setConfirmationError("");
    } catch (error) {
      toast.error(`Error: ${error}`, {
        position: "top-center",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: "colored",
      });
      console.log("Error resending confirmation code:", error);
      setLoading(false);
    }
  };

  // user reset password
  async function handleResetPassword(username) {
    try {
      const output = await resetPassword({ username });
      handleResetPasswordNextSteps(output);
    } catch (error) {
      toast.error(`Error Resetting Password`, {
        position: "top-center",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: "colored",
      });
      setMessage("");
    }
  }

  function handleResetPasswordNextSteps(output) {
    const { nextStep } = output;
    switch (nextStep.resetPasswordStep) {
      case "CONFIRM_RESET_PASSWORD_WITH_CODE":
        // eslint-disable-next-line no-case-declarations
        const codeDeliveryDetails = nextStep.codeDeliveryDetails;
        console.log(
          `Confirmation code was sent to ${codeDeliveryDetails.deliveryMedium}`
        );
        setMessage(
          `Confirmation code was sent to ${codeDeliveryDetails.deliveryMedium}`
        );
        setStep("confirmReset");
        break;
      case "DONE":
        setMessage("Successfully reset password.");
        setStep("done");
        console.log("Successfully reset password.");
        break;
    }
  }

  async function handleConfirmResetPassword(event) {
    event.preventDefault();
    try {
      await confirmResetPassword({
        username,
        confirmationCode,
        newPassword,
      });
      console.log("username", username);
      setMessage("Password successfully reset.");
      setStep("done");
      setError("");
    } catch (error) {
      toast.error(`Error: ${error}`, {
        position: "top-center",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: "colored",
      });
      console.log(error);
      console.log(username);
      console.log(confirmationCode);
      setError(error.message);
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <PageContainer>
        <Grid container component="main" sx={{ height: "100vh", bgcolor: "#f8fafc" }}>
          <CssBaseline />
          <Grid
            item
            xs={false}
            sm={3}
            md={5}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "40px",
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              position: "relative",
              overflow: "hidden",
              "&::before": {
                content: '""',
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><defs><pattern id=\"grain\" width=\"100\" height=\"100\" patternUnits=\"userSpaceOnUse\"><circle cx=\"50\" cy=\"50\" r=\"1\" fill=\"%23ffffff\" opacity=\"0.1\"/></pattern></defs><rect width=\"100\" height=\"100\" fill=\"url(%23grain)\"/></svg>') repeat",
                pointerEvents: "none",
              },
            }}
          >


            <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
              <img
                src={heartbeatImage}
                alt="Heartbeat"
                className='heartbeat-image'
                style={{
                  maxWidth: '35%',
                  display: 'block',
                  height: 'auto',
                  margin: '0 auto 20px',
                  animation: 'float 3s ease-in-out infinite',
                }}
              />
              <Typography
                variant="h3"
                sx={{
                  color: 'white',
                  fontWeight: '700',
                  fontSize: 'clamp(1.75rem, 3.5vw, 3rem)',
                  lineHeight: '1.1',
                  marginBottom: '12px',
                  textAlign: 'center',
                  textShadow: '0 2px 4px rgba(0,0,0,0.1)',
                }}
              >
                Welcome to
              </Typography>
              <Typography
                variant="h4"
                sx={{
                  color: 'rgba(255,255,255,0.95)',
                  fontWeight: '600',
                  fontSize: 'clamp(1.25rem, 2.5vw, 2rem)',
                  lineHeight: '1.2',
                  marginBottom: '8px',
                  textAlign: 'center',
                }}
              >
                Virtual Care Interactions
              </Typography>
              <Typography
                variant="h5"
                sx={{
                  color: 'rgba(255,255,255,0.9)',
                  fontWeight: '500',
                  fontSize: 'clamp(1rem, 2vw, 1.5rem)',
                  lineHeight: '1.3',
                  textAlign: 'center',
                }}
              >
                Powered by AI
              </Typography>
            </div>


          </Grid>

          {/* existing user sign in */}
          {!loading &&
            !newUserPassword &&
            !newSignUp &&
            !signUpConfirmation &&
            !forgotPassword && (
              <Grid
                item
                xs={12}
                sm={9}
                md={7}
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  height: "100%",
                  bgcolor: "white",
                  borderRadius: { sm: "20px 0 0 20px" },
                  boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                }}
              >
                <Box
                  sx={{
                    my: 8,
                    mx: 4,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    width: "100%",
                    maxWidth: "400px",
                  }}
                >
                  <Typography 
                    component="h1" 
                    variant="h4"
                    sx={{
                      color: "#1f2937",
                      fontWeight: "700",
                      marginBottom: "32px",
                      fontSize: "1.875rem",
                    }}
                  >
                    Sign in
                  </Typography>
                  <Box
                    component="form"
                    noValidate
                    onSubmit={handleSignIn}
                    sx={{ mt: 1, width: "100%" }}
                  >
                    <TextField
                      margin="normal"
                      required
                      fullWidth
                      id="email"
                      label="Email Address"
                      name="email"
                      autoComplete="email"
                      autoFocus
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      inputProps={{ maxLength: 40 }}
                      sx={{
                        mb: 2,
                        "& .MuiOutlinedInput-root": {
                          borderRadius: "12px",
                          backgroundColor: "#f9fafb",
                          transition: "all 0.2s ease-in-out",
                          "&:hover": {
                            backgroundColor: "#f3f4f6",
                          },
                          "&.Mui-focused": {
                            backgroundColor: "white",
                            boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.1)",
                          },
                          "& fieldset": {
                            borderColor: "#e5e7eb",
                          },
                          "&:hover fieldset": {
                            borderColor: "#10b981",
                          },
                          "&.Mui-focused fieldset": {
                            borderColor: "#10b981",
                            borderWidth: "2px",
                          },
                        },
                        "& .MuiInputLabel-root": {
                          color: "#6b7280",
                          "&.Mui-focused": {
                            color: "#10b981",
                          },
                        },
                      }}
                    />
                    <TextField
                      margin="normal"
                      required
                      fullWidth
                      name="password"
                      label="Password"
                      type="password"
                      id="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      inputProps={{ maxLength: 50 }}
                      sx={{
                        mb: 3,
                        "& .MuiOutlinedInput-root": {
                          borderRadius: "12px",
                          backgroundColor: "#f9fafb",
                          transition: "all 0.2s ease-in-out",
                          "&:hover": {
                            backgroundColor: "#f3f4f6",
                          },
                          "&.Mui-focused": {
                            backgroundColor: "white",
                            boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.1)",
                          },
                          "& fieldset": {
                            borderColor: "#e5e7eb",
                          },
                          "&:hover fieldset": {
                            borderColor: "#10b981",
                          },
                          "&.Mui-focused fieldset": {
                            borderColor: "#10b981",
                            borderWidth: "2px",
                          },
                        },
                        "& .MuiInputLabel-root": {
                          color: "#6b7280",
                          "&.Mui-focused": {
                            color: "#10b981",
                          },
                        },
                      }}
                    />
                    <Button
                      type="submit"
                      fullWidth
                      variant="contained"
                      sx={{ 
                        mt: 2, 
                        mb: 3,
                        py: 1.5,
                        borderRadius: "12px",
                        backgroundColor: "#10b981",
                        fontSize: "1rem",
                        fontWeight: "600",
                        textTransform: "none",
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
                    >
                      Sign In
                    </Button>
                    <Grid container spacing={2}>
                      <Grid item xs={6}>
                        <Link
                          href="#"
                          variant="body2"
                          onClick={() => setForgotPassword(true)}
                          sx={{
                            color: "#10b981",
                            textDecoration: "none",
                            fontWeight: "500",
                            transition: "color 0.2s ease-in-out",
                            "&:hover": {
                              color: "#059669",
                              textDecoration: "underline",
                            },
                          }}
                        >
                          Forgot password?
                        </Link>
                      </Grid>
                      <Grid item xs={6} sx={{ textAlign: "right" }}>
                        <Link
                          href="#"
                          variant="body2"
                          onClick={() => setNewSignUp(true)}
                          sx={{
                            color: "#10b981",
                            textDecoration: "none",
                            fontWeight: "500",
                            transition: "color 0.2s ease-in-out",
                            "&:hover": {
                              color: "#059669",
                              textDecoration: "underline",
                            },
                          }}
                        >
                          Create your account
                        </Link>
                      </Grid>
                    </Grid>
                  </Box>
                </Box>
              </Grid>
            )}
          {newSignUp && (
            <Grid
              item
              xs={12}
              sm={9}
              md={7}
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100%",
                bgcolor: "white",
                borderRadius: { sm: "20px 0 0 20px" },
                boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              }}
            >
              <Box
                sx={{
                  my: 8,
                  mx: 4,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  width: "100%",
                  maxWidth: "500px",
                }}
              >
                <Typography 
                  component="h1" 
                  variant="h4" 
                  sx={{
                    color: "#1f2937",
                    fontWeight: "700",
                    marginBottom: "32px",
                    fontSize: "1.875rem",
                  }}
                >
                  Create your account
                </Typography>
                <Box sx={{ mt: 1, width: "100%" }}>
                  <Grid container spacing={3}>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        autoComplete="given-name"
                        name="firstName"
                        required
                        fullWidth
                        id="firstName"
                        label="First Name"
                        autoFocus
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        inputProps={{ maxLength: 30 }}
                        sx={{
                          "& .MuiOutlinedInput-root": {
                            borderRadius: "12px",
                            backgroundColor: "#f9fafb",
                            transition: "all 0.2s ease-in-out",
                            "&:hover": {
                              backgroundColor: "#f3f4f6",
                            },
                            "&.Mui-focused": {
                              backgroundColor: "white",
                              boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.1)",
                            },
                            "& fieldset": {
                              borderColor: "#e5e7eb",
                            },
                            "&:hover fieldset": {
                              borderColor: "#10b981",
                            },
                            "&.Mui-focused fieldset": {
                              borderColor: "#10b981",
                              borderWidth: "2px",
                            },
                          },
                          "& .MuiInputLabel-root": {
                            color: "#6b7280",
                            "&.Mui-focused": {
                              color: "#10b981",
                            },
                          },
                        }}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        required
                        fullWidth
                        id="lastName"
                        label="Last Name"
                        name="lastName"
                        autoComplete="family-name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        inputProps={{ maxLength: 30 }}
                        sx={{
                          "& .MuiOutlinedInput-root": {
                            borderRadius: "12px",
                            backgroundColor: "#f9fafb",
                            transition: "all 0.2s ease-in-out",
                            "&:hover": {
                              backgroundColor: "#f3f4f6",
                            },
                            "&.Mui-focused": {
                              backgroundColor: "white",
                              boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.1)",
                            },
                            "& fieldset": {
                              borderColor: "#e5e7eb",
                            },
                            "&:hover fieldset": {
                              borderColor: "#10b981",
                            },
                            "&.Mui-focused fieldset": {
                              borderColor: "#10b981",
                              borderWidth: "2px",
                            },
                          },
                          "& .MuiInputLabel-root": {
                            color: "#6b7280",
                            "&.Mui-focused": {
                              color: "#10b981",
                            },
                          },
                        }}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        required
                        fullWidth
                        id="email"
                        label="Email Address"
                        name="email"
                        autoComplete="email"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        inputProps={{ maxLength: 40 }}
                        sx={{
                          "& .MuiOutlinedInput-root": {
                            borderRadius: "12px",
                            backgroundColor: "#f9fafb",
                            transition: "all 0.2s ease-in-out",
                            "&:hover": {
                              backgroundColor: "#f3f4f6",
                            },
                            "&.Mui-focused": {
                              backgroundColor: "white",
                              boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.1)",
                            },
                            "& fieldset": {
                              borderColor: "#e5e7eb",
                            },
                            "&:hover fieldset": {
                              borderColor: "#10b981",
                            },
                            "&.Mui-focused fieldset": {
                              borderColor: "#10b981",
                              borderWidth: "2px",
                            },
                          },
                          "& .MuiInputLabel-root": {
                            color: "#6b7280",
                            "&.Mui-focused": {
                              color: "#10b981",
                            },
                          },
                        }}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        required
                        fullWidth
                        name="password"
                        label="Password"
                        type="password"
                        id="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        inputProps={{ maxLength: 50 }}
                        sx={{
                          "& .MuiOutlinedInput-root": {
                            borderRadius: "12px",
                            backgroundColor: "#f9fafb",
                            transition: "all 0.2s ease-in-out",
                            "&:hover": {
                              backgroundColor: "#f3f4f6",
                            },
                            "&.Mui-focused": {
                              backgroundColor: "white",
                              boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.1)",
                            },
                            "& fieldset": {
                              borderColor: "#e5e7eb",
                            },
                            "&:hover fieldset": {
                              borderColor: "#10b981",
                            },
                            "&.Mui-focused fieldset": {
                              borderColor: "#10b981",
                              borderWidth: "2px",
                            },
                          },
                          "& .MuiInputLabel-root": {
                            color: "#6b7280",
                            "&.Mui-focused": {
                              color: "#10b981",
                            },
                          },
                        }}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        required
                        fullWidth
                        name="confirmPassword"
                        label="Confirm password"
                        type="password"
                        id="confirmPassword"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        inputProps={{ maxLength: 50 }}
                        sx={{
                          "& .MuiOutlinedInput-root": {
                            borderRadius: "12px",
                            backgroundColor: "#f9fafb",
                            transition: "all 0.2s ease-in-out",
                            "&:hover": {
                              backgroundColor: "#f3f4f6",
                            },
                            "&.Mui-focused": {
                              backgroundColor: "white",
                              boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.1)",
                            },
                            "& fieldset": {
                              borderColor: "#e5e7eb",
                            },
                            "&:hover fieldset": {
                              borderColor: "#10b981",
                            },
                            "&.Mui-focused fieldset": {
                              borderColor: "#10b981",
                              borderWidth: "2px",
                            },
                          },
                          "& .MuiInputLabel-root": {
                            color: "#6b7280",
                            "&.Mui-focused": {
                              color: "#10b981",
                            },
                          },
                        }}
                      />
                    </Grid>
                  </Grid>
                  <Typography
                    variant="body2"
                    sx={{
                      color: "#6b7280",
                      textAlign: "center",
                      marginTop: "24px",
                      marginBottom: "16px",
                      padding: "16px",
                      backgroundColor: "#f9fafb",
                      borderRadius: "12px",
                      border: "1px solid #e5e7eb",
                      fontSize: "0.875rem",
                      lineHeight: "1.5",
                    }}
                  >
                    Providing personal information is optional and entirely at your
                    discretion. You can use this app without sharing any personal
                    details beyond those necessary for account setup.
                  </Typography>
                  <Button
                    fullWidth
                    variant="contained"
                    onClick={handleSignUp}
                    sx={{ 
                      mt: 2, 
                      mb: 3,
                      py: 1.5,
                      borderRadius: "12px",
                      backgroundColor: "#10b981",
                      fontSize: "1rem",
                      fontWeight: "600",
                      textTransform: "none",
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
                  >
                    Sign Up
                  </Button>
                  <Grid container justifyContent="center">
                    <Grid item>
                      <Link
                        href="#"
                        variant="body2"
                        onClick={() => setNewSignUp(false)}
                        sx={{
                          color: "#10b981",
                          textDecoration: "none",
                          fontWeight: "500",
                          transition: "color 0.2s ease-in-out",
                          "&:hover": {
                            color: "#059669",
                            textDecoration: "underline",
                          },
                        }}
                      >
                        Already have an account? Sign in
                      </Link>
                    </Grid>
                  </Grid>
                </Box>
              </Box>
            </Grid>
          )}

          {/* new user change password  */}
          {!loading && newUserPassword && (
            <Box
              sx={{
                my: 8,
                mx: 4,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <Typography component="h1" variant="h5" paddingBottom={3}>
                New User
              </Typography>
              <p className="text-sm">
                Please enter a new password for your account.
              </p>
              <div className="flex flex-col items-center justify-center">
                <form onSubmit={handleNewUserPassword}>
                  <input
                    className="input input-bordered mt-1 h-10 w-full text-xs"
                    name="newPassword"
                    placeholder="New Password"
                    type="password"
                    required
                  />
                  <input
                    className="input input-bordered mt-1 h-10 w-full text-xs"
                    name="confirmNewPassword"
                    placeholder="Confirm New Password"
                    type="password"
                    required
                  />
                  {passwordError && (
                    <div className="block text-m mb-1 mt-6 text-red-600">
                      {passwordError}
                    </div>
                  )}
                  <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    color="primary"
                    sx={{ mt: 3, mb: 2 }}
                  >
                    Submit New Password
                  </Button>
                </form>
              </div>
            </Box>
          )}
          {/* new user confirm signup  */}
          {!loading && signUpConfirmation && (
            <Box
              sx={{
                my: 8,
                mx: 2,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                margin: "0 auto", // Center the content horizontally
                justifyContent: "center", // Center the content vertically

              }}
            >
              <Typography component="h1" variant="h5" paddingBottom={3}>
                Account not verified
              </Typography>
              <p className="text-sm">
                Please enter the confirmation code sent to your email.
              </p>
              <div className="flex flex-col items-center justify-center">
                <form onSubmit={handleConfirmSignUp}>
                  <input
                    className="input input-bordered mt-1 h-10 w-full text-xs bg-gray-200 border border-gray-400 rounded pl-2"
                    name="confirmationCode"
                    placeholder="Confirmation Code"
                    type="password"
                    maxLength={15}
                    required
                  />
                  {confirmationError && (
                    <div className="block text-m mb-1 mt-6 text-red-600">
                      {confirmationError}
                    </div>
                  )}
                  <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    color="primary"
                    sx={{ mt: 3, mb: 2 }}
                  >
                    Submit
                  </Button>
                  <Button
                    type="button"
                    fullWidth
                    variant="contained"
                    color="primary"
                    sx={{ mt: 3, mb: 2 }}
                    onClick={resendConfirmationCode}
                  >
                    Resend Code
                  </Button>
                </form>
              </div>
            </Box>
          )}
          {/* forgot password?  */}
          {!loading && forgotPassword && (
            <Grid
              item
              xs={12}
              sm={12}
              md={7}
              component={Paper}
              square
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100vh", // Center vertically and horizontally
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  width: "100%",
                  maxWidth: "500px", // Adjust for a clean form size
                  padding: 4, // Spacing around content
                }}
              >
                {/* Title */}
                <Typography
                  component="h1"
                  variant="h5"
                  sx={{
                    mb: 3,
                    textAlign: "center",
                    fontSize: "1.8rem", // Match font size with Sign In
                  }}
                >
                  Reset Password
                </Typography>

                {/* Request Reset */}
                {step === "requestReset" && (
                  <>
                    <TextField
                      label="Email Address"
                      type="email"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      fullWidth
                      margin="normal"
                      inputProps={{ maxLength: 40 }}
                      sx={{
                        fontSize: "1rem", // Ensure input matches font size
                      }}
                    />
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={() => handleResetPassword(username)}
                      fullWidth
                      sx={{
                        mt: 3,
                        mb: 2,
                        py: 1.2, // Vertical padding for height consistency
                        fontSize: "1rem", // Match button text font size
                      }}
                    >
                      Send Reset Code
                    </Button>
                  </>
                )}

                {/* Confirm Reset */}
                {step === "confirmReset" && (
                  <Box component="form" noValidate onSubmit={handleConfirmResetPassword}>
                    <TextField
                      label="Confirmation Code"
                      value={confirmationCode}
                      onChange={(e) => setConfirmationCode(e.target.value)}
                      fullWidth
                      margin="normal"
                      inputProps={{ maxLength: 15 }}
                      sx={{ fontSize: "1rem" }}
                    />
                    <TextField
                      label="New Password"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      fullWidth
                      margin="normal"
                      inputProps={{ maxLength: 50 }}
                      sx={{ fontSize: "1rem" }}
                    />
                    <Button
                      type="submit"
                      variant="contained"
                      color="primary"
                      fullWidth
                      sx={{
                        mt: 3,
                        mb: 2,
                        py: 1.2,
                        fontSize: "1rem",
                        fontWeight: "bold",
                      }}
                    >
                      Reset Password
                    </Button>
                  </Box>
                )}

                {/* Success Message */}
                {step === "done" && (
                  <Typography
                    color="primary"
                    sx={{ mt: 3, textAlign: "center", fontSize: "1.2rem" }}
                  >
                    Password has been successfully reset.
                  </Typography>
                )}

                {/* Error Message */}
                {error && (
                  <Typography
                    color="error"
                    sx={{ mt: 2, textAlign: "center", fontSize: "1rem" }}
                  >
                    {error}
                  </Typography>
                )}

                {/* Remember Password Link */}
                <Link
                  href="#"
                  variant="body2"
                  onClick={() => setForgotPassword(false)}
                  sx={{
                    mt: 3,
                    textAlign: "center",
                    display: "block",
                    fontSize: "1rem",
                    fontWeight: "bold",
                    color: "primary.main", // Match link color
                  }}
                >
                  Remember your Password? <strong>Sign in</strong>
                </Link>
              </Box>
            </Grid>
          )}
        </Grid>
      </PageContainer>
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
    </ThemeProvider>
  );
};

export default Login;