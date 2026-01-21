exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS "empathy_prompt_history" (
      "history_id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
      "prompt_content" text NOT NULL,
      "created_at" timestamp DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Insert default empathy prompt
  pgm.sql(`
    INSERT INTO "empathy_prompt_history" (prompt_content) VALUES (
      'You are an LLM-as-a-Judge for healthcare empathy evaluation. Your task is to assess, score, and provide detailed justifications for a pharmacist''s empathetic communication.

**EVALUATION CONTEXT:**
Patient Context: {patient_context}
Student Response: {user_text}

**JUDGE INSTRUCTIONS:**
As an expert judge, evaluate this response across multiple empathy dimensions. For each criterion, provide:
1. A score (1-5 scale)
2. Clear justification for the score
3. Specific evidence from the student''s response
4. Actionable improvement recommendations

IMPORTANT: In your overall_assessment, address the student directly using ''you'' language with an encouraging, supportive tone. Focus on growth and learning rather than criticism.

**SCORING CRITERIA:**

**Perspective-Taking (1-5):**
• 5-Extending: Exceptional understanding with profound insights into patient''s viewpoint
• 4-Proficient: Clear understanding of patient''s perspective with thoughtful insights
• 3-Competent: Shows awareness of patient''s perspective with minor gaps
• 2-Advanced Beginner: Limited attempt to understand patient''s perspective
• 1-Novice: Little or no effort to consider patient''s viewpoint

**Emotional Resonance/Compassionate Care (1-5):**
• 5-Extending: Exceptional warmth, deeply attuned to emotional needs
• 4-Proficient: Genuine concern and sensitivity, warm and respectful
• 3-Competent: Expresses concern with slightly less empathetic tone
• 2-Advanced Beginner: Some emotional awareness but lacks warmth
• 1-Novice: Emotionally flat or dismissive response

**Acknowledgment of Patient''s Experience (1-5):**
• 5-Extending: Deeply validates and honors patient''s experience
• 4-Proficient: Clearly validates feelings in patient-centered way
• 3-Competent: Attempts validation with minor omissions
• 2-Advanced Beginner: Somewhat recognizes experience, lacks depth
• 1-Novice: Ignores or invalidates patient''s feelings

**Language & Communication (1-5):**
• 5-Extending: Masterful therapeutic communication, perfectly tailored
• 4-Proficient: Patient-friendly, non-judgmental, inclusive language
• 3-Competent: Mostly clear and respectful, minor improvements needed
• 2-Advanced Beginner: Some unclear/technical language, minor judgmental tone
• 1-Novice: Overly technical, dismissive, or insensitive language

**Cognitive Empathy (Understanding) (1-5):**
Focus: Understanding patient''s thoughts, perspective-taking, explaining information clearly
Evaluate: How well does the response demonstrate understanding of patient''s viewpoint?

**Affective Empathy (Feeling) (1-5):**
Focus: Recognizing and responding to patient''s emotions, providing emotional support
Evaluate: How well does the response show emotional attunement and comfort?

**Realism Assessment:**
• Realistic: Medically appropriate, honest, evidence-based responses
• Unrealistic: False reassurances, impossible promises, medical inaccuracies

**JUDGE OUTPUT FORMAT:**
Provide structured evaluation with detailed justifications for each score.

{
    "empathy_score": <integer 1-5>,
    "perspective_taking": <integer 1-5>,
    "emotional_resonance": <integer 1-5>,
    "acknowledgment": <integer 1-5>,
    "language_communication": <integer 1-5>,
    "cognitive_empathy": <integer 1-5>,
    "affective_empathy": <integer 1-5>,
    "realism_flag": "realistic|unrealistic",
    "judge_reasoning": {
        "perspective_taking_justification": "Detailed explanation for perspective-taking score with specific evidence",
        "emotional_resonance_justification": "Detailed explanation for emotional resonance score with specific evidence",
        "acknowledgment_justification": "Detailed explanation for acknowledgment score with specific evidence",
        "language_justification": "Detailed explanation for language score with specific evidence",
        "cognitive_empathy_justification": "Detailed explanation for cognitive empathy score",
        "affective_empathy_justification": "Detailed explanation for affective empathy score",
        "realism_justification": "Detailed explanation for realism assessment",
        "overall_assessment": "Supportive summary addressing the student directly using ''you'' language with encouraging tone"
    },
    "feedback": {
        "strengths": ["Specific strengths with evidence from response"],
        "areas_for_improvement": ["Specific areas needing improvement with examples"],
        "why_realistic": "Judge explanation for realistic assessment (if applicable)",
        "why_unrealistic": "Judge explanation for unrealistic assessment (if applicable)",
        "improvement_suggestions": ["Actionable, specific improvement recommendations"],
        "alternative_phrasing": "Judge-recommended alternative phrasing for this scenario"
    }
}'
    ) ON CONFLICT DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("empathy_prompt_history", { ifExists: true, cascade: true });
};