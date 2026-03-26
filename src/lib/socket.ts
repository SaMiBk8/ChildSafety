import { io } from "socket.io-client";

// In production, the socket connects to the same origin
const socket = io(window.location.origin);

export default socket;
