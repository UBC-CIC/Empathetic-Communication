import boto3, re, json, logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

from langchain_aws import ChatBedrock
from langchain_aws import BedrockLLM
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain.chains import create_retrieval_chain
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_community.chat_message_histories import DynamoDBChatMessageHistory
from langchain_core.pydantic_v1 import BaseModel, Field

class LLM_evaluation(BaseModel):
    response: str = Field(description="Assessment of the student's answer with a follow-up question.")
    verdict: str = Field(description="'True' if the student has properly diagnosed the patient, 'False' otherwise.")


def create_dynamodb_history_table(table_name: str) -> bool:
    """
    Create a DynamoDB table to store the session history if it doesn't already exist.

    Args:
    table_name (str): The name of the DynamoDB table to create.

    Returns:
    None
    
    If the table already exists, this function does nothing. Otherwise, it creates a 
    new table with a key schema based on 'SessionId'.
    """
    # Get the service resource and client.
    dynamodb_resource = boto3.resource("dynamodb")
    dynamodb_client = boto3.client("dynamodb")
    
    # Retrieve the list of tables that currently exist.
    existing_tables = []
    exclusive_start_table_name = None
    
    while True:
        if exclusive_start_table_name:
            response = dynamodb_client.list_tables(ExclusiveStartTableName=exclusive_start_table_name)
        else:
            response = dynamodb_client.list_tables()
        
        existing_tables.extend(response.get('TableNames', []))
        
        if 'LastEvaluatedTableName' in response:
            exclusive_start_table_name = response['LastEvaluatedTableName']
        else:
            break
    
    if table_name not in existing_tables:  # Create a new table if it doesn't exist.
        # Create the DynamoDB table.
        table = dynamodb_resource.create_table(
            TableName=table_name,
            KeySchema=[{"AttributeName": "SessionId", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "SessionId", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        
        # Wait until the table exists.
        table.meta.client.get_waiter("table_exists").wait(TableName=table_name)

def get_bedrock_llm(
    bedrock_llm_id: str,
    temperature: float = 0
) -> ChatBedrock:
    """
    Retrieve a Bedrock LLM instance based on the provided model ID.

    Args:
    bedrock_llm_id (str): The unique identifier for the Bedrock LLM model.
    temperature (float, optional): The temperature parameter for the LLM, controlling 
    the randomness of the generated responses. Defaults to 0.

    Returns:
    ChatBedrock: An instance of the Bedrock LLM corresponding to the provided model ID.
    """
    return ChatBedrock(
        model_id=bedrock_llm_id,
        model_kwargs=dict(temperature=temperature),
    )

def get_student_query(raw_query: str) -> str:
    """
    Format the student's raw query into a specific template suitable for processing.

    Args:
    raw_query (str): The raw query input from the student.

    Returns:
    str: The formatted query string ready for further processing.
    """
    student_query = f"""
    user
    {raw_query}
    
    """
    return student_query

def get_initial_student_query(patient_name: str) -> str:
    """
    Generate an initial query for the student to interact with the system. 
    The query asks the student to greet the system and then requests a question related to a specified patient.

    Args:
    patient_name (str): The name of the patient for which the initial question should be generated.

    Returns:
    str: The formatted initial query string for the student.
    """
    student_query = f"""
    user
    Greet me and then ask me a question related to the patient: {patient_name}. 
    """
    return student_query

def get_response(
    query: str,
    patient_name: str,
    llm: ChatBedrock,
    history_aware_retriever,
    table_name: str,
    session_id: str,
    system_prompt: str,
    patient_age: str,
    patient_prompt: str,
    llm_completion: bool
) -> dict:
    """
    Generates a response to a query using the LLM and a history-aware retriever for context.

    Args:
    query (str): The student's query string for which a response is needed.
    patient_name (str): The specific patient that the student needs to diagnose.
    llm (ChatBedrock): The language model instance used to generate the response.
    history_aware_retriever: The history-aware retriever instance that provides relevant context documents for the query.
    table_name (str): The DynamoDB table name used to store and retrieve the chat history.
    session_id (str): The unique identifier for the chat session to manage history.

    Returns:
    dict: A dictionary containing the generated response and the source documents used in the retrieval.
    """
    
    # Evaluate empathy if this is a student response (not initial greeting)
    empathy_evaluation = None
    empathy_feedback = ""
    if query.strip() and "Greet me" not in query:
        patient_context = f"Patient: {patient_name}, Age: {patient_age}, Condition: {patient_prompt}"
        nova_client = {
            "client": boto3.client("bedrock-runtime", region_name="us-east-1"),
            "model_id": "amazon.nova-pro-v1:0"
        }
        empathy_evaluation = evaluate_empathy(query, patient_context, nova_client)
        
        if empathy_evaluation:
            empathy_score = empathy_evaluation.get('empathy_score', 'unknown')
            realism_flag = empathy_evaluation.get('realism_flag', 'unknown')
            feedback = empathy_evaluation.get('feedback', '')
            
            # Use markdown formatting with star ratings and icons
            empathy_feedback = f"**Empathy Coach:**\n\n"
            
            # Add star rating based on empathy score (1-5 scale)
            if empathy_score == 1:
                stars = "⭐ (1/5)"
            elif empathy_score == 2:
                stars = "⭐⭐ (2/5)"
            elif empathy_score == 3:
                stars = "⭐⭐⭐ (3/5)"
            elif empathy_score == 4:
                stars = "⭐⭐⭐⭐ (4/5)"
            elif empathy_score == 5:
                stars = "⭐⭐⭐⭐⭐ (5/5)"
            else:
                stars = "⭐⭐⭐ (3/5)"  # Default fallback
                
            # Add icon for realism
            if realism_flag == "unrealistic":
                realism_icon = ""
            else:
                realism_icon = "✅"
                
            # Display overall score and breakdown
            overall_level = get_empathy_level_name(empathy_score)
            empathy_feedback += f"**Overall Empathy Score:** {overall_level} {stars}\n\n"
            
            # Display individual category scores
            empathy_feedback += f"**Category Breakdown:**\n"
            
            # Perspective-Taking
            pt_score = empathy_evaluation.get('perspective_taking', 3)
            pt_level = get_empathy_level_name(pt_score)
            pt_stars = "⭐" * pt_score + f" ({pt_score}/5)"
            empathy_feedback += f"• Perspective-Taking: {pt_level} {pt_stars}\n"
            
            # Emotional Resonance
            er_score = empathy_evaluation.get('emotional_resonance', 3)
            er_level = get_empathy_level_name(er_score)
            er_stars = "⭐" * er_score + f" ({er_score}/5)"
            empathy_feedback += f"• Emotional Resonance/Compassionate Care: {er_level} {er_stars}\n"
            
            # Acknowledgment
            ack_score = empathy_evaluation.get('acknowledgment', 3)
            ack_level = get_empathy_level_name(ack_score)
            ack_stars = "⭐" * ack_score + f" ({ack_score}/5)"
            empathy_feedback += f"• Acknowledgment of Patient's Experience: {ack_level} {ack_stars}\n"
            
            # Language & Communication
            lang_score = empathy_evaluation.get('language_communication', 3)
            lang_level = get_empathy_level_name(lang_score)
            lang_stars = "⭐" * lang_score + f" ({lang_score}/5)"
            empathy_feedback += f"• Language & Communication: {lang_level} {lang_stars}\n\n"
            
            # Add Cognitive vs Affective Empathy breakdown
            cognitive_score = empathy_evaluation.get('cognitive_empathy', 3)
            affective_score = empathy_evaluation.get('affective_empathy', 3)
            cognitive_level = get_empathy_level_name(cognitive_score)
            affective_level = get_empathy_level_name(affective_score)
            cognitive_stars = "⭐" * cognitive_score + f" ({cognitive_score}/5)"
            affective_stars = "⭐" * affective_score + f" ({affective_score}/5)"
            
            empathy_feedback += f"**Empathy Type Analysis:**\n"
            empathy_feedback += f"• Cognitive Empathy (Understanding): {cognitive_level} {cognitive_stars}\n"
            empathy_feedback += f"• Affective Empathy (Feeling): {affective_level} {affective_stars}\n\n"
            
            empathy_feedback += f"**Realism Assessment:** Your response is {realism_flag} {realism_icon}\n\n"
            
            # Add detailed feedback with reasoning
            if feedback:
                if isinstance(feedback, dict):  # Structured feedback from Nova Pro
                    # Add strengths
                    if 'strengths' in feedback and feedback['strengths']:
                        empathy_feedback += f"**Strengths:**\n"
                        for strength in feedback['strengths']:
                            empathy_feedback += f"• {strength}\n"
                        empathy_feedback += "\n"
                    
                    # Add areas for improvement
                    if 'areas_for_improvement' in feedback and feedback['areas_for_improvement']:
                        empathy_feedback += f"**Areas for improvement:**\n"
                        for area in feedback['areas_for_improvement']:
                            empathy_feedback += f"• {area}\n"
                        empathy_feedback += "\n"
                    
                    # Add why realistic/unrealistic
                    if 'why_realistic' in feedback and feedback['why_realistic']:
                        empathy_feedback += f"**Your response is {realism_flag} because:** {feedback['why_realistic']}\n\n"
                    elif 'why_unrealistic' in feedback and feedback['why_unrealistic']:
                        empathy_feedback += f"**Your response is {realism_flag} because:** {feedback['why_unrealistic']}\n\n"
                    
                    # Add improvement suggestions
                    if 'improvement_suggestions' in feedback and feedback['improvement_suggestions']:
                        empathy_feedback += f"**Improvement suggestions:**\n"
                        for suggestion in feedback['improvement_suggestions']:
                            empathy_feedback += f"• {suggestion}\n"
                        empathy_feedback += "\n"
                    
                    # Add alternative phrasing
                    if 'alternative_phrasing' in feedback and feedback['alternative_phrasing']:
                        empathy_feedback += f"**Try this approach:** *{feedback['alternative_phrasing']}*\n\n"
                        
                elif isinstance(feedback, str) and len(feedback) > 10:  # Simple string feedback
                    empathy_feedback += f"**Feedback:** {feedback}\n"
                else:
                    empathy_feedback += f"**Feedback:** Unable to provide detailed feedback at this time.\n"
            else:
                empathy_feedback += "**Feedback:** System temporarily unavailable.\n"
                
            empathy_feedback += "---\n\n**Patient Response:**\n"
    
    completion_string = """
                Once I, the pharmacy student, have give you a diagnosis, politely leave the conversation and wish me goodbye.
                Regardless if I have given you the proper diagnosis or not for the patient you are pretending to be, stop talking to me.
                """
    if llm_completion:
        completion_string = """
                Continue this process until you determine that me, the pharmacy student, has properly diagnosed the patient you are pretending to be.
                Once the proper diagnosis is provided, include PROPER DIAGNOSIS ACHIEVED in your response and do not continue the conversation.
                """

    # Create a system prompt for the question answering
    system_prompt = (
        f"""
        <|begin_of_text|>
        <|start_header_id|>patient<|end_header_id|>
        You are a patient, I am a pharmacy student. Your name is {patient_name} and you are going to pretend to be a patient talking to me, a pharmacy student.
        You are not the pharmacy student. You are the patient. Look at the document(s) provided to you and act as a patient with those symptoms.
        Please pay close attention to this: {system_prompt} 
        Start the conversion by saying Hello! I'm {patient_name}, I am {patient_age} years old, and then further talk about the symptoms you have. 
        Here are some additional details about your personality, symptoms, or overall condition: {patient_prompt}
        {completion_string}
        Use the following document(s) to provide
        hints as a patient to me, the pharmacy student. Use three sentences maximum when describing your symptoms to provide clues to me, the pharmacy student.
        End each clue with a question that pushes me to the correct diagnosis. I might ask you questions or provide my thoughts as statements.
        Again, YOU ARE SUPPOSED TO ACT AS THE PATIENT. I AM THE PHARMACY STUDENT. 
        <|eot_id|>
        <|start_header_id|>documents<|end_header_id|>
        {{context}}
        <|eot_id|>
        """
    )
    
    qa_prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system_prompt),
            MessagesPlaceholder("chat_history"),
            ("human", "{input}"),
        ]
    )
    question_answer_chain = create_stuff_documents_chain(llm, qa_prompt)
    rag_chain = create_retrieval_chain(history_aware_retriever, question_answer_chain)

    conversational_rag_chain = RunnableWithMessageHistory(
        rag_chain,
        lambda session_id: DynamoDBChatMessageHistory(
            table_name=table_name, 
            session_id=session_id
        ),
        input_messages_key="input",
        history_messages_key="chat_history",
        output_messages_key="answer",
    )
    
    # Generate the response until it's not empty
    response = ""
    while not response:
        response = generate_response(
            conversational_rag_chain,
            query,
            session_id
        )
    
    result = get_llm_output(response, llm_completion, empathy_feedback)
    if empathy_evaluation:
        result["empathy_evaluation"] = empathy_evaluation
    
    return result

def generate_response(conversational_rag_chain: object, query: str, session_id: str) -> str:
    """
    Invokes the RAG chain to generate a response to a given query.

    Args:
    conversational_rag_chain: The Conversational RAG chain object that processes the query and retrieves relevant responses.
    query (str): The input query for which the response is being generated.
    session_id (str): The unique identifier for the current conversation session.

    Returns:
    str: The answer generated by the Conversational RAG chain, based on the input query and session context.
    """
    return conversational_rag_chain.invoke(
        {
            "input": query
        },
        config={
            "configurable": {"session_id": session_id}
        },  # constructs a key "session_id" in `store`.
    )["answer"]

def get_llm_output(response: str, llm_completion: bool, empathy_feedback: str = "") -> dict:
    """
    Processes the response from the LLM to determine if proper diagnosis has been achieved.

    Args:
    response (str): The response generated by the LLM.
    llm_completion (bool): Whether to check for completion.
    empathy_feedback (str, optional): Empathy feedback to prepend to the response.

    Returns:
    dict: A dictionary containing the processed output from the LLM and a boolean 
    flag indicating whether proper diagnosis has been achieved.
    """

    completion_sentence = " Congratulations! You have provided the proper diagnosis for me, the patient I am pretending to be! Please try other mock patients to continue your diagnosis skills! :)"

    if not llm_completion:
        return dict(
            llm_output=empathy_feedback + response,
            llm_verdict=False
        )
    
    elif "PROPER DIAGNOSIS ACHIEVED" not in response:
        return dict(
            llm_output=empathy_feedback + response,
            llm_verdict=False
        )
    
    elif "PROPER DIAGNOSIS ACHIEVED" in response:
        sentences = split_into_sentences(response)
        
        for i in range(len(sentences)):
            
            if "PROPER DIAGNOSIS ACHIEVED" in sentences[i]:
                llm_response=' '.join(sentences[0:i-1])
                
                if sentences[i-1][-1] == '?':
                    return dict(
                        llm_output=empathy_feedback + llm_response,
                        llm_verdict=False
                    )
                else:
                    return dict(
                        llm_output=empathy_feedback + llm_response + completion_sentence,
                        llm_verdict=True
                    )

def split_into_sentences(paragraph: str) -> list[str]:
    """
    Splits a given paragraph into individual sentences using a regular expression to detect sentence boundaries.

    Args:
    paragraph (str): The input text paragraph to be split into sentences.

    Returns:
    list: A list of strings, where each string is a sentence from the input paragraph.

    This function uses a regular expression pattern to identify sentence boundaries, such as periods, question marks, 
    or exclamation marks, and avoids splitting on abbreviations (e.g., "Dr." or "U.S.") by handling edge cases. The 
    resulting list contains sentences extracted from the input paragraph.
    """
    # Regular expression pattern
    sentence_endings = r'(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\?|\!)\s'
    sentences = re.split(sentence_endings, paragraph)
    return sentences

def get_empathy_level_name(score: int) -> str:
    """Convert numeric empathy score to descriptive name."""
    level_names = {
        1: "Novice",
        2: "Advanced Beginner", 
        3: "Competent",
        4: "Proficient",
        5: "Extending"
    }
    return level_names.get(score, "Competent")

def evaluate_empathy(student_response: str, patient_context: str, bedrock_client) -> dict:
    """
    Evaluate empathy score and realism of student response.
    
    Args:
    student_response (str): The student's response to evaluate
    patient_context (str): Context about the patient's condition
    bedrock_client: Bedrock client for Nova Pro
    
    Returns:
    dict: Contains empathy_score, realism_flag, and feedback
    """

    evaluation_prompt = f"""
    You are an expert healthcare communication coach. Evaluate this pharmacy student's response using these 4 empathy criteria:

    Patient Context: {patient_context}
    Student Response: {student_response}

    Evaluate each category on a 1-5 scale:

    **Perspective-Taking:**
    • Extending (5): Exceptional understanding with profound insights into patient's viewpoint
    • Proficient (4): Clearly demonstrates understanding of the patient's point of view with thoughtful, relevant insights
    • Competent (3): Shows awareness of the patient's perspective with minor gaps
    • Advanced Beginner (2): Some attempt to understand the patient's perspective, but limited depth
    • Novice (1): Little or no effort to consider the patient's viewpoint

    **Emotional Resonance / Compassionate Care:**
    • Extending (5): Exceptional warmth, deeply attuned to emotional needs, creates strong therapeutic connection
    • Proficient (4): Expresses genuine concern and sensitivity to the patient's emotional state; response is warm and respectful
    • Competent (3): Expresses concern, though tone or wording may be slightly less empathetic
    • Advanced Beginner (2): Shows some emotional awareness but lacks warmth or appropriateness
    • Novice (1): Response is emotionally flat or dismissive

    **Acknowledgment of Patient's Experience:**
    • Extending (5): Deeply validates and honors patient's experience, demonstrates exceptional understanding
    • Proficient (4): Clearly validates the patient's feelings or experience in a respectful, patient-centered way
    • Competent (3): Attempts to validate the patient's experience with minor omissions
    • Advanced Beginner (2): Somewhat recognizes the patient's experience but lacks clarity or depth
    • Novice (1): Ignores or invalidates the patient's feelings or experience

    **Language & Communication:**
    • Extending (5): Masterful use of therapeutic communication, perfectly tailored language
    • Proficient (4): Uses patient-friendly, non-judgmental, inclusive language throughout
    • Competent (3): Mostly clear and respectful, with minor word choices that could be improved
    • Advanced Beginner (2): Some unclear or technical language; minor judgmental tone
    • Novice (1): Uses overly technical, dismissive, or insensitive language

    **Cognitive vs Affective Empathy Analysis:**
    
    **Cognitive Empathy (Understanding):**
    • Definition: Understanding another person's thoughts and perspective
    • Focus: Explaining medical information in a way the patient understands, perspective-taking
    • Evaluation: How well does the response demonstrate understanding of the patient's viewpoint and concerns?
    
    **Affective Empathy (Feeling):**
    • Definition: Feeling and responding appropriately to another person's emotions
    • Focus: Recognizing patient's emotions and offering appropriate emotional support
    • Evaluation: How well does the response show emotional attunement and provide emotional comfort?

    **Realism Assessment**: realistic or unrealistic
    - Unrealistic: False reassurances, impossible promises, dismissing serious symptoms, medical inaccuracies
    - Realistic: Medically appropriate, honest, evidence-based responses

    Calculate overall empathy score as average of the 4 categories (round to nearest integer).
    Evaluate cognitive and affective empathy separately based on the definitions above.

    Respond in JSON format:
    {{
        "empathy_score": <integer 1-5>,
        "perspective_taking": <integer 1-5>,
        "emotional_resonance": <integer 1-5>,
        "acknowledgment": <integer 1-5>,
        "language_communication": <integer 1-5>,
        "cognitive_empathy": <integer 1-5>,
        "affective_empathy": <integer 1-5>,
        "realism_flag": "realistic|unrealistic",
        "feedback": {{
            "strengths": ["List what the student did well"],
            "areas_for_improvement": ["List specific areas to improve"],
            "why_realistic": "Explain why response is realistic (if realistic)",
            "why_unrealistic": "Explain why response is unrealistic (if unrealistic)",
            "improvement_suggestions": ["List specific suggestions for improvement"],
            "alternative_phrasing": "Provide better phrasing example tailored to this patient scenario"
        }}
    }}
    """

    body = {
        "messages": [{
            "role": "user",
            "content": [{"text": evaluation_prompt}]
        }],
        "inferenceConfig": {
            "temperature": 0.1,
            "maxTokens": 500
        }
    }
    
    try:
        response = bedrock_client["client"].invoke_model(
            modelId=bedrock_client["model_id"],
            contentType="application/json",
            accept="application/json",
            body=json.dumps(body)
        )
        
        result = json.loads(response["body"].read())
        logger.info(f"LLM RESPONSE: {result}")
        response_text = result["output"]["message"]["content"][0]["text"]
        
        # Clean response text and parse JSON
        try:
            evaluation = json.loads(response_text.strip())
            return evaluation
        except json.JSONDecodeError:
            # Fallback if Nova Pro doesn't return valid JSON
            logger.warning(f"Invalid JSON from Nova Pro: {response_text}")
            return {
                "empathy_score": 3,
                "perspective_taking": 3,
                "emotional_resonance": 3,
                "acknowledgment": 3,
                "language_communication": 3,
                "cognitive_empathy": 3,
                "affective_empathy": 3,
                "realism_flag": "realistic",
                "feedback": "System error - unable to parse evaluation. Please try again."
            }
        
    except Exception as e:
        logger.error(f"Error evaluating empathy: {e}")
        return {
            "empathy_score": 3,
            "perspective_taking": 3,
            "emotional_resonance": 3,
            "acknowledgment": 3,
            "language_communication": 3,
            "cognitive_empathy": 3,
            "affective_empathy": 3,
            "realism_flag": "realistic",
            "feedback": "System error - unable to evaluate. Please try again."
        }

def update_session_name(table_name: str, session_id: str, bedrock_llm_id: str) -> str:
    """
    Check if both the LLM and the student have exchanged exactly one message each.
    If so, generate and return a session name using the content of the student's first message
    and the LLM's first response. Otherwise, return None.

    Args:
    session_id (str): The unique ID for the session.
    table_name (str): The DynamoDB table name where the conversation history is stored.

    Returns:
    str: The updated session name if conditions are met, otherwise None.
    """
    
    dynamodb_client = boto3.client("dynamodb")
    
    # Retrieve the conversation history from the DynamoDB table
    try:
        response = dynamodb_client.get_item(
            TableName=table_name,
            Key={
                'SessionId': {
                    'S': session_id
                }
            }
        )
    except Exception as e:
        print(f"Error fetching conversation history from DynamoDB: {e}")
        return None

    history = response.get('Item', {}).get('History', {}).get('L', [])



    human_messages = []
    ai_messages = []
    
    # Find the first human and ai messages in the history
    # Check if length of human messages is 2 since the prompt counts as 1
    # Check if length of AI messages is 2 since after first response by student, another response is generated
    for item in history:
        message_type = item.get('M', {}).get('data', {}).get('M', {}).get('type', {}).get('S')
        
        if message_type == 'human':
            human_messages.append(item)
            if len(human_messages) > 2:
                print("More than one student message found; not the first exchange.")
                return None
        
        elif message_type == 'ai':
            ai_messages.append(item)
            if len(ai_messages) > 2:
                print("More than one AI message found; not the first exchange.")
                return None

    if len(human_messages) != 2 or len(ai_messages) != 2:
        print("Not a complete first exchange between the LLM and student.")
        return None
    
    student_message = human_messages[0].get('M', {}).get('data', {}).get('M', {}).get('content', {}).get('S', "")
    llm_message = ai_messages[0].get('M', {}).get('data', {}).get('M', {}).get('content', {}).get('S', "")
    
    llm = BedrockLLM(
                        model_id = bedrock_llm_id
                    )
    
    system_prompt = """
        You are given the first message from an AI and the first message from a student in a conversation. 
        Based on these two messages, come up with a name that describes the conversation. 
        The name should be less than 30 characters. ONLY OUTPUT THE NAME YOU GENERATED. NO OTHER TEXT.
    """
    
    prompt = f"""
        <|begin_of_text|>
        <|start_header_id|>system<|end_header_id|>
        {system_prompt}
        <|eot_id|>
        <|start_header_id|>AI Message<|end_header_id|>
        {llm_message}
        <|eot_id|>
        <|start_header_id|>Student Message<|end_header_id|>
        {student_message}
        <|eot_id|>
        <|start_header_id|>assistant<|end_header_id|>
    """
    
    session_name = llm.invoke(prompt)
    return session_name