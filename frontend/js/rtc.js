let peerConnections = new Map(); // peerId -> RTCPeerConnection
let remoteStreams = new Map(); // peerId -> MediaStream
let ws, localStream;
let isVideoOn = true, isAudioOn = true;
let isScreenSharing = false;
let currentRoom = null;
let userName = '';
let myPeerId = null;
let connectionLog = [];
let originalVideoTrack = null;

const wsDomain = "wss://5d036964eb1aed.lhr.life";
const iceServers = [
  { urls: "stun:stun.relay.metered.ca:80" },
  {
    urls: "turn:global.relay.metered.ca:80",
    username: "dc6147f34d642e995e9bc77f",
    credential: "RgQnjpgc6XFUkuhA",
  },
  {
    urls: "turn:global.relay.metered.ca:80?transport=tcp",
    username: "dc6147f34d642e995e9bc77f",
    credential: "RgQnjpgc6XFUkuhA",
  },
  {
    urls: "turn:global.relay.metered.ca:443",
    username: "dc6147f34d642e995e9bc77f",
    credential: "RgQnjpgc6XFUkuhA",
  },
  {
    urls: "turns:global.relay.metered.ca:443?transport=tcp",
    username: "dc6147f34d642e995e9bc77f",
    credential: "RgQnjpgc6XFUkuhA",
  },
];

// Initialize Lucide icons
document.addEventListener('DOMContentLoaded', function () {
  lucide.createIcons();
});

function logConnection(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const logMsg = `[${timestamp}] ${msg}`;
  connectionLog.push(logMsg);

  const logContainer = document.getElementById("connectionLog");
  logContainer.innerHTML = connectionLog.slice(-10).map(log => `<div>${log}</div>`).join('');
  logContainer.scrollTop = logContainer.scrollHeight;

  console.log(logMsg);
}

function updateConnectionStatus(status) {
  const badge = document.getElementById("connectionBadge");
  const icon = document.getElementById("connectionIcon");

  if (status === 'connected') {
    badge.className = "inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800";
    badge.textContent = "Connected";
    icon.setAttribute('data-lucide', 'wifi');
    icon.className = "w-5 h-5 text-green-500";
  } else {
    badge.className = "inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800";
    badge.textContent = status;
    icon.setAttribute('data-lucide', 'wifi-off');
    icon.className = "w-5 h-5 text-red-500";
  }

  lucide.createIcons();
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function updateParticipants(participants) {
  const list = document.getElementById("participantsList");
  list.innerHTML = participants.map(participant => {
    const name = typeof participant === 'string' ? participant : participant.userName;
    return `
          <div class="flex items-center gap-3 p-3 bg-blue-50 rounded-xl">
            <div class="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
              <span class="text-white text-sm font-medium">${name.charAt(0).toUpperCase()}</span>
            </div>
            <span class="text-gray-800 font-medium">${name}</span>
          </div>
        `;
  }).join('');
}

function updateRemoteVideos() {
  const videoGrid = document.querySelector('.grid.md\\:grid-cols-2');

  // Clear existing remote videos (keep local video)
  const remoteVideos = videoGrid.querySelectorAll('.remote-video-container');
  remoteVideos.forEach(container => container.remove());

  // Add videos for each remote participant
  remoteStreams.forEach((stream, peerId) => {
    const videoContainer = document.createElement('div');
    videoContainer.className = 'relative bg-black rounded-2xl overflow-hidden shadow-xl remote-video-container';

    videoContainer.innerHTML = `
          <video
            id="remoteVideo-${peerId}"
            autoplay
            playsinline
            class="w-full h-80 object-cover"
          ></video>
          <div class="absolute top-4 left-4 bg-black/70 text-white px-3 py-1 rounded-lg text-sm font-medium">
            Remote ${peerId.substring(0, 6)}
          </div>
          <div class="absolute bottom-4 right-4 bg-black/70 text-white px-3 py-1 rounded-lg text-sm" id="remoteStatus-${peerId}">
            Connected
          </div>
        `;

    videoGrid.appendChild(videoContainer);

    // Set the stream to the video element
    const videoElement = document.getElementById(`remoteVideo-${peerId}`);
    if (videoElement) {
      videoElement.srcObject = stream;
    }
  });

  // Adjust grid layout based on number of participants
  const totalVideos = remoteStreams.size + 1; // +1 for local video
  if (totalVideos <= 2) {
    videoGrid.className = 'grid md:grid-cols-2 gap-6 mb-6';
  } else if (totalVideos <= 4) {
    videoGrid.className = 'grid md:grid-cols-2 lg:grid-cols-2 gap-6 mb-6';
  } else {
    videoGrid.className = 'grid md:grid-cols-3 lg:grid-cols-3 gap-6 mb-6';
  }
}

function updateLocalStatus() {
  const localStatus = document.getElementById("localStatus");
  localStatus.innerHTML = `
        <i data-lucide="${isVideoOn ? (isScreenSharing ? 'monitor' : 'camera') : 'camera-off'}" class="w-4 h-4"></i>
        <i data-lucide="${isAudioOn ? 'mic' : 'mic-off'}" class="w-4 h-4"></i>
      `;
  lucide.createIcons();
}

function updateScreenShareButton() {
  const btn = document.getElementById("shareScreen");
  btn.innerHTML = `
        <i data-lucide="${isScreenSharing ? 'monitor-x' : 'monitor'}" class="w-5 h-5"></i>
        ${isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
      `;
  btn.className = `flex items-center gap-3 px-6 py-3 rounded-xl font-medium transition-all hover-scale ${isScreenSharing ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-purple-500 hover:bg-purple-600 text-white'
    }`;
  lucide.createIcons();
}

async function copyRoomId() {
  try {
    await navigator.clipboard.writeText(currentRoom);
    document.getElementById('copyIcon').classList.add('hidden');
    document.getElementById('checkIcon').classList.remove('hidden');
    setTimeout(() => {
      document.getElementById('copyIcon').classList.remove('hidden');
      document.getElementById('checkIcon').classList.add('hidden');
    }, 2000);
  } catch (err) {
    console.error('Failed to copy room ID:', err);
  }
}

async function initializeMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    document.getElementById("localVideo").srcObject = localStream;

    // Store original video track for screen share toggle
    originalVideoTrack = localStream.getVideoTracks()[0];

    logConnection("Media initialized successfully");
    return true;
  } catch (err) {
    logConnection(`Media error: ${err.message}`);
    alert("Could not access camera/microphone. Please check permissions.");
    return false;
  }
}

function toggleVideo() {
  isVideoOn = !isVideoOn;
  const videoTrack = localStream?.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = isVideoOn;
  }

  const btn = document.getElementById("toggleVideo");
  btn.innerHTML = `
        <i data-lucide="${isVideoOn ? 'video' : 'video-off'}" class="w-5 h-5"></i>
        ${isVideoOn ? 'Video On' : 'Video Off'}
      `;
  btn.className = `flex items-center gap-3 px-6 py-3 rounded-xl font-medium transition-all hover-scale ${isVideoOn ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-red-500 hover:bg-red-600 text-white'
    }`;

  updateLocalStatus();
  lucide.createIcons();
  logConnection(`Video ${isVideoOn ? 'enabled' : 'disabled'}`);
}

function toggleAudio() {
  isAudioOn = !isAudioOn;
  const audioTrack = localStream?.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = isAudioOn;
  }

  const btn = document.getElementById("toggleAudio");
  btn.innerHTML = `
        <i data-lucide="${isAudioOn ? 'mic' : 'mic-off'}" class="w-5 h-5"></i>
        ${isAudioOn ? 'Mic On' : 'Mic Off'}
      `;
  btn.className = `flex items-center gap-3 px-6 py-3 rounded-xl font-medium transition-all hover-scale ${isAudioOn ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-red-500 hover:bg-red-600 text-white'
    }`;

  updateLocalStatus();
  lucide.createIcons();
  logConnection(`Audio ${isAudioOn ? 'enabled' : 'disabled'}`);
}

async function toggleScreenShare() {
  if (!isScreenSharing) {
    // Start screen sharing
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const videoTrack = screenStream.getVideoTracks()[0];

      // Replace video track for all peer connections
      peerConnections.forEach(async (pc) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(videoTrack);
        }
      });

      // Update local video display
      const newStream = new MediaStream();
      newStream.addTrack(videoTrack);
      localStream.getAudioTracks().forEach(track => newStream.addTrack(track));
      document.getElementById("localVideo").srcObject = newStream;

      isScreenSharing = true;
      updateScreenShareButton();
      updateLocalStatus();
      logConnection("Screen sharing started");

      // Handle when screen sharing ends
      videoTrack.onended = async () => {
        await stopScreenShare();
      };
    } catch (err) {
      logConnection(`Screen share error: ${err.message}`);
    }
  } else {
    await stopScreenShare();
  }
}

async function stopScreenShare() {
  try {
    // Create new camera stream if needed
    if (!originalVideoTrack || originalVideoTrack.readyState === 'ended') {
      const newCameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
      originalVideoTrack = newCameraStream.getVideoTracks()[0];

      // Update local stream
      const oldVideoTrack = localStream.getVideoTracks()[0];
      localStream.removeTrack(oldVideoTrack);
      localStream.addTrack(originalVideoTrack);

      // Update local video display
      document.getElementById("localVideo").srcObject = localStream;
    }

    // Replace video track for all peer connections
    peerConnections.forEach(async (pc) => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender && originalVideoTrack) {
        await sender.replaceTrack(originalVideoTrack);
        originalVideoTrack.enabled = isVideoOn;
      }
    });

    isScreenSharing = false;
    updateScreenShareButton();
    updateLocalStatus();
    logConnection("Screen sharing stopped");
  } catch (err) {
    logConnection(`Error stopping screen share: ${err.message}`);
    isScreenSharing = false;
    updateScreenShareButton();
  }
}

async function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection({ iceServers });
  peerConnections.set(peerId, pc);

  // Create remote stream for this peer
  const remoteStream = new MediaStream();
  remoteStreams.set(peerId, remoteStream);

  pc.onicecandidate = (event) => {
    if (event.candidate && ws) {
      ws.send(JSON.stringify({
        type: "candidate",
        candidate: event.candidate,
        room: currentRoom,
        to: peerId
      }));
    }
  };

  pc.ontrack = (event) => {
    logConnection(`Received remote ${event.track.kind} track from ${peerId.substring(0, 6)}`);
    remoteStream.addTrack(event.track);
    updateRemoteVideos();
    updateConnectionStatus("connected");
  };

  pc.onconnectionstatechange = () => {
    logConnection(`Connection state with ${peerId.substring(0, 6)}: ${pc.connectionState}`);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      removePeer(peerId);
    }
  };

  pc.oniceconnectionstatechange = () => {
    logConnection(`ICE connection state with ${peerId.substring(0, 6)}: ${pc.iceConnectionState}`);
  };

  // Add local stream tracks to this peer connection
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });
  }

  return pc;
}

function removePeer(peerId) {
  const pc = peerConnections.get(peerId);
  if (pc) {
    pc.close();
    peerConnections.delete(peerId);
  }

  remoteStreams.delete(peerId);
  updateRemoteVideos();
  logConnection(`Removed peer ${peerId.substring(0, 6)}`);
}

function initWebSocket() {
  ws = new WebSocket(wsDomain);

  ws.onopen = () => {
    logConnection("WebSocket connected");
    ws.send(JSON.stringify({
      type: "join-room",
      room: currentRoom,
      userName: userName
    }));
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case "room-joined":
        logConnection(`Joined room: ${msg.room}`);
        myPeerId = msg.participants.find(p => p.userName === userName)?.id;
        updateParticipants(msg.participants);

        // Create peer connections for existing participants
        for (const participant of msg.participants) {
          if (participant.id !== myPeerId) {
            await createPeerConnection(participant.id);
          }
        }
        break;

      case "user-joined":
        logConnection(`${msg.userName} joined the room`);
        updateParticipants(msg.participants);

        // Create peer connection for new user and send offer
        const newParticipant = msg.participants.find(p => p.userName === msg.userName);
        if (newParticipant && newParticipant.id !== myPeerId) {
          const pc = await createPeerConnection(newParticipant.id);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(JSON.stringify({
            type: "offer",
            offer,
            room: currentRoom,
            to: newParticipant.id
          }));
        }
        break;

      case "user-left":
        logConnection(`${msg.userName} left the room`);
        updateParticipants(msg.participants);

        // Remove peer connection for departed user
        const departedUser = msg.participants.find(p => p.userName === msg.userName);
        if (departedUser) {
          removePeer(departedUser.id);
        }
        break;

      case "offer":
        if (msg.from !== myPeerId) {
          logConnection(`Received offer from ${msg.from.substring(0, 6)}`);
          let pc = peerConnections.get(msg.from);
          if (!pc) {
            pc = await createPeerConnection(msg.from);
          }
          await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(JSON.stringify({
            type: "answer",
            answer,
            room: currentRoom,
            to: msg.from
          }));
        }
        break;

      case "answer":
        if (msg.from !== myPeerId) {
          logConnection(`Received answer from ${msg.from.substring(0, 6)}`);
          const pc = peerConnections.get(msg.from);
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
          }
        }
        break;

      case "candidate":
        if (msg.from !== myPeerId) {
          logConnection(`Received ICE candidate from ${msg.from.substring(0, 6)}`);
          const pc = peerConnections.get(msg.from);
          if (pc) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (err) {
              console.error("Error adding candidate", err);
            }
          }
        }
        break;
    }
  };

  ws.onclose = () => {
    logConnection("WebSocket disconnected");
    updateConnectionStatus("Disconnected");
  };

  ws.onerror = (error) => {
    logConnection(`WebSocket error: ${error}`);
  };
}

async function joinMeeting(roomId) {
  if (!await initializeMedia()) return;

  currentRoom = roomId;
  userName = document.getElementById("nameInput").value || "Anonymous";

  document.getElementById("joinSection").classList.add("hidden");
  document.getElementById("meetingSection").classList.remove("hidden");

  document.getElementById("currentRoom").textContent = currentRoom;
  document.getElementById("shareRoom").textContent = currentRoom;
  document.getElementById("currentUser").textContent = userName;

  initWebSocket();
}

function leaveMeeting() {
  if (ws) {
    ws.send(JSON.stringify({
      type: "leave-room",
      room: currentRoom,
      userName: userName
    }));
    ws.close();
  }

  // Close all peer connections
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
  remoteStreams.clear();

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  document.getElementById("joinSection").classList.remove("hidden");
  document.getElementById("meetingSection").classList.add("hidden");

  // Reset variables
  ws = localStream = null;
  currentRoom = null;
  userName = '';
  myPeerId = null;
  isVideoOn = isAudioOn = true;
  isScreenSharing = false;
  originalVideoTrack = null;
  connectionLog = [];

  // Reset UI
  updateConnectionStatus("Disconnected");
  updateParticipants(['Waiting for participants...']);

  logConnection("Left meeting");
}

// Event Listeners
document.getElementById("joinBtn").onclick = () => {
  const roomId = document.getElementById("roomInput").value.trim();
  if (roomId) {
    joinMeeting(roomId.toUpperCase());
  } else {
    alert("Please enter a room ID");
  }
};

document.getElementById("createBtn").onclick = () => {
  const roomId = generateRoomId();
  document.getElementById("roomInput").value = roomId;
  joinMeeting(roomId);
};

document.getElementById("toggleVideo").onclick = toggleVideo;
document.getElementById("toggleAudio").onclick = toggleAudio;
document.getElementById("shareScreen").onclick = toggleScreenShare;
document.getElementById("leaveCall").onclick = leaveMeeting;
document.getElementById("copyRoomBtn").onclick = copyRoomId;

// Handle page unload
window.addEventListener('beforeunload', () => {
  if (ws && currentRoom) {
    ws.send(JSON.stringify({
      type: "leave-room",
      room: currentRoom,
      userName: userName
    }));
  }
});