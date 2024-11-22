// script.js


let recognitionStarted = false;
let recognitionIntervalId = null;

function appendMessageToChatArea(sender, message) {
    const messageElement = document.createElement('div');
    messageElement.className = sender === 'user' ? 'user-message' : 'chatbot-message';
    
    // Parse and render HTML content safely
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = message;
    
    // Convert links to actual clickable elements
    const links = tempDiv.getElementsByTagName('a');
    Array.from(links).forEach(link => {
        // Create a styled button for each link
        const button = document.createElement('button');
        button.className = 'doc-link';
        button.innerHTML = '📄 View Page ' + link.href.split('page=')[1].split('"')[0];
        button.onclick = (e) => {
            e.preventDefault();
            window.open(link.href, '_blank', 'width=900,height=800');
        };
        link.parentNode.replaceChild(button, link);
    });
    
    messageElement.innerHTML = tempDiv.innerHTML;

    // Add speaker icon if it's a chatbot message
    if (sender === 'chatbot') {
        const speakerIcon = document.createElement('img');
        speakerIcon.src = '/static/chat_images/speaker_icon.png';
        speakerIcon.className = 'speaker-icon';
        speakerIcon.addEventListener('click', () => {
            // Remove HTML tags for text-to-speech
            const plainText = message.replace(/<[^>]*>/g, '');
            playTextToSpeech(plainText);
        });
        messageElement.appendChild(speakerIcon);
    }

    chatArea.appendChild(messageElement);
    chatArea.scrollTop = chatArea.scrollHeight;
}

function playTextToSpeech(text) {
    if (!text) return;

    const requestOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text }),
    };

    fetch("/text_to_speech", requestOptions)
        .then((response) => {
            if (!response.ok) {
                throw new Error("Network response was not ok");
            }
            return response.blob();
        })
        .then((blob) => {
            const audioURL = URL.createObjectURL(blob);
            const audio = new Audio(audioURL);
            audio.play();
        })
        .catch((error) => {
            console.error("Error in playTextToSpeech:", error);
        });
}




async function startVoiceRecognition() {
    const userInput = document.getElementById('user-input');
    if (!recognitionStarted) {
        recognitionStarted = true;

        // Start voice recognition
        await fetch('/start_voice_recognition', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        // Poll the server for transcriptions
        recognitionIntervalId = setInterval(async () => {
            const response = await fetch('/get_transcription', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (response.ok) {
                const data = await response.json();
                if (data.transcription) {
                    // Update the input field with the transcribed text
                    userInput.value = data.transcription;
                }
            } else {
                console.error(`Error: HTTP status ${response.status}`);
            }
        }, 1000);  // Poll every 1000 milliseconds (1 second)
    } else {
        recognitionStarted = false;

        // Stop voice recognition
        clearInterval(recognitionIntervalId);

        // Stop the voice recognition on the server side
        await fetch('/stop_voice_recognition', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
}

function applyTheme(theme) {
    const currentTheme = theme === 'dark' ? darkBlueTheme : originalTheme;

    document.body.style.backgroundColor = currentTheme.body;
    document.querySelector('.chat-container').style.backgroundColor = currentTheme.chatContainer;
    document.querySelector('.chat-area').style.backgroundColor = currentTheme.chatArea;
    document.querySelector('.input-area').style.backgroundColor = currentTheme.inputArea;
    document.getElementById('user-input').style.backgroundColor = currentTheme.userInput;
    document.getElementById('user-input').style.color = currentTheme.inputColor;
    document.getElementById('send-button').style.backgroundColor = currentTheme.sendButton;
    document.querySelector('.drop-zone').style.backgroundColor = currentTheme.dropZone;

    let userMessages = document.querySelectorAll('.user-message');
    userMessages.forEach(msg => msg.style.backgroundColor = currentTheme.userMessage);

    let chatbotMessages = document.querySelectorAll('.chatbot-message');
    chatbotMessages.forEach(msg => {
        msg.style.backgroundColor = currentTheme.chatbotMessage;
        msg.style.color = currentTheme.chatbotTextColor;
    });

    document.getElementById('toggle-theme').innerText = theme === 'dark' ? 'Light Theme' : 'Dark Theme';

    isDarkBlue = theme === 'dark';
}


document.addEventListener('DOMContentLoaded', async () => {
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const chatArea = document.querySelector('.chat-area');
    const spinner = document.querySelector('.loading-spinner');
    const dropZone = document.getElementById('drop-zone');
    const imageFile = document.getElementById('image-file');

    const response = await fetch('/static/config.json');
    const config = await response.json();
    const initialTheme = config.initial_theme;

    applyTheme(initialTheme);
    
    async function detectObjectsInImage(imageData) {
        try {
            const response = await fetch('/detect', {
                method: 'POST',
                body: imageData,
            });

            if (response.ok) {
                const data = await response.json();
                return data;
            } else {
                throw new Error(`HTTP error ${response.status}`);
            }
        } catch (error) {
            console.error('Error during object detection:', error);
            return { status: 'error', message: 'Object detection failed.' };
        }
    }

    async function handleFileUpload(file) {
        console.log('File uploaded:', file);
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64String = reader.result.replace(/data:image\/\w+;base64,/, ""); // Remove MIME type from base64 string
            showSpinner();
            console.log('base64String:', base64String);
            
            // Add a user message indicating the image has been uploaded
            appendMessageToChatArea('user', 'Image uploaded');
            
            const chatbotResponse = await sendMessageToChatbot("I have uploaded an image.", base64String);
            hideSpinner();
            if (chatbotResponse) {
                appendMessageToChatArea('chatbot', chatbotResponse);
            } else {
                // TODO: Handle chatbot response errors or provide a default response
            }
        };
        reader.readAsDataURL(file);
    }

    async function handleUserMessage() {
        // Get the user's message from the input element
        const userMessage = document.getElementById("user-input").value;
    
        // Send the message to the chatbot and get the response
        const chatbotResponse = await sendMessageToChatbot(userMessage);
    
        // Display the chatbot's response in the user interface
        displayMessage(chatbotResponse, "chatbot");
    }

    let chatHistory = [];

    async function sendMessageToChatbot(message, base64String = "") {
        try {
            console.log(message)
            // Fetch the content from the config.json file
            const responseConfig = await fetch('/static/config.json');
            const config = await responseConfig.json();
            const systemMessage = config.system_message;
    
            // Add the new user message to the chat history
            chatHistory.push({ role: 'user', content: message });
    
            const requestBody = JSON.stringify({
                messages: [
                    { role: 'system', content: systemMessage },
                    ...chatHistory
                ],
                image: base64String,
                temperature: 1
            });
    
            //console.log("Request payload:", requestBody);
    
            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: requestBody
            });
    
            if (response.ok) {
                const data = await response.json();
                
                if (data.image_filename) {
                    displayImage(data.image_filename);
                }
                
                chatHistory.push({ role: 'assistant', content: data.response });
                return data.response;
            } else {
                throw new Error(`HTTP error ${response.status}`);
            }
        } catch (error) {
            console.error('Error communicating with the chatbot:', error);
            return "I'm sorry, I'm unable to respond at the moment. Please try again later.";
        }
    }
    
    function displayImage(imageFilename) {
        const chatArea = document.querySelector(".chat-area");
    
        const imageUrl = imageFilename;
    
        const img = document.createElement("img");
        img.src = imageUrl;
        img.alt = "Uploaded image";
        img.className = "uploaded-image";
        img.id = "chat-image"; // Add an ID to the image element
        img.addEventListener('click', () => {
            const popup = window.open(imageUrl, 'imagePopup', 'width=800,height=600');
            popup.focus();
        });
    
        const imageContainer = document.createElement("div");
        imageContainer.className = "assistant-message";
        imageContainer.appendChild(img);
    
        chatArea.appendChild(imageContainer);
    }


    dropZone.addEventListener('click', () => {
        imageFile.click();
    });

    dropZone.addEventListener('dragover', (event) => {
        event.preventDefault();
        dropZone.classList.add('dragging');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragging');
    });

    dropZone.addEventListener('drop', (event) => {
        event.preventDefault();
        dropZone.classList.remove('dragging');
        if (event.dataTransfer.files.length) {
            handleFileUpload(event.dataTransfer.files[0]);
        }
    });

    imageFile.addEventListener('change', () => {
        if (imageFile.files.length) {
            handleFileUpload(imageFile.files[0]);
        }
    });
    
    function appendMessageToChatArea(sender, message) {
        const messageElement = document.createElement('div');
        messageElement.className = sender === 'user' ? 'user-message' : 'chatbot-message';
    
        // Apply theme styles
        const currentTheme = isDarkBlue ? darkBlueTheme : originalTheme;
        messageElement.style.backgroundColor = sender === 'user' ? currentTheme.userMessage : currentTheme.chatbotMessage;
        messageElement.style.color = sender === 'user' ? '#FFFFFF' : currentTheme.chatbotTextColor;
    
        // Check if message contains HTML links
        if (message.includes('<a href=') && sender === 'chatbot') {
            // Split the message into text and source sections
            const [mainText, ...sourceParts] = message.split('📚 Sources:');
            
            // Add the main text
            const textDiv = document.createElement('div');
            textDiv.textContent = mainText;
            messageElement.appendChild(textDiv);
            
            if (sourceParts.length > 0) {
                // Create sources section
                const sourcesDiv = document.createElement('div');
                sourcesDiv.style.marginTop = '10px';
                sourcesDiv.style.paddingTop = '10px';
                sourcesDiv.style.borderTop = '1px solid ' + (isDarkBlue ? '#444' : '#ddd');
                
                // Add the sources heading
                const sourcesHeading = document.createElement('div');
                sourcesHeading.textContent = '📚 Sources:';
                sourcesHeading.style.marginBottom = '5px';
                sourcesDiv.appendChild(sourcesHeading);
    
                // Parse and create buttons for links
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = sourceParts.join('');
                
                const links = tempDiv.getElementsByTagName('a');
                Array.from(links).forEach(link => {
                    const pageNum = link.href.split('page=')[1].split('"')[0];
                    const button = document.createElement('button');
                    button.className = 'doc-link';
                    button.innerHTML = `📄 View Page ${pageNum}`;
                    button.style.backgroundColor = currentTheme.userMessage;
                    button.style.color = '#FFFFFF';
                    button.style.margin = '5px 0';
                    button.style.border = 'none';
                    button.style.padding = '6px 12px';
                    button.style.borderRadius = '4px';
                    button.style.cursor = 'pointer';
                    
                    button.addEventListener('mouseover', () => {
                        button.style.backgroundColor = isDarkBlue ? '#005793' : '#3a7172';
                    });
                    
                    button.addEventListener('mouseout', () => {
                        button.style.backgroundColor = currentTheme.userMessage;
                    });
                    
                    button.onclick = (e) => {
                        e.preventDefault();
                        const url = link.href.replace(/"/g, '');
                        window.open(url, '_blank', 'width=900,height=800');
                    };
                    
                    sourcesDiv.appendChild(button);
                });
    
                // Add note about clicking links
                const noteDiv = document.createElement('div');
                noteDiv.style.fontSize = '0.9em';
                noteDiv.style.marginTop = '5px';
                noteDiv.style.color = isDarkBlue ? '#aaa' : '#666';
                noteDiv.textContent = '💡 Click on the page numbers above to view the relevant sections in the documentation.';
                sourcesDiv.appendChild(noteDiv);
    
                messageElement.appendChild(sourcesDiv);
            }
        } else {
            // Regular message without links
            messageElement.textContent = message;
        }
    
        // Add speaker icon for chatbot messages
        if (sender === 'chatbot') {
            const speakerIcon = document.createElement('img');
            speakerIcon.src = '/static/chat_images/speaker_icon.png';
            speakerIcon.className = 'speaker-icon';
            speakerIcon.addEventListener('click', () => {
                // Remove HTML tags for text-to-speech
                const plainText = message.replace(/<[^>]*>/g, '');
                playTextToSpeech(plainText);
            });
            messageElement.appendChild(speakerIcon);
        }
    
        chatArea.appendChild(messageElement);
        chatArea.scrollTop = chatArea.scrollHeight;
    }
    
    // Make sure these event listeners are properly set up
    document.addEventListener('DOMContentLoaded', () => {
        const userInput = document.getElementById('user-input');
        const sendButton = document.getElementById('send-button');
        const chatArea = document.querySelector('.chat-area');
        const spinner = document.querySelector('.loading-spinner');
    
        sendButton.addEventListener('click', async () => {
            const message = userInput.value.trim();
            if (message) {
                userInput.value = '';
                appendMessageToChatArea('user', message);
                showSpinner();
                const chatbotResponse = await sendMessageToChatbot(message);
                hideSpinner();
                if (chatbotResponse) {
                    appendMessageToChatArea('chatbot', chatbotResponse);
                }
            }
        });
    
        userInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                sendButton.click();
            }
        });
    });
    
    function showSpinner() {
        const spinner = document.querySelector('.loading-spinner');
        const sendButton = document.getElementById('send-button');
        if (spinner && sendButton) {
            spinner.style.display = 'flex';
            sendButton.classList.add('spinner-active');
        }
    }
    
    function hideSpinner() {
        const spinner = document.querySelector('.loading-spinner');
        const sendButton = document.getElementById('send-button');
        if (spinner && sendButton) {
            spinner.style.display = 'none';
            sendButton.classList.remove('spinner-active');
        }
    }
    sendButton.addEventListener('click', async () => {
        const message = userInput.value.trim();
        if (message) {
            userInput.value = '';
            appendMessageToChatArea('user', message, chatArea);
            showSpinner();
            const chatbotResponse = await sendMessageToChatbot(message);
            hideSpinner();
            if (chatbotResponse) {
                appendMessageToChatArea('chatbot', chatbotResponse, chatArea);
            } else {
                // TODO: Handle chatbot response errors or provide a default response
            }
        }
    });

    userInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            sendButton.click();
        }
    });
});

//Changing styles of chat area
const originalTheme = {
    body: 'rgba(240, 242, 245, 1)',
    chatContainer: 'rgba(255, 255, 255, 1)',
    chatHeader: 'rgba(75, 142, 143, 1)',
    userMessage: 'rgba(75, 142, 143, 1)',
    chatbotMessage: 'rgba(224, 224, 224, 1)',
    inputArea: 'rgba(75, 142, 143, 1)',
    userInput: 'rgba(255, 255, 255, 1)',
    sendButton: 'rgba(58, 58, 60, 1)',
    sendButtonHover: 'rgba(94, 94, 96, 1)',
    dropZone: 'rgba(255, 255, 255, 1)',
    textColor: '#000000',
    inputColor: '#000000',
    chatbotTextColor: '#000000'
  };
  
  const darkBlueTheme = {
    body: 'rgba(10, 17, 40, 1)',
    chatContainer: 'rgba(0, 29, 61, 1)',
    chatHeader: 'rgba(0, 87, 146, 1)',
    userMessage: 'rgba(0, 122, 204, 1)',
    chatbotMessage: 'rgba(117, 117, 117, 1)',
    inputArea: 'rgba(0, 87, 146, 1)',
    userInput: 'rgba(31, 64, 104, 1)',
    sendButton: 'rgba(0, 122, 204, 1)',
    sendButtonHover: 'rgba(0, 87, 146, 1)',
    dropZone: 'rgba(0, 29, 61, 1)',
    textColor: '#ffffff',
    inputColor: '#ffffff',
    chatbotTextColor: '#ffffff'
  };
  
  let isDarkBlue = false;

  document.getElementById('toggle-theme').addEventListener('click', () => {
    const theme = isDarkBlue ? originalTheme : darkBlueTheme;
  
    document.body.style.backgroundColor = theme.body;
    document.querySelector('.chat-container').style.backgroundColor = theme.chatContainer;
    document.querySelector('.chat-header').style.backgroundColor = theme.chatHeader;
  
    let userMessages = document.querySelectorAll('.user-message');
    userMessages.forEach(msg => msg.style.backgroundColor = theme.userMessage);
  
    let chatbotMessages = document.querySelectorAll('.chatbot-message');
    chatbotMessages.forEach(msg => {
        msg.style.backgroundColor = theme.chatbotMessage;
        msg.style.color = theme.chatbotTextColor;  // set the text color
    });
  
    document.querySelector('.input-area').style.backgroundColor = theme.inputArea;
  
    let userInputs = document.querySelectorAll('#user-input');
    userInputs.forEach(input => {
      input.style.backgroundColor = theme.userInput;
      input.style.color = theme.inputColor; // change input text color
    });
  
    let sendButtons = document.querySelectorAll('#send-button');
    sendButtons.forEach(button => {
      button.style.backgroundColor = theme.sendButton;
      button.addEventListener('mouseover', () => button.style.backgroundColor = theme.sendButtonHover);
      button.addEventListener('mouseout', () => button.style.backgroundColor = theme.sendButton);
    });

  
    document.querySelector('.drop-zone').style.backgroundColor = theme.dropZone;
    document.querySelector('.drop-zone span').style.color = theme.textColor; // change drop-zone text color
  
    document.getElementById('toggle-theme').innerText = isDarkBlue ? 'Dark Theme' : 'Light Theme';
  
    isDarkBlue = !isDarkBlue;
  });
