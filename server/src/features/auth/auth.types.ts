export type MoltbookVerifyResponse =
  | { valid: true; agent: { id: string; name: string; karma?: number; owner?: { x_handle?: string } } }
  | { valid: false; error: string };

export type AuthContext = {
  moltbook: { token: string; agent: { id: string; name: string; karma?: number } };
};

