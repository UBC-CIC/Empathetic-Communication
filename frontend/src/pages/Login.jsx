import { useState } from "react";



import "./LoginStyles.css"; // Adjust the path if necessary

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
  Grid,
  Box,
  Typography,
} from "@mui/material";

import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
// login assets
import PageContainer from "./Container";

// MUI theming
import { ThemeProvider } from "@mui/material/styles";
import theme from "../Theme";

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
      toast.error("Password must be at least 8 characters long", {
        theme: "colored",
      });
      return;
    }

    if (!/[a-z]/.test(password)) {
      setPasswordError("Password must contain at least one lowercase letter");
      toast.error("Password must contain at least one lowercase letter", {
        theme: "colored",
      });
      return;
    }

    if (!/[A-Z]/.test(password)) {
      setPasswordError("Password must contain at least one uppercase letter");
      toast.error("Password must contain at least one uppercase letter", {
        theme: "colored",
      });
      return;
    }

    if (!/[0-9]/.test(password)) {
      setPasswordError("Password must contain at least one number");
      toast.error("Password must contain at least one number", {
        theme: "colored",
      });
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
        toast.success(
          "Account created. Check your email for the confirmation code.",
          {
            theme: "colored",
          }
        );
      }
    } catch (error) {
      const errorMessage = error.message.includes("PreSignUp failed with error")
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
        const token = session.tokens.idToken;

        const response = await fetch(
          `${
            import.meta.env.VITE_API_ENDPOINT
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
        <Grid
          container
          component="main"
          sx={{ height: "100vh", bgcolor: "#ffffff" }}
        >
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
              background:
                "linear-gradient(135deg, #D1FAE5, #e3fcef 0%, #D1FAE5 100%)",
              position: "relative",
              overflow: "hidden",
              "&::before": {
                content: '""',
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background:
                  "radial-gradient(circle at 25% 25%, rgba(255,255,255,0.15), transparent 60%), radial-gradient(circle at 75% 75%, rgba(255,255,255,0.15), transparent 60%)",
                pointerEvents: "none",
              },
            }}
          >
            <div
              style={{
                textAlign: "center",
                position: "relative",
                display: "flex",
                flexDirection: "row",
                textAlign: "left",
                zIndex: 1,
                maxWidth: "100%",
              }}
              className="fadeInLeft"
            >
              <img
                src={"logo.png"}
                alt="Heartbeat"
                className="heartbeat-image"
                style={{
                  width: "120px", // Fixed width for consistency
                  maxWidth: "100%",
                  height: "auto",
                  maxHeight: "120px", // Prevent stretching vertically
                  display: "block",
                  margin: "0 auto 0px",
                  objectFit: "contain", // Maintain aspect ratio
                }}
              />
              <div
                style={{
                  maxWidth: "80%",
                  margin: "0 auto",
                  display: "flex",
                  flexDirection: "column",
                  textAlign: "left",
                  justifyContent: "center",
                  alignItems: "flex-start",
                }}
              >
                <Typography
                  variant="h3"
                  sx={{
                    color: "#1f2937",
                    fontWeight: "550",
                    fontSize: "clamp(1.75rem, 3.5vw, 3rem)",
                    lineHeight: "1.1",
                    marginBottom: "12px",
                    textAlign: "left",
                    fontFamily: "Outfit, sans-serif",
                    fontSize: "3rem",
                    marginLeft: "1rem",
                  }}
                  className="fadeInLeft"
                >
                  Virtual Care Interactions
                </Typography>
                <Typography
                  variant="h4"
                  sx={{
                    color: "#1f2937",
                    fontWeight: "500",
                    fontSize: "clamp(1.25rem, 2.5vw, 2rem)",
                    lineHeight: "1.2",
                    marginBottom: "8px",
                    textAlign: "left",
                    fontFamily: "Outfit, sans-serif",
                    fontSize: "1.5rem",
                  }}
                  className="fadeInLeftDelay"
                >
                  With Empathetic Communication
                </Typography>
              </div>
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
                  boxShadow:
                    "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
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
                      fontFamily: "Outfit, sans-serif",
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
                        boxShadow: "none",
                        transition: "all 0.2s ease-in-out",
                        color: "white",
                        fontFamily: "Outfit, sans-serif",
                        "&:hover": {
                          backgroundColor: "#059669",
                          transform: "translateY(-1px)",
                          boxShadow: "none",
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
                boxShadow:
                  "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
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
                    Providing personal information is optional and entirely at
                    your discretion. You can use this app without sharing any
                    personal details beyond those necessary for account setup.
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
                      boxShadow: "none",
                      color: "white",
                      fontWeight: "600",
                      textTransform: "none",
                      transition: "all 0.2s ease-in-out",
                      "&:hover": {
                        backgroundColor: "#059669",
                        boxShadow: "none    ",
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
                boxShadow:
                  "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
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
                    fontWeight: 700,
                    marginBottom: "28px",
                    fontSize: "1.875rem",
                    fontFamily: "Outfit, sans-serif",
                    textAlign: "center",
                  }}
                >
                  Verify your account
                </Typography>
                <Box
                  component="form"
                  noValidate
                  onSubmit={handleConfirmSignUp}
                  sx={{ mt: 1, width: "100%" }}
                >
                  <TextField
                    margin="normal"
                    required
                    fullWidth
                    id="confirmationCode"
                    label="Confirmation Code"
                    name="confirmationCode"
                    autoFocus
                    type="text"
                    inputProps={{ maxLength: 15, inputMode: "numeric" }}
                    sx={{
                      mb: 2,
                      "& .MuiOutlinedInput-root": {
                        borderRadius: "12px",
                        backgroundColor: "#f9fafb",
                        transition: "all 0.2s ease-in-out",
                        "&:hover": { backgroundColor: "#f3f4f6" },
                        "&.Mui-focused": {
                          backgroundColor: "white",
                          boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.1)",
                        },
                        "& fieldset": { borderColor: "#e5e7eb" },
                        "&:hover fieldset": { borderColor: "#10b981" },
                        "&.Mui-focused fieldset": {
                          borderColor: "#10b981",
                          borderWidth: "2px",
                        },
                      },
                      "& .MuiInputLabel-root": {
                        color: "#6b7280",
                        "&.Mui-focused": { color: "#10b981" },
                      },
                    }}
                  />
                  {confirmationError && (
                    <Typography
                      variant="body2"
                      sx={{ color: "#dc2626", mt: 1, fontWeight: 500 }}
                    >
                      {confirmationError}
                    </Typography>
                  )}
                  <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    sx={{
                      mt: 3,
                      mb: 2,
                      py: 1.5,
                      borderRadius: "12px",
                      backgroundColor: "#10b981",
                      fontSize: "1rem",
                      fontWeight: 600,
                      textTransform: "none",
                      boxShadow: "none",
                      transition: "all 0.2s ease-in-out",
                      color: "white",
                      fontFamily: "Outfit, sans-serif",
                      "&:hover": {
                        backgroundColor: "#059669",
                        transform: "translateY(-1px)",
                        boxShadow: "none",
                      },
                      "&:active": { transform: "translateY(0)" },
                    }}
                  >
                    Submit Code
                  </Button>
                  <Box sx={{ textAlign: "center" }}>
                    <Link
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        resendConfirmationCode();
                      }}
                      variant="body2"
                      sx={{
                        color: "#10b981",
                        textDecoration: "none",
                        fontWeight: 500,
                        transition: "color 0.2s ease-in-out",
                        display: "inline-block",
                        "&:hover": {
                          color: "#059669",
                          textDecoration: "underline",
                        },
                      }}
                    >
                      Didn&apos;t get a code? Resend
                    </Link>
                  </Box>
                </Box>
              </Box>
            </Grid>
          )}
          {/* forgot password?  */}
          {!loading && forgotPassword && (
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
                boxShadow:
                  "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
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
                  maxWidth: "420px",
                }}
              >
                <Typography
                  component="h1"
                  variant="h4"
                  sx={{
                    color: "#1f2937",
                    fontWeight: 700,
                    marginBottom: step === "confirmReset" ? "20px" : "28px",
                    fontSize: "1.875rem",
                    fontFamily: "Outfit, sans-serif",
                    textAlign: "center",
                  }}
                >
                  {step === "confirmReset"
                    ? "Enter reset code"
                    : "Reset password"}
                </Typography>
                {message && step === "confirmReset" && (
                  <Typography
                    variant="body2"
                    sx={{
                      mb: 1,
                      color: "#059669",
                      textAlign: "center",
                      fontWeight: 500,
                    }}
                  >
                    {message}
                  </Typography>
                )}
                {/* Request Reset */}
                {step === "requestReset" && (
                  <Box sx={{ width: "100%" }}>
                    <TextField
                      label="Email Address"
                      type="email"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      fullWidth
                      margin="normal"
                      inputProps={{ maxLength: 40 }}
                      sx={{
                        mb: 2,
                        "& .MuiOutlinedInput-root": {
                          borderRadius: "12px",
                          backgroundColor: "#f9fafb",
                          transition: "all 0.2s ease-in-out",
                          "&:hover": { backgroundColor: "#f3f4f6" },
                          "&.Mui-focused": {
                            backgroundColor: "white",
                            boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.1)",
                          },
                          "& fieldset": { borderColor: "#e5e7eb" },
                          "&:hover fieldset": { borderColor: "#10b981" },
                          "&.Mui-focused fieldset": {
                            borderColor: "#10b981",
                            borderWidth: "2px",
                          },
                        },
                        "& .MuiInputLabel-root": {
                          color: "#6b7280",
                          "&.Mui-focused": { color: "#10b981" },
                        },
                      }}
                    />
                    <Button
                      variant="contained"
                      onClick={() => handleResetPassword(username)}
                      fullWidth
                      sx={{
                        mt: 1,
                        mb: 3,
                        py: 1.5,
                        borderRadius: "12px",
                        backgroundColor: "#10b981",
                        fontSize: "1rem",
                        fontWeight: 600,
                        textTransform: "none",
                        boxShadow: "none",
                        transition: "all 0.2s ease-in-out",
                        color: "white",
                        fontFamily: "Outfit, sans-serif",
                        "&:hover": {
                          backgroundColor: "#059669",
                          transform: "translateY(-1px)",
                          boxShadow: "none",
                        },
                        "&:active": { transform: "translateY(0)" },
                      }}
                    >
                      Send Reset Code
                    </Button>
                    <Typography
                      variant="body2"
                      sx={{
                        textAlign: "center",
                        color: "#6b7280",
                        fontSize: "0.85rem",
                        lineHeight: 1.5,
                        px: 1,
                      }}
                    >
                      We will send a short‑lived code to your email so you can
                      create a new password.
                    </Typography>
                    <Box sx={{ textAlign: "center", mt: 3 }}>
                      <Link
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setForgotPassword(false);
                        }}
                        variant="body2"
                        sx={{
                          color: "#10b981",
                          textDecoration: "none",
                          fontWeight: 500,
                          transition: "color 0.2s ease-in-out",
                          display: "inline-block",
                          "&:hover": {
                            color: "#059669",
                            textDecoration: "underline",
                          },
                        }}
                      >
                        Back to sign in
                      </Link>
                    </Box>
                  </Box>
                )}

                {/* Confirm Reset */}
                {step === "confirmReset" && (
                  <Box
                    component="form"
                    noValidate
                    onSubmit={handleConfirmResetPassword}
                    sx={{ width: "100%" }}
                  >
                    <TextField
                      label="Confirmation Code"
                      value={confirmationCode}
                      onChange={(e) => setConfirmationCode(e.target.value)}
                      fullWidth
                      margin="normal"
                      inputProps={{ maxLength: 15 }}
                      sx={{
                        mb: 2,
                        "& .MuiOutlinedInput-root": {
                          borderRadius: "12px",
                          backgroundColor: "#f9fafb",
                          transition: "all 0.2s ease-in-out",
                          "&:hover": { backgroundColor: "#f3f4f6" },
                          "&.Mui-focused": {
                            backgroundColor: "white",
                            boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.1)",
                          },
                          "& fieldset": { borderColor: "#e5e7eb" },
                          "&:hover fieldset": { borderColor: "#10b981" },
                          "&.Mui-focused fieldset": {
                            borderColor: "#10b981",
                            borderWidth: "2px",
                          },
                        },
                        "& .MuiInputLabel-root": {
                          color: "#6b7280",
                          "&.Mui-focused": { color: "#10b981" },
                        },
                      }}
                    />
                    <TextField
                      label="New Password"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      fullWidth
                      margin="normal"
                      inputProps={{ maxLength: 50 }}
                      sx={{
                        mb: 3,
                        "& .MuiOutlinedInput-root": {
                          borderRadius: "12px",
                          backgroundColor: "#f9fafb",
                          transition: "all 0.2s ease-in-out",
                          "&:hover": { backgroundColor: "#f3f4f6" },
                          "&.Mui-focused": {
                            backgroundColor: "white",
                            boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.1)",
                          },
                          "& fieldset": { borderColor: "#e5e7eb" },
                          "&:hover fieldset": { borderColor: "#10b981" },
                          "&.Mui-focused fieldset": {
                            borderColor: "#10b981",
                            borderWidth: "2px",
                          },
                        },
                        "& .MuiInputLabel-root": {
                          color: "#6b7280",
                          "&.Mui-focused": { color: "#10b981" },
                        },
                      }}
                    />
                    {error && (
                      <Typography
                        variant="body2"
                        sx={{ color: "#dc2626", mt: 0, fontWeight: 500 }}
                      >
                        {error}
                      </Typography>
                    )}
                    <Button
                      type="submit"
                      variant="contained"
                      fullWidth
                      sx={{
                        mt: 1,
                        mb: 2,
                        py: 1.5,
                        borderRadius: "12px",
                        backgroundColor: "#10b981",
                        fontSize: "1rem",
                        fontWeight: 600,
                        textTransform: "none",
                        boxShadow: "none",
                        transition: "all 0.2s ease-in-out",
                        color: "white",
                        fontFamily: "Outfit, sans-serif",
                        "&:hover": {
                          backgroundColor: "#059669",
                          transform: "translateY(-1px)",
                          boxShadow: "none",
                        },
                        "&:active": { transform: "translateY(0)" },
                      }}
                    >
                      Reset Password
                    </Button>
                    <Box sx={{ textAlign: "center", mt: 1 }}>
                      <Link
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setForgotPassword(false);
                          setStep("requestReset");
                        }}
                        variant="body2"
                        sx={{
                          color: "#10b981",
                          textDecoration: "none",
                          fontWeight: 500,
                          transition: "color 0.2s ease-in-out",
                          display: "inline-block",
                          "&:hover": {
                            color: "#059669",
                            textDecoration: "underline",
                          },
                        }}
                      >
                        Back to sign in
                      </Link>
                    </Box>
                  </Box>
                )}
                {step === "done" && (
                  <Typography
                    color="primary"
                    sx={{
                      mt: 1,
                      textAlign: "center",
                      fontSize: "1rem",
                      fontWeight: 500,
                    }}
                  >
                    Password has been successfully reset.
                  </Typography>
                )}
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
