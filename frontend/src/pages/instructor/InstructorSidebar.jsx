import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Box,
} from "@mui/material";
import ViewTimelineIcon from "@mui/icons-material/ViewTimeline";
import EditIcon from "@mui/icons-material/Edit";
import PsychologyIcon from "@mui/icons-material/Psychology";
import GroupIcon from "@mui/icons-material/Group";
import GroupsIcon from "@mui/icons-material/Groups";
import ShowChartIcon from "@mui/icons-material/ShowChart";

const InstructorSidebar = ({ setSelectedComponent }) => {
  const navigate = useNavigate();
  const [drawerWidth, setDrawerWidth] = useState(220);

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
            boxShadow:
              "0 1px 3px 0 rgba(0,0,0,0.05), 0 1px 2px -1px rgba(0,0,0,0.05)",
            transition: "width 0.2s ease",
            overflowX: "hidden",
          },
        }}
      >
        <Box sx={{ overflow: "hidden", paddingTop: 10 }}>
          <List>
            {[
              {
                text: "All Groups",
                icon: <GroupsIcon />,
                route: "InstructorAllGroups",
              },
              {
                text: "Analytics",
                icon: <ShowChartIcon />,
                route: "InstructorAnalytics",
              },
              {
                text: "Edit Patients",
                icon: <EditIcon />,
                route: "InstructorEditPatients",
              },
              {
                text: "Prompt Settings",
                icon: <PsychologyIcon />,
                route: "PromptSettings",
              },
              {
                text: "View Students",
                icon: <GroupIcon />,
                route: "ViewStudents",
              },
            ].map((item, index) => (
              <React.Fragment key={index}>
                <ListItem
                  button
                  onClick={() => handleNavigation(item.route)}
                  sx={{
                    display: "flex",
                    justifyContent:
                      drawerWidth <= 160 ? "center" : "flex-start",
                    alignItems: "center",
                    margin: "4px 8px",
                    borderRadius: "12px",
                    transition: "all 0.2s ease-in-out",
                    "&:hover": {
                      backgroundColor: "#f0fdf4",
                      transform: "translateX(2px)",
                      boxShadow: "0 2px 4px -1px rgba(0,0,0,0.05)",
                    },
                    "&:active": {
                      backgroundColor: "#dcfce7",
                    },
                  }}
                >
                  <ListItemIcon
                    sx={{
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      minWidth: 0,
                      marginRight: drawerWidth > 160 ? 2 : 0,
                      width: drawerWidth <= 160 ? "100%" : "auto",
                      color: "#10b981",
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
                          fontWeight: 500,
                          fontSize: "0.875rem",
                        },
                      }}
                    />
                  )}
                </ListItem>
                {index < 4 && (
                  <Divider
                    sx={{ margin: "8px 16px", borderColor: "#f3f4f6" }}
                  />
                )}
              </React.Fragment>
            ))}
          </List>
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
