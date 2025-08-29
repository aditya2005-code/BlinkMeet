let stream;
const localVideoRef = document.getElementById("local-video");

const getstream = async () => {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log("STREAM", stream);
        localVideoRef.srcObject = stream;
        localVideoRef.muted = true;
        localVideoRef.play();
    } catch (err) {
        console.log("Stream ERROR", err);
    }
};

document.getElementById("start").addEventListener("click", getstream);

const recordBtn = document.getElementById('toggle-recording');
const downloadBtn = document.getElementById('download');
let recording = false;
let recorder;
let recordedChunks = [];

// missing vars from before
let recorderVideoRef = null;
let recordingComplete = false;

let timerInterval;
let seconds = 0;

function startTimer() {
    seconds = 0;
    document.getElementById("timer").textContent = "0s";
    timerInterval = setInterval(() => {
        seconds++;
        document.getElementById("timer").textContent = seconds + "s";
    }, 1000);
}

function stoptimer() {
    clearInterval(timerInterval);
}

const downloadRecordedVideo = (url) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recorded_video.webm';
    a.click();
};

const playback = document.getElementById("playback");

recordBtn.addEventListener('click', () => {
    if (!stream) return;

    if (!recording) {
        recorder = new MediaRecorder(stream);
        recordedChunks = [];

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };

        recorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            recorderVideoRef = url;
            recordingComplete = true;
            playback.src = url;                  
            downloadBtn.disabled = false;        
            downloadBtn.onclick = () => downloadRecordedVideo(url);
            stoptimer();
        };

        recorder.start(3000);
        recording = true;
        recordBtn.textContent = 'Stop Recording';
        startTimer();

    } else {
        recorder.stop();
        recording = false;
        recordBtn.textContent = 'Start Recording';
    }
});