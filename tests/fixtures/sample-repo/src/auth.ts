/**
 * 认证域（高风险矩阵夹具：Authentication 规则锚定对象）。
 */

export interface Session {
  userId: string;
  expiresAt: number;
}

export class AuthRepository {
  login(userId: string): Session {
    return { userId, expiresAt: Date.now() + 3600_000 };
  }

  validateSession(session: Session): boolean {
    return session.expiresAt > Date.now();
  }
}
