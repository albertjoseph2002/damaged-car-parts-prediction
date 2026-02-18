const generateSlotsBtn = document.getElementById('generateSlotsBtn');
const imageCountInput = document.getElementById('imageCount');
const uploadGrid = document.getElementById('uploadGrid');
const analyzeBtn = document.getElementById('analyzeBtn');
const loading = document.getElementById('loading');
const resultsSection = document.getElementById('results-section');
const reportGrid = document.getElementById('reportGrid');
const zoomOverlay = document.getElementById('zoomOverlay');
const zoomImage = document.getElementById('zoomImage');

// Video elements
const videoUpload = document.getElementById('videoUpload');
const videoPreview = document.getElementById('videoPreview');
const videoPreviewContainer = document.querySelector('.video-preview-container');
const analyzeVideoBtn = document.getElementById('analyzeVideoBtn');
const videoResult = document.getElementById('videoResult');
const videoResultContainer = document.getElementById('videoResultContainer');
const downloadVideoLink = document.getElementById('downloadVideoLink');

// Webcam elements
const webcamVideo = document.getElementById('webcamVideo');
const webcamOverlay = document.getElementById('webcamOverlay');
const startWebcamBtn = document.getElementById('startWebcamBtn');
const stopWebcamBtn = document.getElementById('stopWebcamBtn');

let currentFileCount = 0;
let uploadedFiles = {};
let webcamStream = null;
let webcamInterval = null;
let webcamDetectedDamages = new Set();

// Tab Switching
function switchTab(tabName) {
    // Hide all sections
    document.querySelectorAll('.input-section').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-button').forEach(el => el.classList.remove('active'));

    // Show selected
    document.getElementById(`${tabName}Section`).style.display = 'block';
    // Find button to activate (naive approach works because buttons order matches)
    const buttons = document.querySelectorAll('.tab-button');
    if (tabName === 'images') buttons[0].classList.add('active');
    if (tabName === 'video') buttons[1].classList.add('active');
    if (tabName === 'webcam') buttons[2].classList.add('active');

    // Stop webcam if leaving webcam tab
    if (tabName !== 'webcam' && webcamStream) {
        stopWebcam();
    }
}
// Expose to window
window.switchTab = switchTab;


// ================= IMAGES LOGIC =================

generateSlots(); // Init with defaults
if (generateSlotsBtn) generateSlotsBtn.addEventListener('click', generateSlots);

function generateSlots() {
    const count = parseInt(imageCountInput.value);
    if (count < 1 || count > 5) {
        alert("Please choose between 1 and 5 images.");
        return;
    }

    currentFileCount = count;
    uploadedFiles = {};
    uploadGrid.innerHTML = '';
    reportGrid.innerHTML = '';
    resultsSection.style.display = 'none';
    analyzeBtn.disabled = true;

    for (let i = 0; i < count; i++) {
        createUploadCard(i);
    }
}

function createUploadCard(index) {
    const card = document.createElement('div');
    card.className = 'upload-card';
    const id = `img${index}`;

    card.innerHTML = `
        <h3>Image ${index + 1}</h3>
        <label for="${id}Upload" class="upload-label">
            <span id="${id}Text">Choose Image...</span>
            <input type="file" id="${id}Upload" accept="image/*">
        </label>
        <div class="preview-container">
            <img id="${id}Preview" class="preview-image" style="display: none;">
            <canvas id="${id}Canvas" class="result-canvas"></canvas>
        </div>
    `;

    uploadGrid.appendChild(card);

    const input = document.getElementById(`${id}Upload`);
    const text = document.getElementById(`${id}Text`);
    const preview = document.getElementById(`${id}Preview`);
    const canvas = document.getElementById(`${id}Canvas`);

    input.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            uploadedFiles[index] = file;
            text.textContent = file.name;

            const reader = new FileReader();
            reader.onload = (event) => {
                preview.src = event.target.result;
                preview.style.display = 'block';
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                checkAllFilesSelected();
            };
            reader.readAsDataURL(file);
        }
    });

    preview.onload = () => {
        canvas.width = preview.width;
        canvas.height = preview.height;
    };
}

function checkAllFilesSelected() {
    const keys = Object.keys(uploadedFiles);
    analyzeBtn.disabled = keys.length !== currentFileCount;
}

if (analyzeBtn) {
    analyzeBtn.addEventListener('click', async () => {
        if (Object.keys(uploadedFiles).length !== currentFileCount) return;

        loading.style.display = 'block';
        analyzeBtn.disabled = true;
        resultsSection.style.display = 'none';

        for (let i = 0; i < currentFileCount; i++) {
            const canvas = document.getElementById(`img${i}Canvas`);
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }

        const formData = new FormData();
        for (let i = 0; i < currentFileCount; i++) {
            formData.append('files', uploadedFiles[i]);
        }

        try {
            const response = await fetch('/analyze', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const report = await response.json();
            await generateReport(report);

        } catch (error) {
            console.error('Error:', error);
            alert('An error occurred during analysis.');
        } finally {
            loading.style.display = 'none';
            analyzeBtn.disabled = false;
        }
    });
}

// ... Report generation & Helper functions (generateReport, drawBoxes, createReportImage, createReportCard) ...
// (Reusing existing helper functions here, copy-pasting for completeness)

async function generateReport(report) {
    reportGrid.innerHTML = '';
    for (let i = 0; i < currentFileCount; i++) {
        const key = `Image ${i + 1}`;
        const inputId = `img${i}`;
        if (report[key]) {

            const reportImageSrc = await createReportImage(inputId, report[key]);
            const card = createReportCard(key, report[key], reportImageSrc);
            reportGrid.appendChild(card);

            const imgContainer = card.querySelector('.report-image-container');
            const img = card.querySelector('.report-image');
            imgContainer.addEventListener('click', () => {
                zoomImage.src = img.src;
                zoomOverlay.style.display = 'flex';
            });
        }
    }
    resultsSection.style.display = 'block';
}

function drawBoxes(elementIdPrefix, data) {
    const canvas = document.getElementById(`${elementIdPrefix}Canvas`);
    const preview = document.getElementById(`${elementIdPrefix}Preview`);
    if (!canvas || !preview) return; // Guard

    if (canvas.width !== preview.width || canvas.height !== preview.height) {
        canvas.width = preview.width;
        canvas.height = preview.height;
    }

    const ctx = canvas.getContext('2d');
    const boxes = data.boxes;
    const classes = data.classes;
    const confidences = data.confidences;

    ctx.lineWidth = 3;
    ctx.font = '16px Inter, sans-serif';

    boxes.forEach((box, i) => {
        const [x, y, w, h] = box;
        const label = classes[i];
        const score = confidences[i];
        ctx.strokeStyle = '#00FF00';
        ctx.strokeRect(x, y, w, h);
        const text = `${label} (${score.toFixed(1)}%)`;
        const textWidth = ctx.measureText(text).width;
        ctx.fillStyle = '#00FF00';
        ctx.fillRect(x, y - 25, textWidth + 10, 25);
        ctx.fillStyle = '#000000';
        ctx.fillText(text, x + 5, y - 7);
    });
}

function createReportImage(elementIdPrefix, data) {
    return new Promise((resolve) => {
        const img = document.getElementById(`${elementIdPrefix}Preview`);
        const tempCanvas = document.createElement('canvas');

        // Use natural dimensions to get full resolution
        tempCanvas.width = img.naturalWidth;
        tempCanvas.height = img.naturalHeight;

        const ctx = tempCanvas.getContext('2d');

        // 1. Draw image at full size
        ctx.drawImage(img, 0, 0);

        // 2. Draw boxes directly (using original coordinates)
        if (data && data.boxes) {
            const boxes = data.boxes;
            const classes = data.classes;
            const confidences = data.confidences;

            ctx.lineWidth = 5; // Thicker lines for high-res image
            ctx.font = '24px Inter, sans-serif'; // Larger font

            boxes.forEach((box, i) => {
                const [x, y, w, h] = box;
                const label = classes[i];
                const score = confidences[i];

                // Draw Box
                ctx.strokeStyle = '#00FF00';
                ctx.strokeRect(x, y, w, h);

                const text = `${label} ${Math.round(score)}%`;
                const textWidth = ctx.measureText(text).width;

                ctx.fillStyle = '#00FF00';
                ctx.fillRect(x, y - 35, textWidth + 10, 35);
                ctx.fillStyle = '#000000';
                ctx.fillText(text, x + 5, y - 7);
            });
        }

        resolve(tempCanvas.toDataURL('image/jpeg'));
    });
}

function createReportCard(title, data, imageSrc) {
    const card = document.createElement('div');
    card.className = 'report-card';
    const classes = data.classes;
    const confidences = data.confidences;

    let listItems = '';
    if (classes.length === 0) {
        listItems = '<li><span class="damage-label">No damage detected</span></li>';
    } else {
        classes.forEach((label, i) => {
            const score = confidences[i];
            listItems += `<li><span class="damage-label">${label}</span><span class="damage-score">Confidence: ${score.toFixed(1)}%</span></li>`;
        });
    }

    card.innerHTML = `<h3>${title}</h3><div class="report-image-container"><img src="${imageSrc}" class="report-image"></div><div class="report-details"><ul>${listItems}</ul></div>`;
    return card;
}

if (zoomOverlay) {
    zoomOverlay.addEventListener('click', () => {
        zoomOverlay.style.display = 'none';
    });
}


// ================= VIDEO LOGIC =================
if (videoUpload) {
    videoUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        console.log("Video selected:", file);
        if (file) {
            const url = URL.createObjectURL(file);
            console.log("Video URL:", url);
            videoPreview.src = url;
            videoPreviewContainer.style.display = 'block';
            videoPreview.style.display = 'block'; // Ensure video itself is visible
            analyzeVideoBtn.disabled = false;
        }
    });

    analyzeVideoBtn.addEventListener('click', async () => {
        const file = videoUpload.files[0];
        if (!file) return;

        loading.style.display = 'block';
        analyzeVideoBtn.disabled = true;
        videoResultContainer.style.display = 'none';

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/analyze_video', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Video processing failed');

            const data = await response.json();
            // Expecting: { video_url: "/static/videos/processed_...", damage_summary: [{label: str, score: float}] }

            videoResult.src = data.video_url;
            downloadVideoLink.href = data.video_url;

            // Generate Summary HTML
            let summaryHTML = '<h4>Detected Damages:</h4><ul class="video-damage-list">';
            if (data.damage_summary && data.damage_summary.length > 0) {
                data.damage_summary.forEach(item => {
                    summaryHTML += `
                        <li>
                            <span class="damage-label">${item.label}</span>
                            <span class="damage-score">Max Confidence: ${item.score.toFixed(1)}%</span>
                        </li>
                    `;
                });
            } else {
                summaryHTML += '<li>No significant damage detected.</li>';
            }
            summaryHTML += '</ul>';

            // Create or update summary container
            let summaryContainer = document.getElementById('videoDamageSummary');
            if (!summaryContainer) {
                summaryContainer = document.createElement('div');
                summaryContainer.id = 'videoDamageSummary';
                summaryContainer.className = 'report-details'; // Reuse styling
                videoResultContainer.appendChild(summaryContainer);
            }
            summaryContainer.innerHTML = summaryHTML;

            videoResultContainer.style.display = 'block';

        } catch (error) {
            console.error(error);
            alert('Failed to process video.');
        } finally {
            loading.style.display = 'none';
            analyzeVideoBtn.disabled = false;
        }
    });
}

// ================= WEBCAM LOGIC =================
if (startWebcamBtn) {
    startWebcamBtn.addEventListener('click', startWebcam);
    stopWebcamBtn.addEventListener('click', stopWebcam);
}

async function startWebcam() {
    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
        webcamVideo.srcObject = webcamStream;
        startWebcamBtn.disabled = true;
        stopWebcamBtn.disabled = false;

        // Start detection loop
        webcamInterval = setInterval(captureAndDetect, 500); // 2 FPS to reduce load
    } catch (err) {
        console.error("Webcam error:", err);
        alert("Could not access webcam.");
    }
}

function stopWebcam() {
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamVideo.srcObject = null;
        webcamStream = null;
    }
    if (webcamInterval) {
        clearInterval(webcamInterval);
        webcamInterval = null;
    }
    startWebcamBtn.disabled = false;
    stopWebcamBtn.disabled = true;

    // Reset detection set and UI
    webcamDetectedDamages.clear();
    const list = document.getElementById('webcamDamageList');
    if (list) list.innerHTML = '';
    const resultsContainer = document.getElementById('webcamResults');
    if (resultsContainer) resultsContainer.style.display = 'none';

    // Clear overlay
    const ctx = webcamOverlay.getContext('2d');
    ctx.clearRect(0, 0, webcamOverlay.width, webcamOverlay.height);
}

async function captureAndDetect() {
    if (!webcamStream) return;

    const canvas = document.createElement('canvas'); // Temp canvas for capture
    canvas.width = webcamVideo.videoWidth;
    canvas.height = webcamVideo.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(webcamVideo, 0, 0, canvas.width, canvas.height);

    // Resize overlay to match video
    if (webcamOverlay.width !== canvas.width || webcamOverlay.height !== canvas.height) {
        webcamOverlay.width = canvas.width;
        webcamOverlay.height = canvas.height;
    }

    canvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append('file', blob, 'webcam_frame.jpg');

        try {
            const response = await fetch('/detection', { // Reuse single image detection
                method: 'POST',
                body: formData
            });
            if (response.ok) {
                const result = await response.json();
                drawWebcamOverlay(result);
            }
        } catch (e) {
            console.error("Frame detection error", e);
        }
    }, 'image/jpeg');
}

function drawWebcamOverlay(data) {
    const ctx = webcamOverlay.getContext('2d');
    ctx.clearRect(0, 0, webcamOverlay.width, webcamOverlay.height);

    const boxes = data.boxes;
    const classes = data.classes;
    const confidences = data.confidences;

    ctx.lineWidth = 3;
    ctx.font = '18px Inter, sans-serif';

    // Show list if hidden
    const resultsContainer = document.getElementById('webcamResults');
    const list = document.getElementById('webcamDamageList');

    if (boxes.length > 0 && resultsContainer && resultsContainer.style.display === 'none') {
        resultsContainer.style.display = 'block';
    }

    boxes.forEach((box, i) => {
        const [x, y, w, h] = box;
        const label = classes[i];
        const score = confidences[i];

        // Draw Box
        ctx.strokeStyle = '#00FF00';
        ctx.strokeRect(x, y, w, h);

        const text = `${label} ${Math.round(score)}%`;
        const textWidth = ctx.measureText(text).width;
        ctx.fillStyle = '#00FF00';
        ctx.fillRect(x, y - 25, textWidth + 10, 25);
        ctx.fillStyle = '#000000';
        ctx.fillText(text, x + 5, y - 7);

        // Update List
        if (!webcamDetectedDamages.has(label)) {
            console.log("Adding to list:", label);
            webcamDetectedDamages.add(label);
            if (list) {
                const li = document.createElement('li');
                li.innerHTML = `
                    <span class="damage-label">${label}</span>
                    <span class="damage-score">Detected</span>
                `;
                list.appendChild(li);
            }
        }
    });
}
