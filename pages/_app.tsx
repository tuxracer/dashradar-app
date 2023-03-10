import "../styles/globals.css";
import { useEffect } from "react";
import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import * as Fathom from "fathom-client";
import Head from "next/head";
import { MODEL_URLS } from "../lib/tf";

function MyApp({ Component, pageProps }: AppProps) {
    const router = useRouter();

    const handleRouteChangeComplete = () => {
        Fathom.trackPageview();
    };

    useEffect(() => {
        router.events.on("routeChangeComplete", handleRouteChangeComplete);

        return () => {
            router.events.off("routeChangeComplete", handleRouteChangeComplete);
        };
    }, [router]);

    useEffect(() => {
        Fathom.load("WRVHJZEF", {
            includedDomains: ["dashradar.app"],
            honorDNT: true,
            url: "https://enterprise.dashradar.app/script.js",
        });
    }, []);

    return (
        <>
            <Head>
                <title>Dashradar.app</title>
                <link
                    rel="shortcut icon"
                    href="/favicon.ico"
                    type="image/vnd.microsoft.icon"
                />
                <link
                    rel="icon"
                    type="image/png"
                    sizes="16x16"
                    href="/icons/icon-16x16.png"
                />
                <link
                    rel="icon"
                    type="image/png"
                    sizes="32x32"
                    href="/icons/icon-32x32.png"
                />
                <link
                    rel="icon"
                    type="image/png"
                    sizes="48x48"
                    href="/icons/icon-48x48.png"
                />

                <meta name="msapplication-tap-highlight" content="no" />
                <link rel="apple-touch-icon" href="/icons/icon-48x48.png" />
                <meta name="mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="theme-color" content="#000000" />

                <link rel="manifest" href="/manifest.json" />

                <meta
                    name="viewport"
                    content="minimum-scale=1, initial-scale=1, width=device-width, shrink-to-fit=no, viewport-fit=cover"
                />

                {MODEL_URLS.map((url) => (
                    <link rel="prefetch" href={url} key={url} />
                ))}
            </Head>
            <Component {...pageProps} />
        </>
    );
}

export default MyApp;
