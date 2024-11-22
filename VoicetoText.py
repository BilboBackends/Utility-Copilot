import io
from pydub import AudioSegment
import speech_recognition as sr
import openai
import queue
import tempfile
import os
import threading
import torch
import numpy as np
import tempfile
import soundfile as sf
from dotenv import load_dotenv, find_dotenv
import config
import time

load_dotenv(find_dotenv())  # read local .env file
key = openai.api_key = os.getenv("OPENAI_API_KEY")

def start_voice_to_text(result_queue):
    english = False
    verbose = False
    energy = 500
    pause = 0.8
    dynamic_energy = False
    save_file = False

    temp_dir = tempfile.mkdtemp() if save_file else None
    audio_queue = queue.Queue()

    threading.Thread(target=record_audio,
                    args=(audio_queue, energy, pause, dynamic_energy, save_file, temp_dir)).start()
    threading.Thread(target=transcribe_forever,
                    args=(audio_queue, result_queue, english, verbose, save_file)).start()
    while config.voice_recognition_active:
        transcription = result_queue.get()
        result_queue.put(transcription)  # Add the transcription to the result_queue
        print(transcription)
        time.sleep(1)
    while not config.audio_queue.empty():
        try:
            config.audio_queue.get_nowait()
        except queue.Empty:
            continue
def record_audio(audio_queue, energy, pause, dynamic_energy, save_file, temp_dir):
    r = sr.Recognizer()
    r.energy_threshold = energy
    r.pause_threshold = pause
    r.dynamic_energy_threshold = dynamic_energy

    with sr.Microphone(sample_rate=16000) as source:
        print("Say something!")
        i = 0
        while config.voice_recognition_active:
            audio = r.listen(source)
            if save_file:
                data = io.BytesIO(audio.get_wav_data())
                audio_clip = AudioSegment.from_file(data)
                filename = os.path.join(temp_dir, f"temp{i}.wav")
                audio_clip.export(filename, format="wav")
                audio_data = filename
            else:
                torch_audio = torch.from_numpy(np.frombuffer(audio.get_raw_data(), np.int16).flatten().astype(np.float32) / 32768.0)
                audio_data = torch_audio

            audio_queue.put_nowait(audio_data)
            i += 1
            time.sleep(1)

def transcribe_with_openai_api(audio_data, api_key):
    openai.api_key = key

    with tempfile.NamedTemporaryFile(mode="w+b", suffix=".wav", delete=False) as temp_audio_file:
        audio_data_2d = audio_data.unsqueeze(1)
        audio_data_np = audio_data_2d.numpy()
        sf.write(
            temp_audio_file.name,
            audio_data_np,
            samplerate=16000,
            subtype='PCM_16'
        )
        temp_audio_file.seek(0)

        with open(temp_audio_file.name, "rb") as audio_file:
            transcript = openai.Audio.transcribe("whisper-1", audio_file)

        audio_file.close()

    os.remove(temp_audio_file.name)
    return transcript


def transcribe_forever(audio_queue, result_queue, english, verbose, save_file):
    while config.voice_recognition_active:
        audio_data = audio_queue.get()
        api_key = key
        result = transcribe_with_openai_api(audio_data, api_key)

        if not config.voice_recognition_active:  # Added this check
            break

        if not verbose:
            predicted_text = result["text"]
            result_queue.put_nowait(predicted_text)
        else:
            result_queue.put_nowait(result)

        if save_file:
            os.remove(audio_data)
        time.sleep(1)
    while not config.audio_queue.empty():
        try:
            config.audio_queue.get_nowait()
        except queue.Empty:
            continue

