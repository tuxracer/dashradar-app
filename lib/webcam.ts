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

export const addWebcamStreamToVideoEl = async (videoEl: HTMLVideoElement) => {
    try {
        const stream = await getMediaStream();
        const track = await applyConstraintsToStream(stream);
        track.onended = () => {
            console.error("Media track error", track);
            reloadWindowDelayed();
        };
        await addMediaStreamToVideoEl(videoEl, stream);
        return track;
    } catch (err) {
        console.warn("Unable to add webcam stream to video element", err);
        reloadWindowDelayed();
        return null;
    }
};
