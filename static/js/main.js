// Utility Functions
class SignSpeakUtils {
    static generateRoomId() {
        return Math.random().toString(36).substring(2, 10).toUpperCase();
    }

    static formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    static getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }
}

const AGORA_APP_ID = 'c839fa758d194ec7b2b5084c2732b272'

// Agora-based Manager (Replaces WebRTCManager)
class AgoraRTCManager {
    constructor(roomId, localVideoElement, onRemoteStream, onRemoteLeave) {
        this.roomId = roomId;
        this.localVideoElement = localVideoElement;
        this.onRemoteStream = onRemoteStream;
        this.onRemoteLeave = onRemoteLeave;

        this.client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        this.localTracks = [];
        this.remoteUsers = {};
        this.UID = sessionStorage.getItem('UID');
        this.TOKEN = null;
    }

    async initialize() {
        try {
            // Fetch token
            const response = await fetch(`/video/get_token/?channel=${this.roomId}&uid=${this.UID}`);
            const data = await response.json();
            this.TOKEN = data.token;

            // Join channel
            this.UID = await this.client.join(AGORA_APP_ID, this.roomId, this.TOKEN, this.UID);

            // Set up event listeners
            this.client.on('user-published', (user, mediaType) => this.handleUserPublished(user, mediaType));
            this.client.on('user-left', (user) => this.handleUserLeft(user));

            // Create local tracks
            this.localTracks = await AgoraRTC.createMicrophoneAndCameraTracks();

            // Play local video in the provided element's parent (since Agora creates its own video tag)
            this.localTracks[1].play(this.localVideoElement.id);

            // Publish tracks
            await this.client.publish([this.localTracks[0], this.localTracks[1]]);

            return true;
        } catch (error) {
            console.error('Error initializing Agora:', error);
            return false;
        }
    }

    async handleUserPublished(user, mediaType) {
        await this.client.subscribe(user, mediaType);
        this.remoteUsers[user.uid] = user;

        if (mediaType === 'video' || mediaType === 'audio') {
            this.onRemoteStream(user.uid, user);
        }
    }

    handleUserLeft(user) {
        delete this.remoteUsers[user.uid];
        this.onRemoteLeave(user.uid);
    }

    toggleVideo() {
        if (this.localTracks[1]) {
            const muted = this.localTracks[1].muted;
            this.localTracks[1].setMuted(!muted);
            return !this.localTracks[1].muted; // Returns true if now functioning (not muted)
        }
        return false;
    }

    toggleAudio() {
        if (this.localTracks[0]) {
            const muted = this.localTracks[0].muted;
            this.localTracks[0].setMuted(!muted);
            return !this.localTracks[0].muted; // Returns true if now functioning (not muted)
        }
        return false;
    }

    async stop() {
        if (this.localTracks) {
            this.localTracks.forEach(track => {
                track.stop();
                track.close();
            });
        }
        await this.client.leave();
    }
}

// Chat Manager
class ChatManager {
    constructor(roomId, chatContainer, userEmail) {
        this.roomId = roomId;
        this.chatContainer = chatContainer;
        this.userEmail = userEmail;
        this.socket = null;
    }

    initialize() {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        this.socket = new WebSocket(`${protocol}://${window.location.host}/ws/chat/${this.roomId}/`);

        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.displayMessage(data);
        };
    }

    sendMessage(message) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN && message.trim()) {
            this.socket.send(JSON.stringify({
                message: message,
                message_type: 'text',
                uid: sessionStorage.getItem('UID')
            }));
        }
    }

    displayMessage(data) {
        if (data.message_type === 'sign_language') {
            this.handleSignLanguageMessage(data);
            return;
        }
        const isOwn = data.username === this.userEmail;
        const messageElement = document.createElement('div');
        messageElement.className = `chat-message ${isOwn ? 'own' : 'other'} fade-in`;

        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (data.message_type === 'system') {
            messageElement.className = 'chat-message system text-center w-100 my-2';
            messageElement.innerHTML = `<small class="text-muted italic">${data.message}</small>`;
        } else {
            messageElement.innerHTML = `
                <div class="fw-bold small" style="opacity: 0.8; margin-bottom: 4px;">${isOwn ? 'You' : 'Participant'}</div>
                <div>${data.message}</div>
                <small class="opacity-50 d-block text-end" style="font-size: 0.7rem; margin-top: 4px;">${timestamp}</small>
            `;
        }

        this.chatContainer.appendChild(messageElement);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    handleSignLanguageMessage(data) {
        // Display sign language text on the corresponding video overlay
        const isOwn = data.username === this.userEmail;
        const uid = data.uid;

        let videoOverlay = null;
        if (isOwn) {
            videoOverlay = document.getElementById('signOverlay');
        } else if (uid) {
            const remoteItem = document.getElementById(`video-${uid}`);
            if (remoteItem) {
                videoOverlay = remoteItem.querySelector('.sign-overlay');
            }
        }

        if (videoOverlay) {
            videoOverlay.textContent = data.message;
            videoOverlay.style.display = 'block';

            // Clear previous timeout if any
            if (videoOverlay.displayTimeout) clearTimeout(videoOverlay.displayTimeout);

            videoOverlay.displayTimeout = setTimeout(() => {
                if (videoOverlay.textContent === data.message) {
                    videoOverlay.style.display = 'none';
                }
            }, 10000); // 10 seconds duration
        }

        // Also add to chat as a small note
        const signNote = document.createElement('div');
        signNote.className = 'chat-message system text-center w-100 my-1';
        signNote.innerHTML = `<small class="text-info italic">Hand Sign: <b>${data.message}</b></small>`;
        this.chatContainer.appendChild(signNote);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    sendSign(text) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                message: text,
                message_type: 'sign_language',
                uid: sessionStorage.getItem('UID')
            }));
        }
    }
}


// Sign Language Manager using MediaPipe
class SignLanguageManager {
    constructor(videoElement, onSignDetected) {
        this.videoElement = videoElement;
        this.onSignDetected = onSignDetected;
        this.hands = null;
        this.camera = null;
        this.isActive = false;
        this.lastGesture = '';
        this.lastDetectionTime = 0;
        this.buffer = "";
    }

    async initialize() {
        this.hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
            }
        });

        this.hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.5
        });

        this.hands.onResults((results) => this.processResults(results));
    }

    async start() {
        if (!this.hands) await this.initialize();
        this.isActive = true;
        this.runDetection();
    }

    stop() {
        this.isActive = false;
        document.getElementById('signOverlay').style.display = 'none';
    }

    async runDetection() {
        if (!this.isActive) return;

        if (this.videoElement.readyState >= 2) {
            await this.hands.send({ image: this.videoElement });
        }

        requestAnimationFrame(() => this.runDetection());
    }

    processResults(results) {
        if (!this.isActive || !results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
            return;
        }

        const gesture = this.classifySign(results.multiHandLandmarks[0]);
        const currentTime = Date.now();

        if (gesture && gesture !== this.lastGesture && (currentTime - this.lastDetectionTime > 1000)) {
            this.handleGesture(gesture);
            this.lastGesture = gesture;
            this.lastDetectionTime = currentTime;
        }
    }

    handleGesture(gesture) {
        const overlay = document.getElementById('signOverlay');
        overlay.style.display = 'block';

        if (gesture === "SPACE") {
            this.buffer += " ";
            overlay.textContent = "Space added";
        } else if (gesture === "SEND") {
            if (this.buffer.trim()) {
                this.onSignDetected(this.buffer.trim());
                overlay.textContent = "Sent!";
                this.buffer = "";
            } else {
                overlay.textContent = "Buffer empty";
            }
        } else if (gesture === "BACKSPACE") {
            this.buffer = this.buffer.slice(0, -1);
            overlay.textContent = "Backspace";
        } else {
            // Regular letter/sign
            this.buffer += gesture;
            overlay.textContent = `Letter: ${gesture}`;
        }

        // Show current buffer after a short delay
        if (this.bufferTimeout) clearTimeout(this.bufferTimeout);
        this.bufferTimeout = setTimeout(() => {
            if (this.isActive) {
                overlay.textContent = this.buffer ? `Buffer: ${this.buffer}` : "Sign here...";
            }
        }, 1500);
    }

    classifySign(landmarks) {
        // Simplified ASL Letter Recognition Logic
        // 0: Wrist, 4: Thumb Tip, 8: Index Tip, 12: Middle Tip, 16: Ring Tip, 20: Pinky Tip
        // This is a heuristic approach based on finger extensions and relative positions

        const points = {
            thumb: [landmarks[1], landmarks[2], landmarks[3], landmarks[4]],
            index: [landmarks[5], landmarks[6], landmarks[7], landmarks[8]],
            middle: [landmarks[9], landmarks[10], landmarks[11], landmarks[12]],
            ring: [landmarks[13], landmarks[14], landmarks[15], landmarks[16]],
            pinky: [landmarks[17], landmarks[18], landmarks[19], landmarks[20]],
            wrist: landmarks[0]
        };

        const isExtended = (fingerPoints) => {
            const tip = fingerPoints[3];
            const pip = fingerPoints[1];
            return tip.y < pip.y;
        };

        const ext = {
            thumb: landmarks[4].x < landmarks[3].x, // Basic thumb extension check
            index: isExtended(points.index),
            middle: isExtended(points.middle),
            ring: isExtended(points.ring),
            pinky: isExtended(points.pinky)
        };

        // 1. SPACE - Peace Sign (Index and Middle extended)
        if (ext.index && ext.middle && !ext.ring && !ext.pinky) return "SPACE";

        // 2. SEND - Thumbs Up
        if (landmarks[4].y < landmarks[3].y && !ext.index && !ext.middle && !ext.ring && !ext.pinky) return "SEND";

        // 3. BACKSPACE - Pinky extended only
        if (ext.pinky && !ext.index && !ext.middle && !ext.ring) return "BACKSPACE";

        // 4. Letters (Basic mappings)
        // A: Fist with thumb on side
        if (!ext.index && !ext.middle && !ext.ring && !ext.pinky && landmarks[4].y < landmarks[6].y) return "A";

        // B: All fingers extended and together
        if (ext.index && ext.middle && ext.ring && ext.pinky) return "B";

        // C: Curved hand (Heuristic: all tips slightly above pips but close to each other horizontally)
        const dists = [
            Math.abs(landmarks[8].x - landmarks[12].x),
            Math.abs(landmarks[12].x - landmarks[16].x),
            Math.abs(landmarks[16].x - landmarks[20].x)
        ];
        if (dists.every(d => d < 0.1) && landmarks[8].y > landmarks[5].y && landmarks[4].x > landmarks[8].x) return "C";

        // D: Index extended, others closed
        if (ext.index && !ext.middle && !ext.ring && !ext.pinky) return "D";

        // F: Index and Thumb touching, others extended
        const distThumbIndex = Math.sqrt(Math.pow(landmarks[4].x - landmarks[8].x, 2) + Math.pow(landmarks[4].y - landmarks[8].y, 2));
        if (distThumbIndex < 0.05 && ext.middle && ext.ring && ext.pinky) return "F";

        // I: Pinky extended, others closed
        if (ext.pinky && !ext.index && !ext.middle && !ext.ring) return "I";

        // L: Thumb and Index extended
        if (ext.index && landmarks[4].x < landmarks[2].x && !ext.middle && !ext.ring && !ext.pinky) return "L";

        // V: Same as SPACE, adding it for recognition if needed (can be disambiguated by context or timing)
        // For now, we use V for SPACE to make it easy.

        // W: Index, Middle, Ring extended
        if (ext.index && ext.middle && ext.ring && !ext.pinky) return "W";

        // Y: Thumb and Pinky extended
        if (landmarks[4].x < landmarks[2].x && ext.pinky && !ext.index && !ext.middle && !ext.ring) return "Y";

        return null;
    }
}


// Audio Translation Manager using Web Speech API and Gemini
class AudioTranslationManager {
    constructor(onTranslation) {
        this.onTranslation = onTranslation;
        this.recognition = null;
        this.isActive = false;
        this.targetLang = 'none';
        this.apiKey = 'AIzaSyCgAg2JO_HT8L3KbnQaVvRQHLUMkBzl-VY';
    }

    initialize() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.error("Speech Recognition API not supported in this browser.");
            return false;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-IN'; // Better suited for Indian English

        this.recognition.onresult = async (event) => {
            if (!this.isActive) return;
            const transcript = event.results[event.results.length - 1][0].transcript;
            if (transcript.trim()) {
                await this.translateText(transcript.trim());
            }
        };

        this.recognition.onerror = (event) => {
            console.error("Speech Recognition Error:", event.error);
        };

        this.recognition.onend = () => {
            if (this.isActive) {
                // Restart automatically if still active to support continuous listening
                try {
                    this.recognition.start();
                } catch (e) { }
            }
        };

        return true;
    }

    setTargetLanguage(lang) {
        this.targetLang = lang;
    }

    async start() {
        if (!this.recognition && !this.initialize()) return;
        this.isActive = true;
        try {
            this.recognition.start();
        } catch (e) { }
    }

    stop() {
        this.isActive = false;
        if (this.recognition) {
            this.recognition.stop();
        }
    }

    async translateText(text) {
        if (this.targetLang === 'none' || !this.targetLang) {
            this.onTranslation(text, text);
            return;
        }

        try {
            // Refined prompt for Indian languages
            const prompt = `Translate the following English speech transcript into ${this.targetLang}: "${text}". Respond with ONLY the translated text. Do not include any explanations, quotes, or conversational filler.`;

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }]
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error("Gemini API Error:", response.status, errorData);
                this.onTranslation(text, text); // Fallback to original text
                return;
            }

            const data = await response.json();
            if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0].text) {
                const translatedText = data.candidates[0].content.parts[0].text.trim();
                console.log(`Translated [${this.targetLang}]:`, translatedText);
                this.onTranslation(text, translatedText);
            } else {
                console.warn("Unexpected Gemini API response format", data);
                this.onTranslation(text, text);
            }
        } catch (error) {
            console.error("Translation Error:", error);
            this.onTranslation(text, text);
        }
    }
}


// Join Request Manager
class JoinRequestManager {
    constructor(roomId, onNewRequest) {
        this.roomId = roomId;
        this.onNewRequest = onNewRequest;
        this.pollInterval = null;
    }

    startPolling() {
        this.checkRequests();
        this.pollInterval = setInterval(() => this.checkRequests(), 10000); // Every 10 seconds
    }

    stopPolling() {
        if (this.pollInterval) clearInterval(this.pollInterval);
    }

    async checkRequests() {
        try {
            const response = await fetch(`/video/get-pending-requests/${this.roomId}/`);
            const data = await response.json();
            if (data.success) {
                this.updateUI(data.requests);
                if (data.new_requests_count > 0 && this.onNewRequest) {
                    this.onNewRequest(data.requests[0]);
                }
            }
        } catch (error) {
            console.error('Error checking join requests:', error);
        }
    }

    updateUI(requests) {
        const countEl = document.getElementById('pendingCount');
        const listEl = document.getElementById('pendingRequestsList');
        if (!countEl || !listEl) return;

        countEl.textContent = requests.length;

        if (requests.length === 0) {
            listEl.innerHTML = '<div class="text-muted small italic px-3">No pending requests</div>';
            return;
        }

        listEl.innerHTML = requests.map(req => `
            <div class="list-group-item bg-transparent text-white border-secondary px-0 mb-2">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="small">
                        <div class="fw-bold text-truncate" style="max-width: 150px;">${req.user_email}</div>
                        <div class="text-muted" style="font-size: 0.7rem;">requested to join</div>
                    </div>
                    <div class="d-flex gap-1">
                        <button onclick="app.requests.handle('${req.id}', 'approve')" class="btn btn-success btn-sm p-1" title="Approve"><i class="fas fa-check"></i></button>
                        <button onclick="app.requests.handle('${req.id}', 'reject')" class="btn btn-outline-danger btn-sm p-1" title="Reject"><i class="fas fa-times"></i></button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async handle(requestId, action) {
        const formData = new FormData();
        formData.append('action', action);
        formData.append('csrfmiddlewaretoken', SignSpeakUtils.getCookie('csrftoken'));

        try {
            await fetch(`/video/handle-request/${requestId}/`, {
                method: 'POST',
                body: formData,
                headers: {
                    'X-CSRFToken': SignSpeakUtils.getCookie('csrftoken'),
                }
            });
            this.checkRequests();
        } catch (error) {
            console.error(`Error ${action}ing request:`, error);
        }
    }
}

// Main Application
class SignSpeakMeetApp {
    constructor(roomId, userEmail) {
        this.roomId = roomId;
        this.userEmail = userEmail;
        this.agora = null;
        this.chat = null;
        this.requests = null;
        this.timerInterval = null;
        this.seconds = 0;
        this.signLanguage = null;
        this.signLanguageActive = false;
        this.audioTranslation = null;
        this.audioTranslationActive = false;
        this.remoteUids = new Set(); // Tracking UIDs to prevent duplication
    }

    async init() {
        // 1. Init Agora
        const localVideo = document.getElementById('localVideo');
        this.agora = new AgoraRTCManager(
            this.roomId,
            localVideo,
            (uid, user) => this.addRemoteStream(uid, user),
            (uid) => this.removeRemoteStream(uid)
        );

        const success = await this.agora.initialize();
        if (!success) {
            this.showNotification('Could not initialize Agora', 'danger');
        }

        // 2. Init Chat
        const chatContainer = document.getElementById('chatMessages');
        this.chat = new ChatManager(this.roomId, chatContainer, this.userEmail);
        this.chat.initialize();

        // 3. Init Sign Language Manager
        this.signLanguage = new SignLanguageManager(localVideo, (text) => {
            this.chat.sendSign(text);
        });

        // 3.5 Init Audio Translation Manager
        this.audioTranslation = new AudioTranslationManager((original, translated) => {
            this.handleTranslation(original, translated);
        });

        const langSelect = document.getElementById('translationLang');
        if (langSelect) {
            langSelect.addEventListener('change', (e) => {
                this.audioTranslation.setTargetLanguage(e.target.value);
            });
        }

        // 4. Init Request Manager if host
        if (document.getElementById('pendingRequestsSection')) {
            this.requests = new JoinRequestManager(this.roomId, (req) => {
                this.showNotification(`New join request: ${req.user_email}`, 'warning');
            });
            this.requests.startPolling();
        }

        this.startTimer();

        // Notify backend about member creation
        await this.createMember();
    }

    async addRemoteStream(userId, user) {
        // Prevent duplication
        if (this.remoteUids.has(userId)) {
            console.log(`User ${userId} already added, updating tracks...`);
            if (user.videoTrack) user.videoTrack.play(`player-${userId}`);
            if (user.audioTrack) user.audioTrack.play();
            return;
        }

        this.remoteUids.add(userId);
        let videoItem = document.getElementById(`video-${userId}`);
        if (!videoItem) {
            // Fetch actual name from backend
            const member = await this.getMember(userId);
            const displayName = member.name || 'Participant';

            videoItem = document.createElement('div');
            videoItem.id = `video-${userId}`;
            videoItem.className = 'video-item';
            videoItem.innerHTML = `
                <div class="sign-overlay" style="position: absolute; top: 10px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.7); color: #00ff00; padding: 5px 15px; border-radius: 20px; z-index: 10; display: none; font-weight: bold; border: 1px solid #00ff00;"></div>
                <div id="player-${userId}" class="video-element"></div>
                <div class="video-overlay"><i class="fas fa-user me-1"></i>${displayName}</div>
            `;
            document.getElementById('videoGrid').appendChild(videoItem);

            // Add to sidebar list
            this.updateParticipantList(userId, 'add', displayName);
        }

        if (user.videoTrack) {
            user.videoTrack.play(`player-${userId}`);
        }
        if (user.audioTrack) {
            user.audioTrack.play();
        }
    }

    removeRemoteStream(userId) {
        this.remoteUids.delete(userId);
        const videoItem = document.getElementById(`video-${userId}`);
        if (videoItem) videoItem.remove();
        this.updateParticipantList(userId, 'remove');
    }

    updateParticipantList(userId, action, name = 'Participant') {
        const listEl = document.getElementById('participantsList');
        if (!listEl) return;

        if (action === 'add') {
            if (document.getElementById(`participant-${userId}`)) return;

            const item = document.createElement('div');
            item.id = `participant-${userId}`;
            item.className = 'list-group-item bg-transparent text-white border-secondary px-0 fade-in';
            item.innerHTML = `
                <div class="d-flex align-items-center py-2">
                    <div class="avatar me-2 bg-secondary rounded-circle d-flex align-items-center justify-content-center" 
                         style="width: 32px; height: 32px; font-weight: bold;">${name.charAt(0).toUpperCase()}</div>
                    <div>
                        <div class="fw-bold small">${name}</div>
                        <div class="text-muted" style="font-size: 0.7rem;">Member</div>
                    </div>
                </div>
            `;
            listEl.appendChild(item);
        } else {
            const item = document.getElementById(`participant-${userId}`);
            if (item) item.remove();
        }
    }

    startTimer() {
        this.timerInterval = setInterval(() => {
            this.seconds++;
            const timerEl = document.getElementById('meetingTimer');
            if (timerEl) timerEl.textContent = SignSpeakUtils.formatTime(this.seconds);
        }, 1000);
    }

    showNotification(msg, type) {
        const toastContainer = document.getElementById('toastContainer');
        if (toastContainer) {
            const toast = document.createElement('div');
            toast.className = `toast align-items-center text-white bg-${type} border-0 show mb-2`;
            toast.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
            toastContainer.appendChild(toast);
            setTimeout(() => toast.remove(), 4000);
        }
    }

    toggleVideo() {
        const enabled = this.agora.toggleVideo();
        this.updateBtn('videoBtn', enabled, 'fa-video', 'fa-video-slash');
    }

    toggleAudio() {
        const enabled = this.agora.toggleAudio();
        this.updateBtn('audioBtn', enabled, 'fa-microphone', 'fa-microphone-slash');
    }

    updateBtn(id, enabled, iconOn, iconOff) {
        const btn = document.getElementById(id);
        if (!btn) return;
        const icon = btn.querySelector('i');

        // Correcting logic: 'enabled' means functioning/ON.
        if (id === 'audioBtn' || id === 'videoBtn') {
            // Core controls: Use secondary (light) for ON, danger (red) for OFF
            if (enabled) {
                btn.className = 'control-btn secondary';
                icon.className = `fas ${iconOn}`;
            } else {
                btn.className = 'control-btn danger';
                icon.className = `fas ${iconOff}`;
            }
        } else {
            // Features (Sign, STT): Use active (blue) for ON, secondary for OFF
            if (enabled) {
                btn.className = 'control-btn active';
                icon.className = `fas ${iconOn}`;
            } else {
                btn.className = 'control-btn secondary';
                icon.className = `fas ${iconOn}`;
            }
        }
    }

    handleTranslation(originalText, translatedText) {
        const overlay = document.getElementById('captionOverlay-local');
        if (overlay) {
            overlay.textContent = translatedText;
            overlay.style.display = 'block';

            if (overlay.displayTimeout) clearTimeout(overlay.displayTimeout);

            overlay.displayTimeout = setTimeout(() => {
                if (overlay.textContent === translatedText) {
                    overlay.style.display = 'none';
                }
            }, 5000);
        }

        // Send caption to chat using simple custom message via websocket implementation
        this.chat.sendMessage(`[Caption]: ${translatedText}`);
    }

    async toggleSpeechToText() {
        this.audioTranslationActive = !this.audioTranslationActive;
        if (this.audioTranslationActive) {
            this.audioTranslation.start();
            this.showNotification('Audio Translation Enabled', 'info');
        } else {
            this.audioTranslation.stop();
            const overlay = document.getElementById('captionOverlay-local');
            if (overlay) overlay.style.display = 'none';
            this.showNotification('Audio Translation Disabled', 'secondary');
        }
        this.updateBtn('sttBtn', this.audioTranslationActive, 'fa-closed-captioning', 'fa-closed-captioning');
    }

    async toggleSignLanguage() {
        this.signLanguageActive = !this.signLanguageActive;
        if (this.signLanguageActive) {
            await this.signLanguage.start();
            this.showNotification('Sign Language Mode Enabled', 'info');
        } else {
            this.signLanguage.stop();
            this.showNotification('Sign Language Mode Disabled', 'secondary');
        }
        this.updateBtn('signBtn', this.signLanguageActive, 'fa-hands-helping', 'fa-hands-helping');
    }

    async leave() {
        await this.agora.stop();
        await this.deleteMember();
        window.location.href = '/';
    }

    async createMember() {
        const UID = sessionStorage.getItem('UID');
        const NAME = sessionStorage.getItem('name');
        await fetch('/video/create_member/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': SignSpeakUtils.getCookie('csrftoken')
            },
            body: JSON.stringify({ 'name': NAME, 'room_name': this.roomId, 'UID': UID })
        });
    }

    async getMember(uid) {
        let response = await fetch(`/video/get_member/?UID=${uid}&room_name=${this.roomId}`)
        let member = await response.json()
        return member
    }

    async deleteMember() {
        const UID = sessionStorage.getItem('UID');
        const NAME = sessionStorage.getItem('name');
        await fetch('/video/delete_member/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': SignSpeakUtils.getCookie('csrftoken')
            },
            body: JSON.stringify({ 'name': NAME, 'room_name': this.roomId, 'UID': UID })
        });
    }
}

// Initialize on page load if needed
window.SignSpeakApp = SignSpeakMeetApp;
window.addEventListener("beforeunload", () => {
    if (window.app) window.app.deleteMember();
});