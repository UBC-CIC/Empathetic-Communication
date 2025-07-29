import json
from langchain_community.chat_message_histories import DynamoDBChatMessageHistory
from langchain_core.messages import AIMessage, HumanMessage

def format_chat_history(session_id: str, table_name: str = "DynamoDB-Conversation-Table") -> str:
    history = DynamoDBChatMessageHistory(table_name=table_name, session_id=session_id)
    recent_messages = history.messages[-10:]

    lines = []
    for m in recent_messages:
        role = "User" if m.type == "human" else "Assistant"
        content = m.content.strip().replace("\n", " ")
        safe_content = json.dumps(content)[1:-1]  # escape but remove outer quotes
        lines.append(f"{role}: {safe_content}")
    return "\n".join(lines)

def add_message(session_id: str, role: str, content: str, table_name: str = "DynamoDB-Conversation-Table"):
    history = DynamoDBChatMessageHistory(table_name=table_name, session_id=session_id)
    if role == "user":
        history.add_message(HumanMessage(content=content))
    elif role == "ai":
        history.add_message(AIMessage(content=content))
    else:
        raise ValueError(f"Invalid role '{role}'. Must be 'user' or 'ai'.")
