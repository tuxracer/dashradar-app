// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";

export type PingResponse = {
    pong: true;
};

const handler = (req: NextApiRequest, res: NextApiResponse<PingResponse>) => {
    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.status(200).json({ pong: true });
};

export default handler;
