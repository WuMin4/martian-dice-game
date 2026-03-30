import { io } from "socket.io-client";

// In development, connect to the same host. In production, it will be the same origin.
const URL = process.env.NODE_ENV === "production" ? undefined : "/";

export const socket = io(URL as string, {
  autoConnect: false,
});
