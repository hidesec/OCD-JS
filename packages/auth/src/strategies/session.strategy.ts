import { randomUUID } from "node:crypto";
import { Injectable } from "@ocd-js/core";
import { AuthenticatedUser, AuthStrategy } from "../interfaces";

interface SessionState {
  user: AuthenticatedUser;
  expiresAt: number;
}

@Injectable()
export class SessionStrategy implements AuthStrategy {
  private readonly sessions = new Map<string, SessionState>();

  createSession(user: AuthenticatedUser, ttlSeconds = 3600): string {
    const id = randomUUID();
    this.sessions.set(id, { user, expiresAt: Date.now() + ttlSeconds * 1000 });
    return id;
  }

  authenticate(sessionId: string): AuthenticatedUser | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session.user;
  }
}
