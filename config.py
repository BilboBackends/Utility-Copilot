import queue
import os

result_queue = queue.Queue()
# OpenAI keys
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
OPENAI_ORG_KEY = os.getenv('OPENAI_ORG_KEY')
