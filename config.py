import queue
import os

voice_recognition_active = False
result_queue = queue.Queue()
audio_queue = queue.Queue()
# OpenAI keys
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
OPENAI_ORG_KEY = os.getenv('OPENAI_ORG_KEY')