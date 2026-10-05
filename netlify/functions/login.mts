import { generateToken, authResponse } from './auth-utils.mts';

export default async function handler(event: any) {
  if (event.httpMethod !== 'POST') {
    return authResponse(405, 'Method not allowed');
  }

  try {
    const { user, password } = JSON.parse(event.body || '{}');

    const ADMIN_USER = process.env.ADMIN_USER || 'rodrigo';
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'PrimeCorp@2024';

    if (user === ADMIN_USER && password === ADMIN_PASSWORD) {
      const token = generateToken(user);
      return authResponse(200, 'Login successful', { token, user });
    }

    return authResponse(401, 'Invalid credentials');
  } catch (error) {
    return authResponse(500, 'Server error');
  }
}
