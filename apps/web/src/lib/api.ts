/** Base de l'API vue depuis le navigateur. En prod, même origine (chaîne vide). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
export const BASE_PATH = "/palacards";
export const API_BASE = `${API_URL}${BASE_PATH}/api`;
export const SOCKET_PATH = `${BASE_PATH}/socket.io`;
