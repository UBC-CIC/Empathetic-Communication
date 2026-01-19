import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Box,
  Typography,
  IconButton,
} from "@mui/material";
import ViewTimelineIcon from "@mui/icons-material/ViewTimeline";
import EditIcon from "@mui/icons-material/Edit";
import PsychologyIcon from "@mui/icons-material/Psychology";
import GroupIcon from "@mui/icons-material/Group";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { fetchAuthSession } from "aws-amplify/auth";

const InstructorSidebar = ({ setSelectedComponent, activeExternal, simulation_group_id }) => {
  const navigate = useNavigate();
  const [drawerWidth, setDrawerWidth] = useState(220);
  const [activeRoute, setActiveRoute] = useState(
    activeExternal || "InstructorAnalytics"
  );
  const [accessCode, setAccessCode] = useState("Loading...");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (activeExternal) setActiveRoute(activeExternal);
  }, [activeExternal]);

  useEffect(() => {
    const fetchCode = async () => {
      if (!simulation_group_id) return;
      try {
        const session = await fetchAuthSession();
        const token = session.tokens.idToken;
        const response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT}instructor/get_access_code?simulation_group_id=${encodeURIComponent(simulation_group_id)}`,
          {
            method: "GET",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );
        if (response.ok) {
          const codeData = await response.json();
          setAccessCode(codeData.group_access_code || "N/A");
        } else {
          setAccessCode("Error");
        }
      } catch (error) {
        setAccessCode("Error");
      }
    };
    fetchCode();
  }, [simulation_group_id]);

  const handleMouseMove = (e) => {
    const newWidth = e.clientX;
    if (newWidth >= 115 && newWidth <= 400) {
      setDrawerWidth(newWidth);
    }
  };

  const stopResizing = () => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", stopResizing);
    document.body.style.userSelect = "";
  };

  const startResizing = (e) => {
    e.preventDefault();
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", stopResizing);
    document.body.style.userSelect = "none";
  };

  const handleNavigation = (component) => {
    if (component === "InstructorAllGroups") {
      navigate("/home");
    } else {
      setSelectedComponent(component);
      setActiveRoute(component);
    }
  };

  const handleCopyAccessCode = async () => {
    try {
      await navigator.clipboard.writeText(accessCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <>
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: {
            width: drawerWidth,
            boxSizing: "border-box",
            backgroundColor: "white",
            borderRight: "1px solid #e5e7eb",
            marginTop: "1rem",
            boxShadow:
              "0 1px 3px 0 rgba(0,0,0,0.05), 0 1px 2px -1px rgba(0,0,0,0.05)",
            transition: "width 0.2s ease",
            overflow: "visible", // allow active highlight to render fully
            paddingTop: "64px",
          },
        }}
      >
        <Box sx={{ px: 1.5, pb: 2 }}>
          <List>
            {[
              {
                text: "Back to All Groups",
                icon: <ArrowBackIcon />,
                route: "InstructorAllGroups",
              },
              {
                text: "Analytics",
                icon: <ShowChartIcon />,
                route: "InstructorAnalytics",
              },
              {
                text: "Prompt Settings",
                icon: <PsychologyIcon />,
                route: "PromptSettings",
              },
              {
                text: "Manage Patients",
                icon: <EditIcon />,
                route: "InstructorEditPatients",
              },
              {
                text: "View Students",
                icon: <GroupIcon />,
                route: "ViewStudents",
              },
            ].map((item, index) => {
              const active = activeRoute === item.route;
              return (
                <React.Fragment key={index}>
                  <ListItem
                    button
                    onClick={() => handleNavigation(item.route)}
                    sx={{
                      position: "relative",
                      display: "flex",
                      justifyContent:
                        drawerWidth <= 160 ? "center" : "flex-start",
                      alignItems: "center",
                      my: 0.5,
                      borderRadius: "12px",
                      transition: "all 0.18s ease",
                      backgroundColor: active ? "#ecfdf5" : "transparent",
                      boxShadow: active ? "0 0 0 1px #a7f3d0 inset" : "none",
                      "&:hover": {
                        backgroundColor: "#f0fdf4",
                        transform: "translateX(2px)",
                        boxShadow: "0 2px 4px -1px rgba(0,0,0,0.05)",
                      },
                      "&:active": { backgroundColor: "#dcfce7" },
                      "&::before":
                        active && drawerWidth > 160
                          ? {
                              content: '""',
                              position: "absolute",
                              left: -6,
                              top: 6,
                              bottom: 6,
                              width: 4,
                              borderRadius: 2,
                              backgroundColor: "#10b981",
                            }
                          : {},
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        minWidth: 0,
                        mr: drawerWidth > 160 ? 2 : 0,
                        width: drawerWidth <= 160 ? "100%" : "auto",
                        color: active ? "#059669" : "#10b981",
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    {drawerWidth > 160 && (
                      <ListItemText
                        primary={item.text}
                        sx={{
                          "& .MuiListItemText-primary": {
                            color: "#374151",
                            fontWeight: active ? 600 : 500,
                            fontSize: "0.875rem",
                          },
                        }}
                      />
                    )}
                  </ListItem>
                  {index < 4 && (
                    <Divider sx={{ mx: 1, my: 1, borderColor: "#f3f4f6" }} />
                  )}
                </React.Fragment>
              );
            })}
          </List>
          <Divider sx={{ mx: 1, my: 2, borderColor: "#f3f4f6" }} />
          <Box sx={{ px: 2, pb: 2 }}>
            <Typography
              variant="caption"
              sx={{ color: "#6b7280", fontWeight: 500, display: "block", mb: 1 }}
            >
              Access Code
            </Typography>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                backgroundColor: "#f9fafb",
                borderRadius: "8px",
                padding: "8px 12px",
                border: "1px solid #e5e7eb",
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontFamily: "monospace",
                  color: "#059669",
                  fontWeight: 600,
                  flex: 1,
                  fontSize: "0.875rem",
                }}
              >
                {accessCode}
              </Typography>
              <IconButton
                size="small"
                onClick={handleCopyAccessCode}
                sx={{
                  color: copied ? "#10b981" : "#6b7280",
                  "&:hover": { backgroundColor: "#ecfdf5" },
                }}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Box>
            {copied && (
              <Typography
                variant="caption"
                sx={{ color: "#10b981", display: "block", mt: 0.5 }}
              >
                Copied!
              </Typography>
            )}
          </Box>
        </Box>
      </Drawer>
      <div
        onMouseDown={startResizing}
        className="w-1 bg-gray-200 hover:bg-emerald-300 cursor-col-resize transition-colors duration-200"
        style={{
          height: "100vh",
          position: "absolute",
          top: 0,
          left: drawerWidth,
        }}
      />
    </>
  );
};

export default InstructorSidebar;
