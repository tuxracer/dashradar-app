import { Observable } from "rxjs";
import { useEffect } from "react";
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

// Convert any color format (hex or HSL) to RGBA with alpha
export const colorToRGBA = (color: string, alpha: number): string => {
    // If it's already an HSL color, convert to HSLA
    if (color.startsWith('hsl(')) {
        // Extract hsl values: "hsl(180, 80%, 65%)" -> ["180", "80%", "65%"]
        const hslMatch = color.match(/hsl\((\d+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
        if (hslMatch) {
            const [, h, s, l] = hslMatch;
            return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
        }
    }

    // Otherwise assume it's hex and use hexToRGB
    return hexToRGB(color, alpha);
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

// Simple hash-based color generator (replaces randomcolor library)
const hashStringToColor = (str: string): string => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    const isDark = getIsDarkMode();

    // Generate HSL color for better control over brightness
    const hue = Math.abs(hash % 360);
    const saturation = isDark ? 70 + (Math.abs(hash) % 30) : 60 + (Math.abs(hash) % 40);
    const lightness = isDark ? 60 + (Math.abs(hash >> 8) % 20) : 45 + (Math.abs(hash >> 8) % 20);

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

export const getColor = memoizee(
    (seed: string) => {
        return hashStringToColor(seed + RANDOM_SEED_POSTFIX);
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
