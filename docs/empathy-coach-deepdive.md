# Empathy Coach Deep Dive Documentation

## Table of Contents
1. [Overview](#overview)
2. [Empathy Evaluation System](#empathy-evaluation-system)
3. [Scoring Methodology](#scoring-methodology)
4. [Judging Criteria & Rubric](#judging-criteria--rubric)
5. [Prompt Engineering](#prompt-engineering)
6. [Code Architecture](#code-architecture)
7. [Modification Guide](#modification-guide)
8. [Technical Implementation](#technical-implementation)

## Overview

The Empathy Coach is an AI-powered system that evaluates pharmacy students' empathetic communication skills during patient interactions. It uses Amazon Bedrock's Nova Pro model to provide real-time feedback on empathy dimensions.

### Key Features
- Real-time empathy evaluation during patient conversations
- Multi-dimensional scoring across 6 empathy categories
- Structured feedback with actionable recommendations
- Realism assessment for medical appropriateness
- Star-based rating system (1-5 stars)
- Detailed justifications for all scores

## Empathy Evaluation System

### Core Function Location
**File:** `chat.py`  
**Function:** `evaluate_empathy()`  
**Trigger:** Called in `get_response()` function for non-greeting student responses

### Evaluation Trigger Conditions
```python
# Evaluation is triggered when:
if query.strip() and "Greet me" not in query:
    # Student response evaluation occurs here
    empathy_evaluation = evaluate_empathy(query, patient_context, nova_client)
```

### Configuration
- **Model:** Amazon Nova Pro (`amazon.nova-pro-v1:0`)
- **Temperature:** 0.1 (low for consistency)
- **Max Tokens:** 1200
- **Region:** us-east-1

## Scoring Methodology

### Overall Score Calculation
**Location:** `get_response()`

```python
# Calculate overall empathy score as average of all dimensions
pt_score = empathy_evaluation.get('perspective_taking', 3)
er_score = empathy_evaluation.get('emotional_resonance', 3)
ack_score = empathy_evaluation.get('acknowledgment', 3)
lang_score = empathy_evaluation.get('language_communication', 3)
cognitive_score = empathy_evaluation.get('cognitive_empathy', 3)
affective_score = empathy_evaluation.get('affective_empathy', 3)

# Calculate average and round to nearest whole number
overall_score = round((pt_score + er_score + ack_score + lang_score + cognitive_score + affective_score) / 6)
```

### Score-to-Level Mapping
**Function:** `get_empathy_level_name()`

| Score | Level Name | Description |
|-------|------------|-------------|
| 1 | Novice | Minimal empathetic response |
| 2 | Advanced Beginner | Basic empathy with gaps |
| 3 | Competent | Adequate empathetic communication |
| 4 | Proficient | Strong empathetic skills |
| 5 | Extending | Exceptional empathy mastery |

### Star Rating System
**Location:** `get_response()`

```python
# Star rating based on calculated overall score
if overall_score == 1:
    stars = "⭐ (1/5)"
elif overall_score == 2:
    stars = "⭐⭐ (2/5)"
elif overall_score == 3:
    stars = "⭐⭐⭐ (3/5)"
elif overall_score == 4:
    stars = "⭐⭐⭐⭐ (4/5)"
elif overall_score == 5:
    stars = "⭐⭐⭐⭐⭐ (5/5)"
else:
    stars = "⭐⭐⭐ (3/5)"  # Default fallback
```

## Judging Criteria & Rubric

### Six Empathy Dimensions

#### 1. Perspective-Taking (1-5)
**Evaluates:** Understanding of patient's viewpoint and situation

- **5-Extending:** Exceptional understanding with profound insights into patient's viewpoint
- **4-Proficient:** Clear understanding of patient's perspective with thoughtful insights
- **3-Competent:** Shows awareness of patient's perspective with minor gaps
- **2-Advanced Beginner:** Limited attempt to understand patient's perspective
- **1-Novice:** Little or no effort to consider patient's viewpoint

#### 2. Emotional Resonance/Compassionate Care (1-5)
**Evaluates:** Warmth, sensitivity, and emotional attunement

- **5-Extending:** Exceptional warmth, deeply attuned to emotional needs
- **4-Proficient:** Genuine concern and sensitivity, warm and respectful
- **3-Competent:** Expresses concern with slightly less empathetic tone
- **2-Advanced Beginner:** Some emotional awareness but lacks warmth
- **1-Novice:** Emotionally flat or dismissive response

#### 3. Acknowledgment of Patient's Experience (1-5)
**Evaluates:** Validation and recognition of patient's feelings

- **5-Extending:** Deeply validates and honors patient's experience
- **4-Proficient:** Clearly validates feelings in patient-centered way
- **3-Competent:** Attempts validation with minor omissions
- **2-Advanced Beginner:** Somewhat recognizes experience, lacks depth
- **1-Novice:** Ignores or invalidates patient's feelings

#### 4. Language & Communication (1-5)
**Evaluates:** Clarity, appropriateness, and therapeutic communication

- **5-Extending:** Masterful therapeutic communication, perfectly tailored
- **4-Proficient:** Patient-friendly, non-judgmental, inclusive language
- **3-Competent:** Mostly clear and respectful, minor improvements needed
- **2-Advanced Beginner:** Some unclear/technical language, minor judgmental tone
- **1-Novice:** Overly technical, dismissive, or insensitive language

#### 5. Cognitive Empathy (Understanding) (1-5)
**Focus:** Understanding patient's thoughts, perspective-taking, explaining information clearly

#### 6. Affective Empathy (Feeling) (1-5)
**Focus:** Recognizing and responding to patient's emotions, providing emotional support

### Realism Assessment
**Binary Classification:** Realistic vs Unrealistic

- **Realistic:** Medically appropriate, honest, evidence-based responses
- **Unrealistic:** False reassurances, impossible promises, medical inaccuracies

## Prompt Engineering

### Admin Control
The empathy coach prompt can be **controlled and adjusted by administrators** through the **Admin View** under **"AI Settings"**. This allows for:
- Real-time prompt modifications without code deployment
- A/B testing of different evaluation approaches
- Fine-tuning based on student performance data
- Customization for different pharmacy programs or specializations

### Main Evaluation Prompt
**Location:** `evaluate_empathy()`

The prompt is structured as follows:

#### 1. Role Definition
```
You are an LLM-as-a-Judge for healthcare empathy evaluation. Your task is to assess, score, and provide detailed justifications for a pharmacy student's empathetic communication.
```

#### 2. Context Injection
```
**EVALUATION CONTEXT:**
Patient Context: {patient_context}
Student Response: {student_response}
```

#### 3. Judge Instructions
- Evaluate across multiple empathy dimensions
- Provide scores (1-5 scale) with justifications
- Include specific evidence from student's response
- Offer actionable improvement recommendations
- Use encouraging, supportive tone addressing student directly

#### 4. Detailed Scoring Criteria
Each dimension includes 5-level rubric with specific descriptors

#### 5. Output Format Specification
Structured JSON format with:
- Individual dimension scores
- Detailed justifications
- Structured feedback with strengths/improvements
- Alternative phrasing suggestions

### Key Prompt Engineering Techniques

1. **Role-Based Prompting:** Clear judge role definition
2. **Few-Shot Learning:** Detailed rubric examples for each score level
3. **Structured Output:** JSON schema enforcement
4. **Context Injection:** Patient information and student response
5. **Tone Specification:** Encouraging, growth-focused language
6. **Evidence Requirement:** Specific examples from student response

## Code Architecture

### Main Evaluation Flow

```
get_response() 
├── Check if student response (not greeting)
├── Call evaluate_empathy()
│   ├── Construct evaluation prompt
│   ├── Call Nova Pro via Bedrock
│   ├── Parse JSON response
│   └── Return structured evaluation
├── Calculate overall score (average of 6 dimensions)
├── Format feedback with stars and levels
├── Save to PostgreSQL database
└── Return formatted response
```

### Key Functions

1. **`evaluate_empathy()`** - Core evaluation logic
2. **`get_empathy_level_name()`** - Score to level conversion
3. **`save_message_to_db()`** - Database persistence
4. **`get_response()`** - Main orchestration function

### Error Handling
**Location:** `evaluate_empathy()`

```python
# Fallback scoring when evaluation fails
return {
    "empathy_score": 3,
    "perspective_taking": 3,
    "emotional_resonance": 3,
    "acknowledgment": 3,
    "language_communication": 3,
    "cognitive_empathy": 3,
    "affective_empathy": 3,
    "realism_flag": "realistic",
    "evaluation_method": "LLM-as-a-Judge",
    "judge_model": bedrock_client["model_id"],
    "feedback": "System error - unable to evaluate. Please try again."
}
```

## Modification Guide

### 1. Changing Scoring Criteria

**Location to Modify:** `evaluate_empathy()`

To modify rubric levels:
```python
# Example: Adding a new level 6 "Expert"
**Perspective-Taking (1-6):**
• 6-Expert: Revolutionary understanding transcending traditional patient care
• 5-Extending: Exceptional understanding with profound insights into patient's viewpoint
# ... rest of levels
```

### 2. Adding New Empathy Dimensions

**Step 1:** Add to evaluation prompt
```python
**New_Dimension_Name (1-5):**
• 5-Extending: Description of highest level
• 4-Proficient: Description of proficient level
# ... continue pattern
```

**Step 2:** Update JSON output format
```python
"new_dimension_name": <integer 1-5>,
```

**Step 3:** Update score calculation
```python
new_dim_score = empathy_evaluation.get('new_dimension_name', 3)
# Add to average calculation
overall_score = round((pt_score + er_score + ack_score + lang_score + cognitive_score + affective_score + new_dim_score) / 7)
```

**Step 4:** Update feedback display
```python
new_dim_level = get_empathy_level_name(new_dim_score)
new_dim_stars = "⭐" * new_dim_score + f" ({new_dim_score}/5)"
empathy_feedback += f"• New Dimension: {new_dim_level} {new_dim_stars}\n"
```

### 3. Changing Temperature/Creativity

**Location:** `evaluate_empathy()`

```python
"inferenceConfig": {
    "temperature": 0.3,  # Higher for more creative responses
    "maxTokens": 1200
}
```

### 4. Modifying Feedback Format

**Location:** `get_response()`

Example - Adding emoji indicators:
```python
# Add custom formatting
if overall_score >= 4:
    empathy_feedback += f"🎉 **Excellent Work!** "
elif overall_score >= 3:
    empathy_feedback += f"👍 **Good Progress!** "
else:
    empathy_feedback += f"💪 **Keep Practicing!** "
```

### 5. Adjusting Evaluation Triggers

**Location:** `get_response()`

```python
# Current trigger
if query.strip() and "Greet me" not in query:

# Modified trigger - evaluate all responses
if query.strip():

# Or add minimum word count
if query.strip() and len(query.split()) >= 5 and "Greet me" not in query:
```

### 6. Customizing Prompt Instructions

**Key Sections to Modify:**

**LLM Role:**
```python
# Make more specific
You are an expert healthcare communication evaluator specializing in pharmacy student empathy assessment...
```

**Tone Instructions:**
```python
# Modify tone
IMPORTANT: In your overall_assessment, provide constructive criticism with specific examples...
```

**Output Requirements:**
```python
# Add new fields
"confidence_score": <float 0.0-1.0>,
"improvement_priority": "high|medium|low",
```

## Technical Implementation

### Database Integration
**Function:** `save_message_to_db()`

Empathy evaluations are stored in PostgreSQL with:
- Session ID
- Message content  
- Complete empathy evaluation JSON
- Timestamp

### Error Recovery
The system includes multiple fallback mechanisms:
1. JSON parsing errors → Default scores (3/5)
2. Model unavailability → Graceful degradation
3. Database errors → Logged but non-blocking

### Performance Considerations
- **Async Evaluation:** Empathy evaluation runs during response generation
- **Caching:** Session history cached in DynamoDB
- **Timeout Handling:** 1200 token limit prevents long evaluations

### Security Features
- **Input Validation:** Student responses sanitized
- **Prompt Injection Protection:** Structured evaluation format
- **Rate Limiting:** Inherent through Bedrock quotas

## Best Practices for Modifications

1. **Test Incrementally:** Make small changes and test thoroughly
2. **Preserve Fallbacks:** Always maintain error handling
3. **Document Changes:** Update this documentation when modifying
4. **Validate JSON:** Ensure output format remains parseable
5. **Monitor Performance:** Track evaluation latency and accuracy
6. **Backup Prompts:** Save working prompts before modifications

## Troubleshooting Common Issues

### Low Evaluation Scores
- Check prompt clarity and examples
- Verify model temperature settings
- Review rubric alignment with expectations

### JSON Parsing Errors
- Validate output format specification
- Check for special characters in responses
- Ensure proper escape sequences

### Inconsistent Evaluations
- Lower temperature for more consistency
- Add more specific rubric examples
- Include calibration examples in prompt

---

*This documentation covers the complete Empathy Coach evaluation system. For additional technical details, refer to the source code comments and related documentation files.*