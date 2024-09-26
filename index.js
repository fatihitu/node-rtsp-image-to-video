const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

// Connection URL for RTSP streaming
const CAMERA_STREAM_URL = "rtsp://username:password@ip-address:554/stream1";
// Directory to save screenshots
const IMAGE_OUTPUT_DIR = path.join(__dirname, 'screenshots');

// Interval settings
const SCREENSHOT_INTERVAL_MS = 10 * 1000; // 10 seconds in milliseconds
const VIDEO_CREATION_INTERVAL_MS = 3600 * 1000; // 1 hour in milliseconds
const TOTAL_CAPTURED_SS_COUNT = Math.floor(VIDEO_CREATION_INTERVAL_MS / SCREENSHOT_INTERVAL_MS); // Number of screenshots per video

let screenshotCount = 0; // Counter for saved screenshots
let isCreatingVideo = false; // Flag to prevent concurrent video creation
let captureInterval; // Interval ID for capturing screenshots
let lastCaptureTime = 0; // Timestamp of the last capture

// Ensure the screenshots directory exists
if (!fs.existsSync(IMAGE_OUTPUT_DIR)) {
    fs.mkdirSync(IMAGE_OUTPUT_DIR);
}

// Function to get a simplified timestamp for video file name
function getTimestamp(date) {
    const datePart = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const timePart = date.toTimeString().split(' ')[0].split(':').slice(0, 2).join('_'); // HH_MM
    return `${datePart}_${timePart}`;
}

// Function to capture a screenshot
function captureScreenshot() {
    const now = Date.now();

    if (isCreatingVideo || now - lastCaptureTime < SCREENSHOT_INTERVAL_MS) return; // Do not capture a screenshot if video creation is in progress or too soon
    lastCaptureTime = now; // Update the last capture time

    const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    const outputFilePath = path.join(IMAGE_OUTPUT_DIR, `screenshot-${timestamp}.jpg`);

    ffmpeg(CAMERA_STREAM_URL)
        .inputOptions('-rtsp_transport', 'tcp')
        .output(outputFilePath)
        .frames(1)
        .on('end', () => {
            screenshotCount++;
            console.log(`Progress: ${screenshotCount}/${TOTAL_CAPTURED_SS_COUNT} images recorded for video`);

            if (screenshotCount >= TOTAL_CAPTURED_SS_COUNT) {
                clearInterval(captureInterval); // Stop capturing images
                processRemainingImages(); // Start processing images immediately
            }
        })
        .on('error', (err) => {
            console.error('Error taking screenshot:', err.message);
        })
        .run();
}

// Function to create a video from a batch of `TOTAL_CAPTURED_SS_COUNT` images
function createVideoFromBatch(files) {
    if (isCreatingVideo) return; // Prevent concurrent video creation
    isCreatingVideo = true;

    if (files.length < TOTAL_CAPTURED_SS_COUNT) {
        console.error(`Expected ${TOTAL_CAPTURED_SS_COUNT} images, but found ${files.length}. Aborting video creation.`);
        isCreatingVideo = false;
        resumeCapturing(); // Resume capturing if the video creation is aborted
        return;
    }

    // Create a list of files for ffmpeg concat protocol
    const listFilePath = path.join(IMAGE_OUTPUT_DIR, 'filelist.txt');
    const listFileContent = files.slice(0, TOTAL_CAPTURED_SS_COUNT).map(file => `file '${path.join(IMAGE_OUTPUT_DIR, file)}'`).join('\n');
    fs.writeFileSync(listFilePath, listFileContent);

    const batchFiles = files.slice(0, TOTAL_CAPTURED_SS_COUNT);
    const firstImageFileName = batchFiles[batchFiles.length - 1];

    // Extract the timestamp part from the filename
    const timestampPart = firstImageFileName.match(/screenshot-(.+)\.jpg$/)[1];

    // Convert the timestamp part into a valid ISO format
    const formattedTimestamp = timestampPart
        .replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z');  // Replace last hyphens with colons, and format milliseconds

    // Convert to a Date object
    const lastImageTime = new Date(formattedTimestamp);

    if (isNaN(lastImageTime.getTime())) {
        console.error('Failed to parse date from the last image. Skipping this batch.');
        isCreatingVideo = false;
        resumeCapturing();
        return;
    }

    // Simplify the file name by using underscores and removing colons
    const videoFileName = `video-${formatDate(lastImageTime)}.mp4`;
    const videoFilePath = path.resolve(__dirname, videoFileName);  // Ensure absolute path

    console.log(`Creating video from ${TOTAL_CAPTURED_SS_COUNT} screenshots...`);
    console.log(`Running ffmpeg with output file: ${videoFilePath}`);

    ffmpeg()
        .input(listFilePath)
        .inputOptions('-f', 'concat', '-safe', '0')
        .outputOptions('-pix_fmt', 'yuv420p', '-framerate', '12')
        .output(videoFilePath)
        .on('start', (commandLine) => {
            console.log(`Spawned ffmpeg with command: ${commandLine}`);
        })
        .on('end', () => {
            console.log('Video created:', videoFilePath);
            batchFiles.forEach(file => fs.unlinkSync(path.join(IMAGE_OUTPUT_DIR, file))); // Delete processed images
            fs.unlinkSync(listFilePath); // Delete the list file
            screenshotCount = 0; // Reset the counter after creating the video
            isCreatingVideo = false; // Reset the flag to allow the next video creation
            processRemainingImages(); // Continue processing remaining images if any
        })
        .on('error', (err) => {
            console.error('Error creating video:', err.message);
            isCreatingVideo = false; // Reset the flag on error
            resumeCapturing(); // Resume capturing even if there's an error
        })
        .run();
}

function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}`;
}

// Function to resume capturing screenshots
function resumeCapturing() {
    console.log('Resuming image capture...');
    startCapturing(); // Start capturing images again
}

// Function to process leftover images into video files if they exceed the expected count
function processRemainingImages() {
    const files = fs.readdirSync(IMAGE_OUTPUT_DIR).filter(file => file.endsWith('.jpg')).sort();

    if (files.length >= TOTAL_CAPTURED_SS_COUNT) {
        console.log(`Processing batch of ${files.length} images...`);
        createVideoFromBatch(files); // Process the next batch
    } else {
        resumeCapturing(); // Resume capturing if there are no more batches to process
    }
}

// Function to start capturing screenshots every 10 seconds
function startCapturing() {
    captureInterval = setInterval(captureScreenshot, SCREENSHOT_INTERVAL_MS);
}

// Function to process any remaining images on app startup
function processImagesOnStartup() {
    console.log('Processing existing images on startup...');
    processRemainingImages(); // Process images into videos if more than `TOTAL_CAPTURED_SS_COUNT` are found
}

// Start processing any remaining images when the app starts
processImagesOnStartup();

// Start the capturing process
startCapturing();
