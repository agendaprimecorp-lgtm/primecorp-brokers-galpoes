import { Buffer } from 'buffer';

export function generateToken(user: string): string {
  return Buffer.from(`${user}:${Date.now()}`).toString('base64');
}

export function validateToken(token: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    return decoded.includes(':');
  } catch {
    return false;
  }
}

export function requireAuth(headers: Record<string, string>): boolean {
  const auth = headers['authorization'] || headers['Authorization'];
  if (!auth) return false;
  const token = auth.replace('Bearer ', '');
  return validateToken(token);
}

export function authResponse(status: number, message: string, data?: any) {
  return {
    statusCode: status,
    body: JSON.stringify({ success: status === 200, message, ...data }),
    headers: { 'Content-Type': 'application/json' }
  };
}
