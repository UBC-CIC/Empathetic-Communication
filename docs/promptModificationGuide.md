# Prompt Modification Guide

This guide documents the different prompt editors available in the Empathetic Communication application and explains how to use them effectively to customize AI behavior at various levels.

## Overview

The application provides a hierarchical prompt system that allows customization of AI behavior at three distinct levels:

1. **Global System Prompt** (Admin Level) - Affects all users and simulation groups
2. **Simulation Group Prompt** (Admin & Instructor Level) - Affects specific simulation groups
3. **Patient-Specific Prompt** (Instructor Level) - Affects individual patients

## 1. Global System Prompt (Admin Only)

### Purpose

The global system prompt defines the fundamental behavior of the AI across the entire application. This prompt is applied universally to all users, simulation groups, and patients.

### Access

- **Who can modify**: Admin users only
- **Location**: Admin Dashboard → AI Settings
- **Interface**: `AISettings.jsx` component

### Features

- **Current Prompt Editor**: Large text area for editing the active system prompt
- **Default Prompt Loading**: Button to restore the built-in default prompt
- **Prompt History**: Navigate through previous system prompts with restore functionality
- **Version Control**: All changes are automatically saved to history with timestamps

### Usage Instructions

1. Navigate to the Admin Dashboard
2. Select "AI Settings" from the admin menu
3. Edit the system prompt in the "System Prompt Manager" section
4. Click "Save System Prompt" to apply changes globally
5. Use "Load Default Prompt" to restore the original system prompt if needed

### Default System Prompt

The application includes a comprehensive default prompt that:

- Establishes the AI as a patient role-playing character
- Sets response guidelines (brief, realistic, matter-of-fact)
- Prevents emotional overreactions
- Includes security measures against prompt injection
- Maintains patient character consistency

### Impact

Changes to the global system prompt affect:

- All simulation groups
- All patients
- All user interactions
- Both new and existing conversations

## 2. Simulation Group Prompt (Admin & Instructor Level)

### Purpose

Simulation group prompts allow instructors to customize AI behavior for their specific simulation groups while inheriting the global system prompt as a foundation.

### Access

- **Who creates it**: The admin user who creates the simulation group
- **Who can modify**: Instructors enrolled in the simulation group
- **Location**: Instructor Dashboard → [Group Name] → Prompt Settings
- **Interface**: `PromptSettings.jsx` component

### Features

- **Group-Specific Customization**: Modify prompts for individual simulation groups
- **Example Prompt Display**: Shows a sample prompt for reference
- **Character Limit**: 1000 character limit for prompt modifications
- **Previous Prompts History**: View and navigate through previous prompt versions
- **Real-time Character Counter**: Displays current character usage

### Usage Instructions

1. Navigate to the Instructor Dashboard
2. Select the desired simulation group
3. Click on "Prompt Settings" in the group menu
4. Edit the prompt in the "Your Prompt" text area
5. Review the character count (max 1000 characters)
6. Click "Save" to apply changes to the simulation group

### Prompt History

- **Navigation**: Use Previous/Next buttons to browse prompt history
- **Timestamps**: Each previous prompt shows when it was created
- **Restoration**: Previous prompts are view-only (no direct restoration feature)

### Impact

Changes to simulation group prompts affect:

- All patients within the specific simulation group
- All students enrolled in that simulation group
- New conversations started after the change

## 3. Patient-Specific Prompt (Instructor Level)

### Purpose

Patient-specific prompts provide the most granular level of customization, allowing instructors to define unique characteristics and behaviors for individual patients.

### Access

- **Who can modify**: Instructors with access to the simulation group
- **Location**: Instructor Dashboard → [Group Name] → Patients → Edit Patient
- **Interface**: `InstructorEditPatients.jsx` and `InstructorNewPatient.jsx` components

### Features

- **Individual Patient Customization**: Each patient can have a unique prompt
- **Multi-line Text Editor**: Supports detailed patient characterization
- **Integration with Patient Data**: Works alongside patient demographics and files
- **Required Field**: Patient prompt is mandatory for patient creation

### Usage Instructions

#### For New Patients:

1. Navigate to Instructor Dashboard → [Group Name] → Patients
2. Click "Create New Patient"
3. Fill in patient demographics (name, age, gender)
4. Enter the patient-specific prompt in the "Patient Prompt" field
5. Upload relevant files (LLM documents, patient info, answer keys)
6. Click "Save Patient"

#### For Existing Patients:

1. Navigate to Instructor Dashboard → [Group Name] → Patients
2. Select the patient to edit
3. Modify the "Patient Prompt" field as needed
4. Click "Save Patient" to apply changes

### Patient Prompt Guidelines

Patient prompts should define:

- Specific medical conditions or symptoms
- Patient personality traits
- Communication style preferences
- Relevant background information
- Specific learning objectives

### Impact

Patient-specific prompts affect:

- Only the individual patient
- All students interacting with that patient
- Both new and existing conversations with that patient

## Prompt Hierarchy and Inheritance

The application uses a hierarchical prompt system where:

1. **Global System Prompt** provides the base behavior framework
2. **Simulation Group Prompt** adds group-specific modifications
3. **Patient-Specific Prompt** defines individual patient characteristics

### Effective Prompt Structure

```
[Global System Prompt]
+ [Simulation Group Customizations]
+ [Patient-Specific Details]
= Final AI Behavior
```

## Best Practices

### For Administrators

- **Test thoroughly**: Changes affect all users - test in a controlled environment first
- **Document changes**: Keep track of why changes were made
- **Use history**: Leverage the prompt history feature to revert problematic changes
- **Coordinate with instructors**: Communicate major changes to teaching staff

### For Instructors

- **Be specific**: Clear, detailed prompts produce better patient simulations
- **Stay within limits**: Respect the 1000-character limit for group prompts
- **Test with students**: Verify that prompt changes achieve desired learning outcomes
- **Use patient prompts effectively**: Leverage patient-specific prompts for detailed scenarios

### General Guidelines

- **Avoid contradictions**: Ensure prompts at different levels don't conflict
- **Maintain consistency**: Keep prompts aligned with educational objectives
- **Security awareness**: Don't include sensitive information in prompts
- **Regular review**: Periodically review and update prompts based on usage feedback

## Troubleshooting

### Common Issues

**Prompt not taking effect:**

- Verify you have the correct permissions
- Check that changes were saved successfully
- Start a new conversation to see changes (existing conversations may retain old behavior)

**Character limit exceeded:**

- Use concise language
- Focus on essential characteristics
- Consider moving detailed information to patient files instead

**Conflicting behaviors:**

- Review the prompt hierarchy
- Ensure prompts at different levels complement each other
- Test the combined effect of all prompt levels

### Support

For technical issues with prompt modification:

1. Check the troubleshooting guide
2. Verify user permissions and roles
3. Contact system administrators for global prompt issues
4. Review the application logs for error messages

## Security Considerations

### Prompt Injection Prevention

The system includes built-in protections against prompt injection attacks:

- Instructions to ignore role-changing requests
- Refusal to reveal system prompts
- Maintenance of patient character consistency

### Access Control

- **Admin-only global access**: Only administrators can modify system-wide prompts
- **Instructor group access**: Instructors can only modify prompts for their assigned groups
- **Audit trail**: All prompt changes are logged with timestamps and user information

### Content Guidelines

- Avoid including personal or sensitive information
- Ensure prompts align with educational and ethical standards
- Review prompts regularly for appropriateness
- Follow institutional guidelines for AI-assisted education

## API Endpoints

For developers and advanced users, the following API endpoints handle prompt management:

### Admin Endpoints

- `GET /admin/system_prompts` - Retrieve current system prompt and history
- `POST /admin/update_system_prompt` - Update the global system prompt
- `POST /admin/restore_system_prompt` - Restore a previous system prompt

### Instructor Endpoints

- `GET /instructor/get_prompt` - Get simulation group prompt
- `PUT /instructor/prompt` - Update simulation group prompt
- `GET /instructor/previous_prompts` - Get prompt history for a group
- `PUT /instructor/edit_patient` - Update patient information including prompts

## Conclusion

The prompt modification system provides flexible control over AI behavior at multiple levels. By understanding and effectively using these tools, administrators and instructors can create tailored educational experiences that meet specific learning objectives while maintaining consistency and security across the platform.

Regular review and refinement of prompts, combined with student feedback, will help optimize the educational value of the AI-powered patient simulations.
