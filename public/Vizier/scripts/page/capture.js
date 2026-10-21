// capture.js, by Allen Rakhamimov.
// Saving what the canvas shows: an image, with any simulated color vision
// applied, and a video, encoded frame by frame into an MP4.
//
// page.js decides when to capture and says what happened; this file only
// turns the canvas into a file. Nothing in the solver depends on it.

'use strict';

// A file name that says which case, at what mesh and how far into the run.
function captureName(presetId, cells, frames, extension) {
    return `vizier-${diagnosticsSlug(presetId)}-` +
           `${cells}-${frames}.${extension}`;
}

// Images

// Under a simulated vision the saved image is the one on screen: the same
// matrix, applied to the pixels here, since a CSS filter never reaches the
// canvas's own image data.
function captureImage(canvas, vision) {
    if (vision === 'normal') return canvas;
    const source = document.createElement('canvas');
    source.width = canvas.width;
    source.height = canvas.height;
    const context = source.getContext('2d');
    context.drawImage(canvas, 0, 0);
    const image = context.getImageData(0, 0, source.width, source.height);
    diagnosticsSimulateVision(image.data, vision);
    context.putImageData(image, 0, 0);
    return source;
}

// Video
//
// H.264 in an MP4 where the browser can encode it, since every editor opens
// that, and VP9 in an MP4 otherwise. The bit rate, about 9 Mbit/s at 1024
// pixels, is plenty for flat fields of color.

// Stopped on a frame count, so a recording left running cannot fill the
// memory.
const CAPTURE_FRAME_CAP = 3600;
const CAPTURE_FRAME_RATE = 60;
const CAPTURE_KEYFRAME_SPACING = 120;
const CAPTURE_ENCODERS = [
    { codec: 'avc1.640028', muxerCodec: 'avc' },        // H.264 High, level 4.0
    { codec: 'avc1.4d0028', muxerCodec: 'avc' },        // Main
    { codec: 'avc1.420028', muxerCodec: 'avc' },        // Baseline
    { codec: 'vp09.00.40.08', muxerCodec: 'vp9' },
];

function captureCanEncode() {
    return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

async function captureChooseEncoder(width, height) {
    for (const { codec, muxerCodec } of CAPTURE_ENCODERS) {
        const config = { codec, width, height, framerate: CAPTURE_FRAME_RATE,
                         bitrate: Math.round(0.15 * width * height * CAPTURE_FRAME_RATE) };
        if (muxerCodec === 'avc') config.avc = { format: 'avc' };
        const support = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
        if (support.supported) return { config, muxerCodec };
    }
    return null;
}

// A recording of the canvas at its size, or null where no encoder can write
// an MP4. `failed` is called if the encoder stops partway.
async function captureOpenRecording(canvas, failed) {
    const choice = await captureChooseEncoder(canvas.width, canvas.height);
    if (!choice) return null;
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
        target,
        fastStart: 'in-memory',
        video: { codec: choice.muxerCodec, width: canvas.width, height: canvas.height,
                 frameRate: CAPTURE_FRAME_RATE },
    });
    const encoder = new VideoEncoder({
        output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
        error: failed,
    });
    encoder.configure(choice.config);
    return { encoder, muxer, target, frames: 0 };
}

// One video frame per animation frame, each stamped 1/60 s after the last,
// so a slow case plays back as smoothly as a fast one. Returns the count so
// far.
function captureAddFrame(recording, canvas) {
    const frameLength = 1e6 / CAPTURE_FRAME_RATE;
    const frame = new VideoFrame(canvas, {
        timestamp: Math.round(recording.frames * frameLength), duration: Math.round(frameLength),
    });
    recording.encoder.encode(frame, { keyFrame: recording.frames % CAPTURE_KEYFRAME_SPACING === 0 });
    frame.close();
    recording.frames++;
    return recording.frames;
}

// The finished MP4.
async function captureCloseRecording(recording) {
    await recording.encoder.flush();
    recording.encoder.close();
    recording.muxer.finalize();
    return new Blob([recording.target.buffer], { type: 'video/mp4' });
}
