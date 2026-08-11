// Home and the new-thread route are one start surface. Re-exporting the same
// component keeps their layout, states, and interaction model from drifting.

export { ChatStartPage as HomePage } from "./chat/start-page";
