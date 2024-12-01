from io import BytesIO
import json
import os
import subprocess
import threading
import uuid
from queue import Queue
import config
import base64
import glob
import shutil
import io

from dotenv import load_dotenv, find_dotenv
from flask import Flask, request, jsonify, send_from_directory, render_template, send_file
from flask_socketio import SocketIO, emit
from werkzeug.datastructures import FileStorage
from PIL import Image, UnidentifiedImageError
import openai
import voice
from VoicetoText import start_voice_to_text

from langchain.llms import OpenAI
from langchain.embeddings.openai import OpenAIEmbeddings
from langchain.vectorstores import Chroma
from langchain.chains import RetrievalQA

# Initialize Flask and SocketIO
app = Flask(__name__)
socketio = SocketIO(app)

# Initialize global variables
result_queue = Queue()
voice_recognition_active = False
detected_objects_context = None

# Load environment variables
load_dotenv(find_dotenv())
openai.organization = config.OPENAI_ORG_KEY
openai.api_key = config.OPENAI_API_KEY

# Initialize Langchain components
persist_directory = "./chroma_db"
embeddings = OpenAIEmbeddings()
vectordb = Chroma(persist_directory=persist_directory, embedding_function=embeddings)
retriever = vectordb.as_retriever(search_kwargs={"k": 3})
llm = OpenAI(temperature=0)
qa_chain = RetrievalQA.from_chain_type(llm=llm, chain_type="stuff", retriever=retriever, return_source_documents=True)

# Utility Functions
def format_chat_messages(messages):
    return "\n".join([f"{message['role']}: {message['content']}" for message in messages])

def get_completion_from_messages(messages, model="gpt-3.5-turbo", temperature=0):
    try:
        response = openai.ChatCompletion.create(
            model=model,
            messages=messages,
            temperature=temperature,
        )
        return response['choices'][0]['message']['content']
    except openai.error.OpenAIError as e:
        print(f"OpenAI API Error: {e}")
        return "An error occurred while processing your request."

def is_documentation_query(query):
    documentation_keywords = [
        "manual", "documentation", "guide", "instruction", "procedure",
        "how to", "steps", "process", "protocol", "reference",
        "what is", "explain", "describe", "definition", "tell me about",
        "specifications", "specs", "requirements", "guidelines", "standard", "get"
    ]
    return any(keyword in query.lower() for keyword in documentation_keywords)

def extract_section_title(page_content, max_length=50):
    """Extract a meaningful section title from the page content"""
    # Split content into lines and get the first non-empty line
    lines = [line.strip() for line in page_content.split('\n') if line.strip()]
    if lines:
        # Get the first line and limit its length
        title = lines[0][:max_length]
        return title if len(title) == len(lines[0]) else f"{title}..."
    return "Untitled Section"

def format_source_metadata(source_docs):
    """Format source documents into a structured summary"""
    sections = []
    seen_content = set()
    
    for doc in source_docs:
        content_hash = hash(doc.page_content)
        if content_hash not in seen_content:
            seen_content.add(content_hash)
            
            # Extract page number and section title
            page_num = doc.metadata.get('page', 'Unknown Page')
            section_title = extract_section_title(doc.page_content)
            
            # Add formatted section info
            sections.append({
                'page': page_num,
                'title': section_title,
                'confidence': doc.metadata.get('score', None)
            })
    
    return sections

def get_documentation_response(query):
    try:
        response = qa_chain({"query": query})
        answer = response['result']
        
        if response.get("source_documents"):

            pdf_filename = os.path.basename(response["source_documents"][0].metadata.get('source', ''))
            

            source_summary = "\n\n📚 Sources:"
            seen_pages = set()
            
            for doc in response["source_documents"]:
                page_num = doc.metadata.get('page', None)
                if page_num and page_num not in seen_pages:
                    seen_pages.add(page_num)

                    link = f'<a href="/documentation/{pdf_filename}?page={page_num}" target="_blank">Page {page_num}</a>'
                    source_summary += f"\n• {link}"
            
            source_summary += "\n\n💡 Click on the page numbers above to view the relevant sections in the documentation."
            
            full_response = f"{answer}{source_summary}"
        else:
            full_response = answer

        return full_response
    except Exception as e:
        print(f"Error in documentation retrieval: {e}")
        return None

# Add a new route to serve the PDF documentation
@app.route('/documentation/<path:filename>')
def serve_documentation(filename):
    """Serve documentation files with page number support"""
    documentation_path = os.path.join('documentation', filename)
    if os.path.exists(documentation_path):
        return send_file(
            documentation_path,
            mimetype='application/pdf'
        )
    return "Documentation not found", 404

def move_image_to_static(src_path, dest_folder='static/images'):
    if not os.path.exists(dest_folder):
        os.makedirs(dest_folder)
    filename = os.path.basename(src_path)
    dest_path = os.path.join(dest_folder, filename)
    shutil.move(src_path, dest_path)
    return dest_path

@app.route('/')
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route('/get_transcription', methods=['GET'])
def get_transcription():
    if not config.result_queue.empty():
        transcription = config.result_queue.get()
        return jsonify({"status": "success", "transcription": transcription})
    else:
        return jsonify({"status": "success", "transcription": None})

@app.route('/start_voice_recognition', methods=['POST'])
def start_voice_recognition():
    config.voice_recognition_active = True
    threading.Thread(target=start_voice_to_text, args=(config.result_queue,)).start()
    return jsonify(success=True)

@app.route('/stop_voice_recognition', methods=['POST'])
def stop_voice_recognition():
    config.voice_recognition_active = False
    while not config.result_queue.empty():
        try:
            config.result_queue.get_nowait()
        except Queue.Empty:
            continue
    return jsonify(success=True)

@app.route('/text_to_speech', methods=['POST'])
def text_to_speech():
    text = request.json.get('text')
    if text:
        audio_file = voice.text_to_speech(text)
        return send_file(io.BytesIO(audio_file), mimetype='audio/mpeg')
    else:
        return 'Invalid request', 400

@app.route('/get_image/<filename>')
def get_image(filename):
    image_folder = os.path.join("runs", "detect", "from_uploaded")
    return send_from_directory(image_folder, filename)

@app.route('/chat', methods=['POST'])
def chat():
    global detected_objects_context
    messages = request.get_json().get('messages', [])
    temperature = request.get_json().get('temperature', 1)
    base64_image = request.get_json().get('image')

    # Get the latest user message
    user_message = next((msg['content'] for msg in reversed(messages) 
                        if msg['role'] == 'user'), None)

    # Initialize variables for image processing
    processed_image_url_in_static = ""
    image_filename = None
    text_filename = None
    label = None

    # Converting image
    if base64_image and not detected_objects_context:
        image_data = base64.b64decode(base64_image)
        image = FileStorage(stream=BytesIO(image_data), content_type='image/jpeg')
        
        image_id = uuid.uuid4()
        image_filename = f"IMG_{image_id}.jpeg"
        text_filename = f"IMG_{image_id}.txt"
        image_path = os.path.join("inference", "images", "uploaded", image_filename)
        os.makedirs("inference/images/uploaded", exist_ok=True)
        image.save(image_path)
        
        detect(image_path)
        processed_image_path = os.path.join("runs", "detect", "from_uploaded", image_filename)
        processed_image_path_in_static = move_image_to_static(processed_image_path)
        processed_image_url_in_static = request.url_root + processed_image_path_in_static

    # Define class names for object detection
    # class_names = [
    #     'INSL-POST-15KV-PORC-TT-F', 'INSL-POST-15KV-PORC-HC-F', 'INSL-POST-25KV-PORC-TT-F',
    #     'INSL-POST-25KV-PORC-HC-F', 'INSL-POST-35KV-PORC-TT-F', 'INSL-POST-35KV-PORC-HC-F',
    #     'INSL-POST-35KV-PORC-VC-F', 'INSL-POST-45KV-PORC-TT-F', 'INSL-POST-45KV-POLY-TT-F',
    #     'INSL-POST-45KV-POLY-HC-F', 'INSL-POST-45KV-POLY-VC-F', 'INSL-POST-45KV-POLY-HC-GB-F',
    #     'INSL-PIN-15KV-POLY-F', 'INSL-PIN-23KV-PORC-F', 'INSL-PIN-25KV-POLY-F', 'INSL-DE/S-PORC-F',
    #     'INSL-DE/S-7KV-PORC-F', 'INSL-DE/S-25KV-POLY-F', 'INSL-DE/S-35KV-POLY-F', 'INSL-DE/S-45KV-POLY-F',
    #     'INSL-SP-SEC-PORC-F', 'INSL-1RACK-SEC-PORC-F', 'CLAMP-AER-CABLE-MD-F',
    # ]

    #class_names = ['Viper-Recloser']

    class_names = ['Pole', 'Tag', 'Transformer', 'Light', 'Fuse', 'Down Guy', 'Viper Recloser', 
               'Riser', 'Arrester', 'Weatherhead', 'Capacitor', 'Trip Saver', 'Switch']


    # Process detected objects if available
    if text_filename:
        label = os.path.join("runs", "detect", "from_uploaded", "labels", text_filename)
    
    from collections import Counter
    detected_objects = []
    object_counts = Counter()

    if label and os.path.exists(label):
        with open(label, "r") as f:
            label_data = f.readlines()
            for line in label_data:
                class_id = int(line.strip().split()[0])
                class_name = class_names[class_id]
                object_counts[class_name] += 1

            for object_name, count in object_counts.items():
                detected_objects.append(f"\n\n{object_name}: {count}")

            detected_objects_context = f"\nObjects detected: ```{', '.join(detected_objects)}```"
            messages.append({"role": "assistant", "content": detected_objects_context})

    # Check if this is a documentation query
    if user_message and is_documentation_query(user_message):
        doc_response = get_documentation_response(user_message)
        if doc_response:
            return jsonify({
                "response": doc_response,
                "image_filename": processed_image_url_in_static
            })

    # If not a documentation query or if documentation query failed,
    # proceed with regular chatbot processing
    system_prompt = "You are an assistant that helps analyze images for electric utility workers and retrieve company documentation. You provide concise and clear information about objects detected in images or abour company documentation."
    messages.insert(0, {"role": "system", "content": system_prompt})

    if detected_objects_context:
        messages.append({"role": "user", "content": "What did you find in the image?"})
        detected_objects_context = None

    response = get_completion_from_messages(messages, temperature=temperature)
    return jsonify({
        "response": response,
        "image_filename": processed_image_url_in_static
    })

@app.route('/detect', methods=['POST'])
def detect(image_path):
    detect_command = [
        "python",
        "detect.py",
        "--weights",
        "yolov7_custom60_best.pt",
        #"yolov7_custom85_insulators_best.pt",
        #"yolov7_custom94_viper_recloser.pt",
        #"yolov7_custom94_viper_best_240.pt",
        #"yolov7_custom100_viper_recloser_best.pt",
        #"yolov7_custom85_insulators_best.pt",
        "--conf",
        "0.5",
        "--img-size",
        "640",
        "--source",
        image_path,
        "--project",
        "runs/detect",
        "--name",
        "from_uploaded",
        "--exist-ok",
        "--no-trace",
        "--save-conf",
        "--save-txt",
    ]

    try:
        result = subprocess.run(detect_command, check=True, text=True, capture_output=True)
        print("YOLO detection output:", result.stdout)
        return jsonify({"status": "success", "output": result.stdout})
    except subprocess.CalledProcessError as error:
        print("YOLO detection error:", error.stderr)
        return jsonify({"status": "error", "message": error.stderr})

if __name__ == '__main__':
    socketio.run(app, debug=True)
