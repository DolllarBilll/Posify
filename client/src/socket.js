import { io } from 'socket.io-client';

// Connects to your backend server on port 5000
export const API_URL = `http://${window.location.hostname}:5000`;
export const socket = io(API_URL);