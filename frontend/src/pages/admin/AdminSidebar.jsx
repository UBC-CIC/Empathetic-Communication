import React, { useState } from "react";
// MUI
import {
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Box,
} from "@mui/material";
import ContactPageIcon from "@mui/icons-material/ContactPage";
import GroupsIcon from "@mui/icons-material/Groups";
import SettingsIcon from "@mui/icons-material/Settings";

const AdminSidebar = ({
  setSelectedComponent,
  setSelectedInstructor,
  setSelectedGroup,
}) => {
  // State to control the drawer width
  const [drawerWidth, setDrawerWidth] = useState(220);

  // Function to handle mouse drag for resizing
  const handleMouseMove = (e) => {
    const newWidth = e.clientX; // Get the new width based on the mouse position
    if (newWidth >= 115 && newWidth <= 400) {
      setDrawerWidth(newWidth); // Limit the resizing range
    }
  };

  // Function to handle mouse release (stop resizing)
  const stopResizing = () => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", stopResizing);
    document.body.style.userSelect = ""; // Re-enable text selection
  };

  // Start resizing on mousedown
  const startResizing = (e) => {
    e.preventDefault(); // Prevent default behavior to avoid issues
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", stopResizing);
    document.body.style.userSelect = "none"; // Disable text selection
  };

  return (
    <>
      {/* Drawer */}
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
              "0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0,0,0,0.05)",
            transition: "width 0.2s ease",
            overflowX: "hidden",
          },
        }}
      >
        <Box
          sx={{
            overflow: "hidden", // Prevent horizontal scrolling
            paddingTop: 10,
          }}
        >
          <List>
            {[
              {
                text: "Instructors",
                icon: <ContactPageIcon />,
                route: "AdminInstructors",
              },
              {
                text: "Simulation Groups",
                icon: <GroupsIcon />,
                route: "AdminSimulationGroups",
              },
              {
                text: "AI Settings",
                icon: <SettingsIcon />,
                route: "AISettings",
              },
            ].map((item, index) => (
              <React.Fragment key={index}>
                <ListItem
                  button
                  onClick={() => {
                    setSelectedInstructor(null);
                    setSelectedGroup(null);
                    setSelectedComponent(item.route);
                  }}
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
                {index < 2 && (
                  <Divider
                    sx={{ margin: "8px 16px", borderColor: "#f3f4f6" }}
                  />
                )}
              </React.Fragment>
            ))}
          </List>
        </Box>
      </Drawer>

      {/* Resizing Handle */}
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

export default AdminSidebar;
