# Utility Copilot

An AI assistant that helps utility workers identify equipment, reference documentation, and access technical information in the field.

---

## What It Does

- **Identifies utility equipment from photos** (poles, transformers, switches, etc.)
- **Pulls up relevant sections from technical documentation**
- **Handles voice commands**
- **Provides source-linked responses** with page references

---

## How It Works

Built using:
- **YOLOv7** for object detection
- **LangChain + ChromaDB** for searching documentation
- **OpenAI's Whisper** for voice commands
- **Flask** web interface

---
## Features

### Object Detection
- **Recognizes 11 types of utility equipment**
- Achieves **89% precision** in field testing
- Works with **uploaded photos** or **drag-and-drop functionality**

### Document Search
- **Finds relevant information** from technical documentation
- Includes **page numbers** and **source links**
- Achieves **73% accuracy** on technical queries

### Voice Control
- Enables **hands-free operation**
- Works effectively in **field conditions**
- Provides **real-time transcription**

![image](https://github.com/user-attachments/assets/182fd8fd-671e-4ba2-ac88-9c4f79a703c6)
