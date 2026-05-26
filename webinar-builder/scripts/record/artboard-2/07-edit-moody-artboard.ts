/**
 * Artboard 2 — same-chat refinement.
 *
 * This segment must continue the existing assistant conversation from the
 * initial artboard. Do not click "New chat"; the viewer should see this as a
 * follow-up request in the same thread:
 *
 *   /artboard make the same film outdoor, darker, moodier, with greenery.
 *   Keep the same characters and keep each character in the same template
 *   garments. Do not swap outfits between people.
 *
 * The source wrapper currently reuses the verified same-thread artboard
 * recorder. When refreshing this capture, trim or record from the second
 * iteration only so the segment begins after the first artboard already
 * exists in the chat.
 */
export { default } from "../artboard/02b-brief-to-video.js";
