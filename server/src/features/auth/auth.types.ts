export type MoltbookVerifyResponse =
  | { success?: boolean; valid: true; agent: { id: string; name: string; karma?: number; owner?: { x_handle?: string } } }
  | { success?: boolean; valid: false; error?: string; message?: string; hint?: string };

export type AuthContext = {
  moltbook: { token: string; agent: { id: string; name: string; karma?: number } };
};
