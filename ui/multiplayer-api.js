const SESSION_KEY = "breachline.multiplayerSession";

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `서버 오류 (${response.status})`);
  return data;
}

export const listRooms = async () => (await request("/api/rooms")).rooms;

export async function createOnlineRoom(input) {
  const result = await request("/api/rooms", { method: "POST", body: JSON.stringify(input) });
  saveSession(result.room.id, result.token, result.playerId);
  return result.room;
}

export async function joinOnlineRoom(roomId, input) {
  const result = await request(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  saveSession(roomId, result.token, result.playerId);
  return result.room;
}

export function saveSession(roomId, token, playerId) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomId, token, playerId }));
}

export function getSession(roomId = null) {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (!value?.token || (roomId && value.roomId !== roomId)) return null;
    return value;
  } catch {
    return null;
  }
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export async function getOnlineRoom(roomId) {
  const session = getSession(roomId);
  if (!session) throw new Error("이 방의 참가 인증 정보가 없습니다.");
  return request(`/api/rooms/${encodeURIComponent(roomId)}?token=${encodeURIComponent(session.token)}`);
}

export function connectRoom(roomId, handlers = {}) {
  const session = getSession(roomId);
  if (!session) throw new Error("이 방의 참가 인증 정보가 없습니다.");
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${scheme}//${location.host}/api/rooms/${encodeURIComponent(roomId)}/ws?token=${encodeURIComponent(session.token)}`;
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => handlers.open?.(socket));
  socket.addEventListener("message", (event) => {
    try { handlers.message?.(JSON.parse(event.data), socket); } catch (error) { handlers.error?.(error); }
  });
  socket.addEventListener("close", (event) => handlers.close?.(event));
  socket.addEventListener("error", (event) => handlers.error?.(event));
  return socket;
}

export function sendAction(socket, action, value = null) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ type: "action", action, value }));
  return true;
}
