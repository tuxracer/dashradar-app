/**
 * Horizontal position of a contact relative to the camera view, in thirds of
 * the frame. The rear camera faces forward out the windshield and the feed is
 * unmirrored, so image-left is the driver's left.
 */
export type ContactDirection = "left" | "ahead" | "right";
