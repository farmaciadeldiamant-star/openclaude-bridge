"""
Talk to openclaude-bridge from the official OpenAI Python SDK.

    pip install openai
    python python_openai.py
"""
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8788/v1",
    api_key="not-needed",  # bridge ignores the key, but SDK requires a non-empty value
)

# non-streaming
resp = client.chat.completions.create(
    model="claude-opus-4-6",
    messages=[{"role": "user", "content": "What is 7 * 8? Reply with just the number."}],
)
print("non-stream:", resp.choices[0].message.content)

# streaming
print("stream:   ", end="", flush=True)
stream = client.chat.completions.create(
    model="claude-opus-4-6",
    messages=[{"role": "user", "content": "Say 'hello world' in three languages, one per line."}],
    stream=True,
)
for chunk in stream:
    delta = chunk.choices[0].delta.content or ""
    print(delta, end="", flush=True)
print()
