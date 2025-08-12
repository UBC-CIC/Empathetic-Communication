import React, { useState, useEffect, useContext } from "react";
import { Routes, Route, useNavigate, useParams } from "react-router-dom";
import { fetchAuthSession, fetchUserAttributes } from "aws-amplify/auth";
import {
  Typography,
  Box,
  AppBar,
  Toolbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  TableFooter,
  TablePagination,
  Button,
} from "@mui/material";
import PageContainer from "../Container";
import InstructorHeader from "../../components/InstructorHeader";
import InstructorSidebar from "./InstructorSidebar";
import InstructorAnalytics from "./InstructorAnalytics";
import InstructorEditPatients from "./InstructorEditPatients";
import PromptSettings from "./PromptSettings";
import ViewStudents from "./ViewStudents";
import InstructorPatients from "./InstructorPatients";
import InstructorNewPatient from "./InstructorNewPatient";
import StudentDetails from "./StudentDetails";
import { UserContext } from "../../App";
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

// group details page
const GroupDetails = () => {
  const { groupName } = useParams();
  const [selectedComponent, setSelectedComponent] = useState(
    "InstructorAnalytics"
  );
  const [simulationGroupId, setSimulationGroupId] = useState(
    localStorage.getItem("selectedGroupId") || null
  );

  useEffect(() => {
    if (!simulationGroupId) {
      const storedGroupId = localStorage.getItem("selectedGroupId");
      if (storedGroupId) {
        setSimulationGroupId(storedGroupId);
      }
    }
  }, []);

  if (!simulationGroupId) {
    return <Typography variant="h6">Loading ...</Typography>;
  }

  const renderComponent = () => {
    switch (selectedComponent) {
      case "InstructorAnalytics":
        return (
          <InstructorAnalytics
            groupName={groupName}
            simulation_group_id={simulationGroupId}
          />
        );
      case "InstructorEditPatients":
        return (
          <InstructorPatients
            groupName={groupName}
            simulation_group_id={simulationGroupId}
          />
        );
      case "PromptSettings":
        return (
          <PromptSettings
            groupName={groupName}
            simulation_group_id={simulationGroupId}
          />
        );
      case "ViewStudents":
        return (
          <ViewStudents
            groupName={groupName}
            simulation_group_id={simulationGroupId}
          />
        );
      default:
        return (
          <InstructorAnalytics
            groupName={groupName}
            simulation_group_id={simulationGroupId}
          />
        );
    }
  };

  return (
    <div style={{ backgroundColor: "#ffffff", minHeight: "100vh" }}>
      <PageContainer>
        <AppBar
          position="fixed"
          sx={{
            zIndex: (theme) => theme.zIndex.drawer + 1,
            backgroundColor: "white",
            color: "#1f2937",
            boxShadow:
              "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)",
          }}
          elevation={0}
        >
          <InstructorHeader />
        </AppBar>
        <InstructorSidebar
          setSelectedComponent={setSelectedComponent}
          activeExternal={selectedComponent}
        />
        {renderComponent()}
      </PageContainer>
    </div>
  );
};

const InstructorHomepage = () => {
  const [rows, setRows] = useState([
    {
      group: "loading...",
      description: "loading...",
      date: "loading...",
      status: "loading...",
      id: "loading...",
    },
  ]);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [groupData, setGroupData] = useState([]);
  const { isInstructorAsStudent } = useContext(UserContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (isInstructorAsStudent) {
      navigate("/");
    }
  }, [isInstructorAsStudent, navigate]);
  // connect to api data
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const session = await fetchAuthSession();
        var token = session.tokens.idToken;
        const { email } = await fetchUserAttributes();
        const response = await fetch(
          `${
            import.meta.env.VITE_API_ENDPOINT
          }instructor/groups?email=${encodeURIComponent(email)}`,
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
          setGroupData(data);
          const formattedData = data.map((group) => ({
            group: group.group_name,
            description: group.group_description || "No description available",
            date: new Date().toLocaleDateString(), // REPLACE
            status: group.group_student_access ? "Active" : "Inactive",
            id: group.simulation_group_id,
          }));
          setRows(formattedData);
        } else {
          console.error("Failed to fetch groups:", response.statusText);
        }
      } catch (error) {
        console.error("Error fetching groups:", error);
      }
    };

    fetchGroups();
  }, []);

  const handleSearchChange = (event) => {
    setSearchQuery(event.target.value);
  };

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const filteredRows = rows.filter((row) =>
    row.group.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleRowClick = (groupName, simulation_group_id) => {
    localStorage.setItem("selectedGroupId", simulation_group_id);
    const group = groupData.find(
      (group) => group.group_name.trim() === groupName.trim()
    );

    if (group) {
      const { simulation_group_id } = group;
      const path = `/group/ ${groupName.trim()}`;
      navigate(path, { state: { simulation_group_id } });
    } else {
      console.error("Group not found!");
    }
  };

  return (
    <Routes>
      <Route
        path="/"
        element={
          <PageContainer>
            <AppBar
              position="fixed"
              sx={{
                boxShadow: "none",
                zIndex: (theme) => theme.zIndex.drawer + 1,
              }}
              elevation={1}
            >
              <InstructorHeader />
            </AppBar>
            <Box
              component="main"
              sx={{
                flexGrow: 1,
                p: 3,
                marginTop: 1,
                overflowY: "auto",
                maxHeight: "calc(100vh - 64px)",
                backgroundColor: "#ffffff",
              }}
            >
              <Toolbar />
              {/* <Typography
                color="black"
                fontStyle="semibold"
                textAlign="left"
                variant="h6"
                sx={{
                  fontWeight: 600,
                  mb: 2,
                  color: "#111827",
                }}
              >
                Simulation Groups
              </Typography> */}
              <Paper
                sx={{
                  width: "100%",
                  maxWidth: "1000px",
                  margin: "0 auto",
                  p: 3,
                  borderRadius: "16px",
                  backgroundColor: "white",
                  border: "1px solid #e5e7eb",
                  boxShadow:
                    "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.05)",
                  overflow: "hidden",
                }}
              >
                <TextField
                  label="Search by Group"
                  variant="outlined"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  sx={{
                    width: "100%",
                    mb: 2,
                    "& .MuiOutlinedInput-root": {
                      borderRadius: "12px",
                      backgroundColor: "#f9fafb",
                      transition: "all .2s",
                      "& fieldset": { borderColor: "#e5e7eb" },
                      "&:hover fieldset": { borderColor: "#10b981" },
                      "&.Mui-focused": {
                        backgroundColor: "white",
                        boxShadow: "0 0 0 3px rgba(16,185,129,0.15)",
                      },
                      "&.Mui-focused fieldset": {
                        borderColor: "#10b981",
                        borderWidth: "2px",
                      },
                    },
                    "& .MuiInputLabel-root": {
                      color: "#6b7280",
                      "&.Mui-focused": { color: "#059669" },
                    },
                  }}
                />
                <TableContainer sx={{ maxHeight: "55vh", overflowY: "auto" }}>
                  <Table aria-label="group table" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ backgroundColor: "#f9fafb" }}>
                        <TableCell
                          sx={{
                            width: "40%",
                            fontSize: ".7rem",
                            fontWeight: 600,
                            letterSpacing: ".05em",
                            textTransform: "uppercase",
                            color: "#374151",
                            borderBottom: "2px solid #e5e7eb",
                          }}
                        >
                          Group
                        </TableCell>
                        <TableCell
                          sx={{
                            width: "40%",
                            fontSize: ".7rem",
                            fontWeight: 600,
                            letterSpacing: ".05em",
                            textTransform: "uppercase",
                            color: "#374151",
                            borderBottom: "2px solid #e5e7eb",
                          }}
                        >
                          Description
                        </TableCell>
                        <TableCell
                          sx={{
                            width: "20%",
                            fontSize: ".7rem",
                            fontWeight: 600,
                            letterSpacing: ".05em",
                            textTransform: "uppercase",
                            color: "#374151",
                            borderBottom: "2px solid #e5e7eb",
                          }}
                        >
                          Status
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredRows
                        .slice(
                          page * rowsPerPage,
                          page * rowsPerPage + rowsPerPage
                        )
                        .map((row, index) => (
                          <TableRow
                            key={index}
                            onClick={() => handleRowClick(row.group, row.id)}
                            sx={{
                              cursor: "pointer",
                              transition: "background-color .15s",
                              "&:hover": { backgroundColor: "#f0fdf4" },
                            }}
                          >
                            <TableCell
                              sx={{ fontSize: ".95rem", color: "#111827" }}
                            >
                              {titleCase(row.group)}
                            </TableCell>
                            <TableCell
                              sx={{ fontSize: ".85rem", color: "#4b5563" }}
                            >
                              {row.description}
                            </TableCell>
                            <TableCell>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  padding: "4px 10px",
                                  borderRadius: "9999px",
                                  fontSize: ".65rem",
                                  fontWeight: 600,
                                  letterSpacing: ".05em",
                                  textTransform: "uppercase",
                                  backgroundColor:
                                    row.status === "Active"
                                      ? "#d1fae5"
                                      : "#f3f4f6",
                                  color:
                                    row.status === "Active"
                                      ? "#065f46"
                                      : "#374151",
                                  border:
                                    row.status === "Active"
                                      ? "1px solid #a7f3d0"
                                      : "1px solid #e5e7eb",
                                }}
                              >
                                {row.status}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      {filteredRows.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={3}
                            align="center"
                            sx={{ py: 6, color: "#6b7280" }}
                          >
                            No simulation groups found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TablePagination
                          rowsPerPageOptions={[5, 10, 25]}
                          component="div"
                          count={filteredRows.length}
                          rowsPerPage={rowsPerPage}
                          page={page}
                          onPageChange={handleChangePage}
                          onRowsPerPageChange={handleChangeRowsPerPage}
                          sx={{
                            ".MuiTablePagination-toolbar": { px: 0 },
                            ".MuiTablePagination-selectLabel, .MuiTablePagination-displayedRows":
                              {
                                fontSize: ".65rem",
                                letterSpacing: ".05em",
                                textTransform: "uppercase",
                                color: "#6b7280",
                              },
                          }}
                        />
                      </TableRow>
                    </TableFooter>
                  </Table>
                </TableContainer>
              </Paper>
            </Box>
          </PageContainer>
        }
      />
      <Route exact path=":groupName/*" element={<GroupDetails />} />
      <Route
        path=":groupName/edit-patient"
        element={<InstructorEditPatients />}
      />
      <Route path=":groupName/new-patient" element={<InstructorNewPatient />} />
      <Route
        path=":groupName/student/:studentId"
        element={<StudentDetails />}
      />
    </Routes>
  );
};

export default InstructorHomepage;
