import React from "react";
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  Divider,
} from "@mui/material";

const EmpathyCoachSummary = ({ empathyData }) => {
  if (!empathyData) {
    return <Typography>No empathy data available.</Typography>;
  }

  // Helper function to get color based on score
  const getScoreColor = (score) => {
    if (score >= 4.5) return "#4CAF50"; // Green
    if (score >= 3.5) return "#8BC34A"; // Light Green
    if (score >= 2.5) return "#FFC107"; // Amber
    if (score >= 1.5) return "#FF9800"; // Orange
    return "#F44336"; // Red
  };

  // Helper function to render stars based on score
  const renderStars = (score) => {
    const stars = "⭐".repeat(Math.round(score));
    return (
      <Typography component="span" sx={{ ml: 1 }}>
        {stars}
      </Typography>
    );
  };

  // Get level name based on score
  const getLevelName = (score) => {
    if (score >= 4.5) return "Extending";
    if (score >= 3.5) return "Proficient";
    if (score >= 2.5) return "Competent";
    if (score >= 1.5) return "Advanced Beginner";
    return "Novice";
  };

  const overallScore = parseFloat(empathyData.overall_score) || 0;
  const scoreColor = getScoreColor(overallScore);
  const levelName = getLevelName(overallScore);

  return (
    <Box sx={{ width: "100%", p: 2 }}>
      {/* Score Progress Bar */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Overall Empathy Score: {levelName} {renderStars(overallScore)}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={(overallScore / 5) * 100}
          sx={{
            height: 10,
            borderRadius: 5,
            backgroundColor: "#e0e0e0",
            "& .MuiLinearProgress-bar": {
              backgroundColor: scoreColor,
            },
          }}
        />
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* Main Table */}
      <TableContainer component={Paper} elevation={3}>
        <Table sx={{ borderCollapse: "collapse" }}>
          <TableHead>
            <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
              <TableCell colSpan={2}>
                <Typography variant="h6">Empathy Coach Summary</Typography>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {/* Category Breakdown */}
            <TableRow>
              <TableCell 
                component="th" 
                scope="row" 
                sx={{ 
                  width: "30%", 
                  borderRight: "1px solid rgba(224, 224, 224, 1)",
                  verticalAlign: "top"
                }}
              >
                <Typography variant="subtitle1">Category Breakdown</Typography>
              </TableCell>
              <TableCell sx={{ verticalAlign: "top" }}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <Typography>
                    • Perspective-Taking: {getLevelName(empathyData.avg_perspective_taking)}
                    {renderStars(empathyData.avg_perspective_taking)}
                  </Typography>
                  <Typography>
                    • Emotional Resonance: {getLevelName(empathyData.avg_emotional_resonance)}
                    {renderStars(empathyData.avg_emotional_resonance)}
                  </Typography>
                  <Typography>
                    • Acknowledgment: {getLevelName(empathyData.avg_acknowledgment)}
                    {renderStars(empathyData.avg_acknowledgment)}
                  </Typography>
                  <Typography>
                    • Language & Communication: {getLevelName(empathyData.avg_language_communication)}
                    {renderStars(empathyData.avg_language_communication)}
                  </Typography>
                </Box>
              </TableCell>
            </TableRow>

            {/* Empathy Type Analysis */}
            <TableRow>
              <TableCell 
                component="th" 
                scope="row"
                sx={{ 
                  borderRight: "1px solid rgba(224, 224, 224, 1)",
                  verticalAlign: "top"
                }}
              >
                <Typography variant="subtitle1">Empathy Type Analysis</Typography>
              </TableCell>
              <TableCell sx={{ verticalAlign: "top" }}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <Typography>
                    • Cognitive Empathy (Understanding): {getLevelName(empathyData.avg_cognitive_empathy)}
                    {renderStars(empathyData.avg_cognitive_empathy)}
                  </Typography>
                  <Typography>
                    • Affective Empathy (Feeling): {getLevelName(empathyData.avg_affective_empathy)}
                    {renderStars(empathyData.avg_affective_empathy)}
                  </Typography>
                </Box>
              </TableCell>
            </TableRow>

            {/* Realism Assessment */}
            <TableRow>
              <TableCell 
                component="th" 
                scope="row"
                sx={{ 
                  borderRight: "1px solid rgba(224, 224, 224, 1)",
                  verticalAlign: "top"
                }}
              >
                <Typography variant="subtitle1">Realism Assessment</Typography>
              </TableCell>
              <TableCell sx={{ verticalAlign: "top" }}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  <Typography>
                    {empathyData.realism_assessment || "Your responses are generally realistic"}
                    {!empathyData.realism_assessment?.includes("unrealistic") && " ✅"}
                  </Typography>
                  <Typography variant="body2" sx={{ fontStyle: "italic", mt: 0.5 }}>
                    {empathyData.realism_explanation || ""}
                  </Typography>
                </Box>
              </TableCell>
            </TableRow>

            {/* Coach Assessment */}
            <TableRow>
              <TableCell 
                component="th" 
                scope="row"
                sx={{ 
                  borderRight: "1px solid rgba(224, 224, 224, 1)",
                  verticalAlign: "top"
                }}
              >
                <Typography variant="subtitle1">Coach Assessment</Typography>
              </TableCell>
              <TableCell sx={{ verticalAlign: "top" }}>
                <Typography sx={{ whiteSpace: "pre-line" }}>
                  {empathyData.coach_assessment || empathyData.summary || "No assessment available."}
                </Typography>
              </TableCell>
            </TableRow>

            {/* Strengths */}
            <TableRow>
              <TableCell 
                component="th" 
                scope="row"
                sx={{ 
                  borderRight: "1px solid rgba(224, 224, 224, 1)",
                  verticalAlign: "top"
                }}
              >
                <Typography variant="subtitle1">Strengths</Typography>
              </TableCell>
              <TableCell sx={{ verticalAlign: "top" }}>
                {empathyData.strengths ? (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {empathyData.strengths.map((strength, index) => (
                      <Typography key={index}>• {strength}</Typography>
                    ))}
                  </Box>
                ) : (
                  <Typography>No specific strengths identified yet.</Typography>
                )}
              </TableCell>
            </TableRow>

            {/* Areas for Improvement */}
            <TableRow>
              <TableCell 
                component="th" 
                scope="row"
                sx={{ 
                  borderRight: "1px solid rgba(224, 224, 224, 1)",
                  verticalAlign: "top"
                }}
              >
                <Typography variant="subtitle1">Areas for Improvement</Typography>
              </TableCell>
              <TableCell sx={{ verticalAlign: "top" }}>
                {empathyData.areas_for_improvement ? (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {empathyData.areas_for_improvement.map((area, index) => (
                      <Typography key={index}>• {area}</Typography>
                    ))}
                  </Box>
                ) : (
                  <Typography>No specific areas for improvement identified yet.</Typography>
                )}
              </TableCell>
            </TableRow>

            {/* Coach Recommendations */}
            <TableRow>
              <TableCell 
                component="th" 
                scope="row"
                sx={{ 
                  borderRight: "1px solid rgba(224, 224, 224, 1)",
                  verticalAlign: "top"
                }}
              >
                <Typography variant="subtitle1">Coach Recommendations</Typography>
              </TableCell>
              <TableCell sx={{ verticalAlign: "top" }}>
                {empathyData.recommendations ? (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {empathyData.recommendations.map((rec, index) => (
                      <Typography key={index}>• {rec}</Typography>
                    ))}
                  </Box>
                ) : (
                  <Typography>No specific recommendations available yet.</Typography>
                )}
              </TableCell>
            </TableRow>

            {/* Coach-Recommended Approach */}
            <TableRow>
              <TableCell 
                component="th" 
                scope="row"
                sx={{ 
                  borderRight: "1px solid rgba(224, 224, 224, 1)",
                  verticalAlign: "top"
                }}
              >
                <Typography variant="subtitle1">Coach-Recommended Approach</Typography>
              </TableCell>
              <TableCell sx={{ verticalAlign: "top" }}>
                <Typography sx={{ fontStyle: "italic" }}>
                  {empathyData.recommended_approach || "No specific approach recommended yet."}
                </Typography>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default EmpathyCoachSummary;