import { Observable } from "rxjs";
import { useEffect } from "react";
import randomColor from "randomcolor";
import memoizee from "memoizee";
import { once, throttle } from "lodash";

export const getIsDarkMode = () => {
    if (typeof window === "undefined") return false;

    return (
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
    );
};

export const hexToRGB = (hex: string, alpha: number) => {
    var r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);

    if (alpha) {
        return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
    } else {
        return "rgb(" + r + ", " + g + ", " + b + ")";
    }
};

export const useObservable = <T>(
    observable: Observable<T>,
    setter: (value: T) => void
) => {
    useEffect(() => {
        const subscription = observable.subscribe(setter);
        return () => subscription.unsubscribe();
    }, [observable, setter]);
};

const RANDOM_SEED_POSTFIX = Math.random();

export const getColor = memoizee(
    (seed: string) => {
        // const predefinedColor = DETECTION_COLOR_MAP[id];
        // if (predefinedColor) return predefinedColor;

        const luminosity = getIsDarkMode() ? "bright" : "random";

        return randomColor({
            seed: seed + RANDOM_SEED_POSTFIX,
            luminosity,
            hue: "random",
        });
    },
    { max: 20 }
);

export const vibrate = throttle((vibrateTimeMs = 100) => {
    try {
        window.navigator.vibrate(vibrateTimeMs);
    } catch (e) {
        console.warn("vibrate not supported");
    }
}, 10_000);

export const reloadWindow = once(() => {
    window.location.reload();
});

export const reloadWindowDelayed = once((delay = 5_000) => {
    return setTimeout(reloadWindow, delay);
});
