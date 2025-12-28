import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addWebcamStreamToVideoEl, WebcamError } from "../lib/webcam";
import {
    DetectedObject,
    getDetectedObjects$,
    UNKNOWN_THRESHOLD,
} from "../lib/tf";
import {
    getColor,
    hexToRGB,
    colorToRGBA,
    reloadWindow,
    getIsDarkMode,
} from "../lib/utils";
import Head from "next/head";
import { speak, speakItem } from "../lib/speak";
import { debounce, throttle } from "lodash";
import { Loading } from "../components/Loading";

const CANVAS_TEXT_COLOR = getIsDarkMode() ? "#ffffff" : "#000000";

const emojiMap: Record<string, string> = {
    "": "",
    person: "",
    dog: "🐕",
    cat: "🐈",
    "parking meter": "🅿️",
    motorcycle: "🏍️",
    bicycle: "🚴",
    "traffic light": "🚦",
    "stop sign": "🛑",
};

// const getEmoji = memoizee((word: string) => {
//     return emojiMap[word] || emojiFromWord(word)?.emoji?.char || emojiMap[""];
// });

const getEmoji = (word: string = "") => {
    return emojiMap[word] || " ";
};

if (typeof window !== "undefined") {
    (window as any).getEmoji = getEmoji;
}

const speakThrottled = throttle((text: string) => {
    speak(text);
}, 2000);

speakThrottled("Loading please wait...");

/** @todo NEEDS REFACTOR into smaller separate components / custom hooks */

export const Home = () => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);

    const [loadingStatus, setLoadingStatus] = useState<string | null>(
        "Loading..."
    );
    const [errorStatus, setErrorStatus] = useState<string | null>(null);
    const [webcamError, setWebcamError] = useState<WebcamError | null>(null);

    const isLoading = loadingStatus !== null && errorStatus === null;
    const isError = errorStatus !== null || webcamError !== null;

    const [isVideoVisible, setIsVideoVisible] = useState(true);

    const getCanvasContext = useCallback(() => {
        if (!canvasContextRef.current && canvasRef.current) {
            canvasContextRef.current = canvasRef.current.getContext("2d");
        }
        return canvasContextRef.current;
    }, []);

    const clearCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = getCanvasContext();

        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, [getCanvasContext]);

    const renderDetections = useCallback(
        (predictions: DetectedObject[]) => {
            const ctx = getCanvasContext();

            if (!ctx) return;
            clearCanvas();
            // const font = "14px Iosevka";

            predictions.forEach((prediction) => {
                const x = Math.floor(prediction.bbox[0]);
                const y = Math.floor(prediction.bbox[1]);
                const width = Math.floor(prediction.bbox[2]);
                const height = Math.floor(prediction.bbox[3]);
                const area = width * height;

                // console.log("prediction.score", prediction.score);

                const confidence = Math.floor(prediction.score * 100) / 100;

                const emoji =
                    prediction.score > UNKNOWN_THRESHOLD
                        ? getEmoji(prediction.class)
                        : "";

                const centerLabel = emoji + prediction.id;

                const label = `${
                    prediction.score > UNKNOWN_THRESHOLD ? prediction.class : ""
                }`;

                const confidencePercentage = Math.floor(prediction.score * 100);
                const text = `${prediction.class} detected (${confidencePercentage}% confidence)`;

                // const statsLabel = "(" + confidence + "% confidence)";
                const statsLabel = prediction.id || "";

                // const weightedConfidence =
                //     prediction.score > 0.7 ? 0.8 : prediction.score * 0.6;

                const unknownColor = hexToRGB(CANVAS_TEXT_COLOR, 0.1);

                // Set the color
                const classColor =
                    prediction.score > UNKNOWN_THRESHOLD
                        ? colorToRGBA(
                              getColor(prediction.id || ""),
                              prediction.score / 2
                          )
                        : unknownColor;

                ctx.strokeStyle = classColor;
                ctx.fillStyle = classColor;

                // Draw the bounding box.
                // ctx.strokeStyle = "#2fff00";
                ctx.lineWidth = 2;
                ctx.fillRect(x, y, width, height);

                const fontSize = Math.max(Math.floor(Math.sqrt(area) / 10), 32);
                const font = `${fontSize}px sans-serif`;
                ctx.font = font;
                ctx.textBaseline = "top";

                const textWidth = ctx.measureText(label).width + 5;
                const textHeight = fontSize + 5;

                const centerLabelWidth = ctx.measureText(centerLabel).width + 5;
                const centerLabelHeight = fontSize + 5;

                const centerY = y + height / 2 + textHeight / 2;
                const centerX = x + width / 2;

                const textX = Math.round(
                    Math.max(0, x + width / 2 - textWidth / 2)
                );
                const textY = Math.round(Math.max(60, y - textHeight - 10));

                ctx.fillStyle = hexToRGB(CANVAS_TEXT_COLOR, prediction.score);

                if (prediction.score > UNKNOWN_THRESHOLD) {
                    ctx.fillText(label, textX, textY);

                    // const statsLabelFont = `${fontSize / 2}px sans-serif`;
                    // ctx.font = statsLabelFont;
                    // ctx.fillText(statsLabel, textX, textY + textHeight);
                }

                ctx.fillStyle =
                    prediction.score > UNKNOWN_THRESHOLD
                        ? colorToRGBA(getColor(prediction.id || ""), 1)
                        : hexToRGB(CANVAS_TEXT_COLOR, 0.3);
                // const centerLabelFont = `${fontSize}px sans-serif`;
                // ctx.font = centerLabelFont;
                ctx.fillText(
                    centerLabel,
                    // `${textX} x ${textY}`,
                    // `${fontSize}`,
                    Math.max(x, centerX - centerLabelWidth / 2),
                    Math.max(y, centerY - centerLabelHeight / 2)
                );
            });
        },
        [clearCanvas, getCanvasContext]
    );

    const [detectedObjects, setDetectedObjects] = useState<
        DetectedObject[] | null
    >(null);

    useEffect(() => {
        if (!detectedObjects) return;
        renderDetections(detectedObjects);
        detectedObjects.forEach(speakItem);
    }, [detectedObjects, renderDetections]);

    useEffect(() => {
        if (isLoading) return;
        setIsVideoVisible(false);
    }, [isLoading]);

    const [webcamAttachedVideoEl, setWebcamAttachedVideoEl] =
        useState<HTMLVideoElement | null>(null);

    const videoWidth = webcamAttachedVideoEl?.videoWidth;
    const videoHeight = webcamAttachedVideoEl?.videoHeight;

    const setVideoVisible = useMemo(
        () =>
            debounce(
                () => {
                    if (isLoading) return;
                    setIsVideoVisible(true);
                },
                1000,
                { leading: true, trailing: false }
            ),
        [isLoading]
    );

    const setVideoHidden = useMemo(
        () =>
            debounce(
                () => {
                    if (isLoading) return;
                    setIsVideoVisible(false);
                },
                1000,
                { leading: true, trailing: false }
            ),
        [isLoading]
    );

    const requestFullscreen = () => {
        try {
            const bodyEl = document.getElementsByTagName("body")?.[0] || null;
            if (bodyEl instanceof HTMLUnknownElement) return;
            bodyEl?.requestFullscreen?.();
        } catch (err) {
            console.warn(err);
        }
    };

    const canvasStyles: React.CSSProperties = { opacity: isLoading ? 0 : 1 };

    const videoStyles: React.CSSProperties = {
        opacity: isVideoVisible ? 0.2 : 0,
    };

    // const videoStyles: React.CSSProperties = {
    //     opacity: 1,
    // };

    useEffect(() => {
        if (!errorStatus) return;
        speakThrottled(errorStatus);
    }, [errorStatus]);

    useEffect(() => {
        if (!loadingStatus) return;
        speakThrottled(loadingStatus);
    }, [loadingStatus]);

    useEffect(() => {
        if (!webcamAttachedVideoEl) return;

        const { observable, cleanup } = getDetectedObjects$(webcamAttachedVideoEl);

        const subscription = observable.subscribe((detectedObjects) => {
            setDetectedObjects(detectedObjects);

            if (loadingStatus) {
                setLoadingStatus(null);
                setVideoHidden();
            }
        });

        return () => {
            subscription.unsubscribe();
            cleanup();
        };
    }, [webcamAttachedVideoEl, loadingStatus, setVideoHidden]);

    const initializeWebcam = useCallback(async () => {
        const videoEl = videoRef?.current;
        if (!videoEl) {
            console.warn("No video ref");
            return;
        }

        setWebcamError(null);
        setErrorStatus(null);
        setLoadingStatus("Initializing camera...");

        const result = await addWebcamStreamToVideoEl(videoEl);

        if (result.error) {
            setWebcamError(result.error);
            setLoadingStatus(null);
            speakThrottled(result.error.message);
            return;
        }

        if (!result.track) {
            setErrorStatus("Unable to access camera");
            setLoadingStatus(null);
            return;
        }

        result.track.addEventListener("ended", (e) => {
            console.error("track ended", e);
            setErrorStatus("Camera disconnected");
        });

        setWebcamAttachedVideoEl(videoEl);
    }, [videoRef]);

    useEffect(() => {
        initializeWebcam();
    }, [initializeWebcam]);

    useEffect(() => {
        setLoadingStatus("Waiting for sensor permission...");

        if (typeof window !== "undefined") {
            window.oncontextmenu = function (e) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            };
        }
    }, []);

    return (
        <>
            <Head>
                <link rel="me" href="https://fedi.ai/@derek" />
            </Head>
            {isLoading && <Loading />}
            {isError && (
                <div id="error">
                    <div className="error-message">
                        {webcamError ? webcamError.message : errorStatus}
                    </div>
                    <button onClick={initializeWebcam} className="retry-button">
                        Try Again
                    </button>
                    {webcamError?.type === 'permission_denied' && (
                        <div className="error-help">
                            Tip: Check your browser settings or system preferences to allow camera access
                        </div>
                    )}
                    {webcamError?.type === 'not_readable' && (
                        <div className="error-help">
                            Tip: Close other applications that might be using your camera
                        </div>
                    )}
                </div>
            )}
            <video
                id="video"
                autoPlay
                muted
                playsInline
                style={videoStyles}
                ref={videoRef}
                width={videoWidth}
                height={videoHeight}
            />
            <canvas
                id="canvas"
                style={canvasStyles}
                ref={canvasRef}
                width={videoWidth}
                height={videoHeight}
                onClick={requestFullscreen}
                onTouchStart={setVideoVisible}
                onTouchEnd={setVideoHidden}
            />
        </>
    );
};

export default Home;
