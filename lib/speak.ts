import { throttle } from "lodash";
import memoizee from "memoizee";
import { DetectedObject } from "./tf";
import { vibrate } from "./utils";

export const speak = throttle((word: string) => {
    if (typeof speechSynthesis === "undefined") {
        console.warn("speaking not supported", word);
        return;
    }
    const speech = new SpeechSynthesisUtterance();
    speech.text = word;
    speech.lang = "en-US";
    speech.rate = 0.9;
    speechSynthesis.speak(speech);
}, 10_000);

const speakingBlocklist = ["car", "truck", "traffic light"];

export const speakItem = memoizee(
    (detectedObject: DetectedObject) => {
        // if (detectedObject.score < 0.7) return;
        if (speakingBlocklist.includes(detectedObject.class)) return;

        vibrate();
        speak(`${detectedObject.class} detected`);
    },
    {
        normalizer(args) {
            return args[0].class;
        },
        maxAge: 90_000,
    }
);
