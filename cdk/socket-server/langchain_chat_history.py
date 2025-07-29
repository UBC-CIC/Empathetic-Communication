import json
from langchain_community.chat_message_histories import DynamoDBChatMessageHistory

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
