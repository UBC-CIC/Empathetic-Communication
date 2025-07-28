/**
 * Handler for fetching empathy summary for a student
 */
const studentEmpathySummary = async (event, sqlConnection) => {
  const { session_id, email, simulation_group_id, patient_id } = event.queryStringParameters || {};
  
  if (!session_id || !email || !simulation_group_id || !patient_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing required parameters" }),
    };
  }

  try {
    // First check if empathy_evaluation column exists
    const columnCheck = await sqlConnection`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'messages' AND column_name = 'empathy_evaluation';
    `;
    
    if (columnCheck.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          overall_score: 0,
          overall_level: "No Data",
          total_interactions: 0,
          empathy_interactions: 0,
          avg_perspective_taking: 0,
          avg_emotional_resonance: 0,
          avg_acknowledgment: 0,
          avg_language_communication: 0,
          avg_cognitive_empathy: 0,
          avg_affective_empathy: 0,
          summary: "Empathy evaluation feature not yet available."
        }),
      };
    }
    
    // Get user_id from email
    const userResult = await sqlConnection`
      SELECT user_id FROM "users" WHERE user_email = ${email} LIMIT 1;
    `;
    
    const userId = userResult[0]?.user_id;
    if (!userId) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "User not found" }),
      };
    }
    
    // Get all empathy evaluations for this session
    const empathyData = await sqlConnection`
      SELECT m.empathy_evaluation
      FROM "messages" m
      JOIN "sessions" s ON m.session_id = s.session_id
      JOIN "student_interactions" si ON s.student_interaction_id = si.student_interaction_id
      JOIN "enrolments" e ON si.enrolment_id = e.enrolment_id
      WHERE e.user_id = ${userId}
      AND e.simulation_group_id = ${simulation_group_id}
      AND si.patient_id = ${patient_id}
      AND m.student_sent = true
      AND m.empathy_evaluation IS NOT NULL;
    `;
    
    if (!empathyData || empathyData.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          overall_score: 0,
          overall_level: "No Data",
          total_interactions: 0,
          empathy_interactions: 0,
          avg_perspective_taking: 0,
          avg_emotional_resonance: 0,
          avg_acknowledgment: 0,
          avg_language_communication: 0,
          avg_cognitive_empathy: 0,
          avg_affective_empathy: 0,
          summary: "No empathy evaluation data available yet."
        }),
      };
    }
    
    // Calculate averages
    let totalScore = 0, totalPT = 0, totalER = 0, totalAck = 0, totalLang = 0, totalCog = 0, totalAff = 0;
    let validCount = 0;
    let strengths = [];
    let areasForImprovement = [];
    let recommendations = [];
    let recommendedApproach = "";
    let realisticCount = 0;
    let unrealisticCount = 0;
    let whyRealistic = [];
    let whyUnrealistic = [];
    
    // Process all evaluations
    empathyData.forEach(row => {
      const evaluation = row.empathy_evaluation;
      if (evaluation && typeof evaluation === 'object') {
        totalScore += evaluation.empathy_score || 0;
        totalPT += evaluation.perspective_taking || 0;
        totalER += evaluation.emotional_resonance || 0;
        totalAck += evaluation.acknowledgment || 0;
        totalLang += evaluation.language_communication || 0;
        totalCog += evaluation.cognitive_empathy || 0;
        totalAff += evaluation.affective_empathy || 0;
        validCount++;
        
        // Collect feedback data from the most recent evaluations (up to 3)
        if (validCount <= 3 && evaluation.feedback) {
          if (typeof evaluation.feedback === 'object') {
            // Add strengths
            if (evaluation.feedback.strengths && Array.isArray(evaluation.feedback.strengths)) {
              strengths = [...strengths, ...evaluation.feedback.strengths];
            }
            
            // Add areas for improvement
            if (evaluation.feedback.areas_for_improvement && Array.isArray(evaluation.feedback.areas_for_improvement)) {
              areasForImprovement = [...areasForImprovement, ...evaluation.feedback.areas_for_improvement];
            }
            
            // Add improvement suggestions
            if (evaluation.feedback.improvement_suggestions && Array.isArray(evaluation.feedback.improvement_suggestions)) {
              recommendations = [...recommendations, ...evaluation.feedback.improvement_suggestions];
            }
            
            // Get the most recent recommended approach
            if (evaluation.feedback.alternative_phrasing) {
              recommendedApproach = evaluation.feedback.alternative_phrasing;
            }
            
            // Count realism flags and collect reasoning
            if (evaluation.realism_flag === 'unrealistic') {
              unrealisticCount++;
              
              // Collect why_unrealistic feedback
              if (evaluation.feedback && evaluation.feedback.why_unrealistic) {
                whyUnrealistic.push(evaluation.feedback.why_unrealistic);
              }
            } else {
              realisticCount++;
              
              // Collect why_realistic feedback
              if (evaluation.feedback && evaluation.feedback.why_realistic) {
                whyRealistic.push(evaluation.feedback.why_realistic);
              }
            }
          }
        }
      }
    });
    
    // Calculate averages
    const avgScore = validCount > 0 ? (totalScore / validCount).toFixed(1) : 0;
    const avgPT = validCount > 0 ? (totalPT / validCount).toFixed(1) : 0;
    const avgER = validCount > 0 ? (totalER / validCount).toFixed(1) : 0;
    const avgAck = validCount > 0 ? (totalAck / validCount).toFixed(1) : 0;
    const avgLang = validCount > 0 ? (totalLang / validCount).toFixed(1) : 0;
    const avgCog = validCount > 0 ? (totalCog / validCount).toFixed(1) : 0;
    const avgAff = validCount > 0 ? (totalAff / validCount).toFixed(1) : 0;
    
    // Determine overall level
    const getLevel = (score) => {
      if (score >= 4.5) return "Extending";
      if (score >= 3.5) return "Proficient";
      if (score >= 2.5) return "Competent";
      if (score >= 1.5) return "Advanced Beginner";
      return "Novice";
    };
    
    // Generate summary
    const overallLevel = getLevel(parseFloat(avgScore));
    
    // Determine strongest areas
    const strengthAreas = [
      avgPT >= 3.5 ? 'perspective-taking' : '',
      avgER >= 3.5 ? 'emotional resonance' : '',
      avgAck >= 3.5 ? 'patient acknowledgment' : '',
      avgLang >= 3.5 ? 'communication language' : ''
    ].filter(Boolean).join(', ');
    
    // Determine areas for development
    const weaknessAreas = [
      avgPT < 3.5 ? 'perspective-taking' : '',
      avgER < 3.5 ? 'emotional resonance' : '',
      avgAck < 3.5 ? 'patient acknowledgment' : '',
      avgLang < 3.5 ? 'communication clarity' : ''
    ].filter(Boolean).join(', ');
    
    // Determine empathy profile
    let empathySummary = '';
    if (avgCog === avgAff) {
      empathySummary = avgCog >= 3.5
        ? 'a balanced and strong mix of cognitive (understanding) and affective (emotional connection) empathy'
        : 'a balanced but limited expression of both cognitive and affective empathy';
    } else {
      empathySummary = avgCog > avgAff
        ? 'stronger cognitive empathy (understanding)'
        : 'stronger affective empathy (emotional connection)';
    }
    
    // Final summary string
    const summary = `You demonstrate ${overallLevel.toLowerCase()} empathetic communication skills. ` +
      (strengthAreas ? `Your strongest areas include ${strengthAreas}. ` : '') +
      (weaknessAreas ? `Areas for development: ${weaknessAreas}. ` : '') +
      `You show ${empathySummary} in your interactions.`;
    
    // Get total interactions count
    const totalInteractions = await sqlConnection`
      SELECT COUNT(*) as count
      FROM "messages" m
      JOIN "sessions" s ON m.session_id = s.session_id
      JOIN "student_interactions" si ON s.student_interaction_id = si.student_interaction_id
      JOIN "enrolments" e ON si.enrolment_id = e.enrolment_id
      WHERE e.user_id = ${userId}
      AND e.simulation_group_id = ${simulation_group_id}
      AND si.patient_id = ${patient_id}
      AND m.student_sent = true;
    `;
    
    // Remove duplicates from arrays
    const uniqueStrengths = [...new Set(strengths)];
    const uniqueAreasForImprovement = [...new Set(areasForImprovement)];
    const uniqueRecommendations = [...new Set(recommendations)];
    const uniqueWhyRealistic = [...new Set(whyRealistic)];
    const uniqueWhyUnrealistic = [...new Set(whyUnrealistic)];
    
    // Generate realism explanation based on the most common assessment
    const isRealistic = realisticCount >= unrealisticCount;
    let realismExplanation = '';
    
    // If we have both realistic and unrealistic responses, provide a balanced explanation
    if (realisticCount > 0 && unrealisticCount > 0) {
      // Get the most recent or most representative explanations
      const realisticReason = uniqueWhyRealistic.length > 0 ? uniqueWhyRealistic[0] : '';
      const unrealisticReason = uniqueWhyUnrealistic.length > 0 ? uniqueWhyUnrealistic[0] : '';
      
      if (isRealistic) {
        realismExplanation = `While most of your responses are realistic, some contained unrealistic elements. ${realisticReason} However, be mindful that ${unrealisticReason.toLowerCase()}`;
      } else {
        realismExplanation = `Some of your responses contained unrealistic elements. ${unrealisticReason} In terms of what went well, ${realisticReason.toLowerCase()}`;
      }
    } else if (isRealistic) {
      // All or mostly realistic responses
      realismExplanation = uniqueWhyRealistic.length > 0 
        ? uniqueWhyRealistic[0] 
        : 'Your responses use appropriate clinical language and approaches consistent with healthcare practice.';
    } else {
      // All or mostly unrealistic responses
      realismExplanation = uniqueWhyUnrealistic.length > 0 
        ? uniqueWhyUnrealistic[0] 
        : 'Your responses contain elements that may not align with typical clinical practice.';
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        overall_score: avgScore,
        overall_level: overallLevel,
        total_interactions: totalInteractions[0]?.count || 0,
        empathy_interactions: validCount,
        avg_perspective_taking: avgPT,
        avg_emotional_resonance: avgER,
        avg_acknowledgment: avgAck,
        avg_language_communication: avgLang,
        avg_cognitive_empathy: avgCog,
        avg_affective_empathy: avgAff,
        summary: summary,
        strengths: uniqueStrengths.length > 0 ? uniqueStrengths : null,
        areas_for_improvement: uniqueAreasForImprovement.length > 0 ? uniqueAreasForImprovement : null,
        recommendations: uniqueRecommendations.length > 0 ? uniqueRecommendations : null,
        recommended_approach: recommendedApproach || null,
        realism_assessment: `Your responses are generally ${realisticCount >= unrealisticCount ? 'realistic' : 'unrealistic'}`,
        realism_explanation: realismExplanation
      }),
    };
  } catch (error) {
    console.error("Error fetching empathy summary:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch empathy summary" }),
    };
  }
};

module.exports = studentEmpathySummary;