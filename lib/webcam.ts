import { isEmpty, once } from "lodash";
import { reloadWindowDelayed } from "./utils";

const CAMERA_DESIRED_FACING_MODE = "environment";
const CAMERA_DESIRED_AUDIO = false;
// const CAMERA_DESIRED_DEVICE_ID =
//     "4534c3c92f1b3dd787cc4a19daeb7586dc4bbd87711e22a15ebfc482bb898b42";

const DEFAULT_CAMERA_VIDEO_TRACK_CONSTRAINTS: MediaTrackConstraintSet = {
    // ["focusMode" as any]: "manual",
    // ["focusDistance" as any]: 30,
};

const DEFAULT_MEDIA_STREAM_CONSTRAINTS: MediaStreamConstraints = {
    video: {
        pan: true,
        tilt: true,
        brightness: true,
        focusMode: true,
        zoom: true,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        // height: { ideal: 2160 },
        // width: { ideal: 3840 },
        facingMode: CAMERA_DESIRED_FACING_MODE,
        // deviceId: CAMERA_DESIRED_DEVICE_ID,
    } as any,
    audio: CAMERA_DESIRED_AUDIO,
};

export const getMediaStream = once(
    (
        mediaStreamConstraints: MediaStreamConstraints = DEFAULT_MEDIA_STREAM_CONSTRAINTS
    ) => {
        return navigator.mediaDevices.getUserMedia(mediaStreamConstraints);
    }
);

export const applyConstraintsToStream = async (
    stream: MediaStream,
    constraints: MediaTrackConstraintSet = DEFAULT_CAMERA_VIDEO_TRACK_CONSTRAINTS
) => {
    const track = stream.getVideoTracks()[0];
    if (!isEmpty(constraints)) {
        await track.applyConstraints({
            advanced: [constraints],
        });
    }
    return track;
};

export const addMediaStreamToVideoEl = async (
    videoEl: HTMLVideoElement,
    stream: MediaStream
) => {
    videoEl.srcObject = stream;
    return new Promise<MediaStream>((resolve) => {
        videoEl.onloadedmetadata = () => {
            resolve(stream);
        };
    });
};

export interface WebcamError {
    type: 'permission_denied' | 'not_found' | 'not_readable' | 'overconstrained' | 'unknown';
    message: string;
    originalError: any;
}

const getWebcamError = (err: any): WebcamError => {
    const errorName = err?.name || '';

    if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        return {
            type: 'permission_denied',
            message: 'Camera permission denied. Please allow camera access and try again.',
            originalError: err,
        };
    }

    if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        return {
            type: 'not_found',
            message: 'No camera found. Please connect a camera and try again.',
            originalError: err,
        };
    }

    if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
        return {
            type: 'not_readable',
            message: 'Camera is already in use by another application. Please close other apps and try again.',
            originalError: err,
        };
    }

    if (errorName === 'OverconstrainedError' || errorName === 'ConstraintNotSatisfiedError') {
        return {
            type: 'overconstrained',
            message: 'Camera does not support the required settings. Trying with basic settings...',
            originalError: err,
        };
    }

    return {
        type: 'unknown',
        message: 'Unable to access camera. Please check your camera and try again.',
        originalError: err,
    };
};

export const addWebcamStreamToVideoEl = async (videoEl: HTMLVideoElement) => {
    try {
        const stream = await getMediaStream();
        const track = await applyConstraintsToStream(stream);
        track.onended = () => {
            console.error("Media track ended", track);
        };
        await addMediaStreamToVideoEl(videoEl, stream);
        return { track, error: null };
    } catch (err) {
        console.warn("Unable to add webcam stream to video element", err);
        const webcamError = getWebcamError(err);
        return { track: null, error: webcamError };
    }
};
