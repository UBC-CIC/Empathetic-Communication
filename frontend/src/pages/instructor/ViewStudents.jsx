import {
  Typography,
  Box,
  Toolbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  Button,
  TableFooter,
  TablePagination,
  IconButton,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { fetchAuthSession } from "aws-amplify/auth";

// Helper function to create data and format text
const createData = (name, email) => {
  return { name, email };
};

function titleCase(str) {
  if (typeof str !== "string") {
    return str;
  }
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const initialRows = [createData("loading...", "loading...")];

export const ViewStudents = ({ groupName, simulation_group_id }) => {
  const [rows, setRows] = useState(initialRows);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [loading, setLoading] = useState(false);
  const [accessCode, setAccessCode] = useState("loading...");
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  // Fetch access code and student data
  useEffect(() => {
    const fetchCode = async () => {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens.idToken;
        const response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT
          }instructor/get_access_code?simulation_group_id=${encodeURIComponent(
            simulation_group_id
          )}`,
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
          setAccessCode(codeData.group_access_code);
        }
      } catch (error) {
        console.error("Error fetching access code:", error);
      }
    };
    fetchCode();
  }, [simulation_group_id]);

  useEffect(() => {
    const fetchStudents = async () => {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens.idToken;
        const response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT
          }instructor/view_students?simulation_group_id=${encodeURIComponent(
            simulation_group_id
          )}`,
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
          const formattedData = data.map((student) => {
            return createData(
              `${titleCase(student.first_name)} ${titleCase(
                student.last_name
              )}`,
              student.user_email
            );
          });
          setRows(formattedData);
        } else {
          console.error("Failed to fetch students:", response.statusText);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };
    fetchStudents();
  }, [simulation_group_id]);

  const handleGenerateAccessCode = async () => {
    try {
      const session = await fetchAuthSession();
      var token = session.tokens.idToken;
      const response = await fetch(
        `${import.meta.env.VITE_API_ENDPOINT
        }instructor/generate_access_code?simulation_group_id=${encodeURIComponent(
          simulation_group_id
        )}`,
        {
          method: "PUT",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );
      if (response.ok) {
        const codeData = await response.json();
        setAccessCode(codeData.access_code);
      } else {
        console.error("Failed to fetch groups:", response.statusText);
      }
    } catch (error) {
      console.error("Error fetching groups:", error);
    }
  };

  const handleCopyAccessCode = async () => {
    try {
      await navigator.clipboard.writeText(accessCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      console.error("Copy failed", e);
    }
  };

  // Handlers for pagination, searching, and navigation
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

  const handleRowClick = (student) => {
    localStorage.setItem("selectedStudent", JSON.stringify(student));
    localStorage.setItem("selectedGroupId", simulation_group_id);
    navigate(`/group/${simulation_group_id}/student/${student.name}`, {
      state: { simulation_group_id, student },
    });
  };

  const filteredRows = rows.filter((row) =>
    row.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Box
      component="main"
      sx={{
        flexGrow: 1,
        p: 2,
        mt: 1,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <Toolbar />
      <Typography
        variant="h6"
        sx={{ mb: 2, fontWeight: 600, color: "#111827" }}
      >
        {titleCase(groupName)} Students
      </Typography>
      <Paper
        sx={{
          width: "100%",
          maxWidth: "1000px",
          overflow: "hidden",
          p: 3,
          mb: 3,
          borderRadius: "16px",
          boxShadow:
            "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.05)",
          border: "1px solid #e5e7eb",
          backgroundColor: "white",
        }}
      >
        <TableContainer sx={{ maxHeight: "50vh", overflowY: "auto" }}>
          <TextField
            label="Search by Student"
            variant="outlined"
            value={searchQuery}
            onChange={handleSearchChange}
            sx={{
              mb: 2,
              width: "100%",
              "& .MuiOutlinedInput-root": { borderRadius: "12px" },
            }}
          />
          <Table aria-label="student table" stickyHeader>
            <TableHead>
              <TableRow sx={{ backgroundColor: "#f9fafb" }}>
                <TableCell
                  sx={{
                    width: "50%",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    letterSpacing: ".05em",
                    textTransform: "uppercase",
                    color: "#374151",
                    borderBottom: "2px solid #e5e7eb",
                  }}
                >
                  Student
                </TableCell>
                <TableCell
                  sx={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    letterSpacing: ".05em",
                    textTransform: "uppercase",
                    color: "#374151",
                    borderBottom: "2px solid #e5e7eb",
                  }}
                >
                  Email
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredRows.length > 0 ? (
                filteredRows
                  .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                  .map((row, index) => (
                    <TableRow
                      key={index}
                      onClick={() => handleRowClick(row)}
                      sx={{
                        cursor: "pointer",
                        transition: "background-color .15s",
                        "&:hover": { backgroundColor: "#f0fdf4" },
                      }}
                    >
                      <TableCell sx={{ fontSize: "0.95rem", color: "#111827" }}>
                        {row.name}
                      </TableCell>
                      <TableCell sx={{ fontSize: "0.9rem", color: "#4b5563" }}>
                        {row.email}
                      </TableCell>
                    </TableRow>
                  ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={2}
                    align="center"
                    sx={{ py: 6, color: "#6b7280" }}
                  >
                    No students enrolled in this group
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
                      fontSize: "0.75rem",
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
      <Paper
        sx={{
          p: 3,
          width: "100%",
          maxWidth: "1000px",
          borderRadius: "16px",
          boxShadow:
            "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.05)",
          border: "1px solid #e5e7eb",
          backgroundColor: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography
            variant="subtitle1"
            sx={{ fontWeight: 500, color: "#111827" }}
          >
            Access Code:{" "}
            <span className="font-mono tracking-wide text-emerald-600">
              {accessCode}
            </span>
          </Typography>
          <IconButton
            aria-label="Copy access code"
            onClick={handleCopyAccessCode}
            disabled={accessCode === "loading..."}
            size="small"
            sx={{
              backgroundColor: "#ecfdf5",
              border: "1px solid #d1fae5",
              borderRadius: "10px",
              "&:hover": { backgroundColor: "#d1fae5" },
            }}
          >
            <ContentCopyIcon sx={{ fontSize: 16, color: "#059669" }} />
          </IconButton>
          {copied && (
            <span className="text-emerald-600 text-sm font-medium">
              Copied!
            </span>
          )}
        </Box>
        <Button
          variant="contained"
          onClick={handleGenerateAccessCode}
          sx={{
            backgroundColor: "#10b981",
            borderRadius: "10px",
            textTransform: "none",
            fontWeight: 600,
            "&:hover": { backgroundColor: "#059669" },
          }}
        >
          Generate New Access Code
        </Button>
      </Paper>
    </Box>
  );
};

export default ViewStudents;
