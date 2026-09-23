import { authorize, type MembershipContext } from "../identity/authorization.js";
import type { Principal } from "../identity/oidc.js";
import {
  NotificationNotFoundError,
  NotificationService,
  NotificationValidationError,
  type Notification,
} from "./service.js";

export interface NotificationMembershipReader {
  getMembership(familyId: string, userId: string): Promise<MembershipContext | undefined>;
}

export interface NotificationHttpMeta {
  requestId: string;
  traceId: string;
  schemaVersion: "1.0";
}

export interface NotificationHttpSuccess<T> {
  data: T;
  meta: NotificationHttpMeta;
}

export class NotificationHttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "NotificationHttpError";
  }
}

export class NotificationController {
  private readonly notifications: NotificationService;
  private readonly memberships: NotificationMembershipReader;

  public constructor(notifications: NotificationService, memberships: NotificationMembershipReader) {
    this.notifications = notifications;
    this.memberships = memberships;
  }

  /** Backs `GET /api/v1/notifications?familyId=...`. Any active member may read. */
  public async list(
    principal: Principal | undefined,
    familyId: string,
    meta: NotificationHttpMeta,
  ): Promise<NotificationHttpSuccess<{ notifications: Notification[] }>> {
    if (principal === undefined)
      throw new NotificationHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertRead(principal, familyId);
    const notifications = await this.notifications.list(familyId);
    return success({ notifications }, meta);
  }

  /** Backs `POST /api/v1/notifications/{id}/read`. Any active member may mark read. */
  public async markRead(
    principal: Principal | undefined,
    familyId: string,
    id: string,
    meta: NotificationHttpMeta,
  ): Promise<NotificationHttpSuccess<Notification>> {
    if (principal === undefined)
      throw new NotificationHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertRead(principal, familyId);
    try {
      return success(await this.notifications.markRead(familyId, id), meta);
    } catch (error) {
      if (error instanceof NotificationNotFoundError)
        throw new NotificationHttpError(404, error.code, error.message);
      throw error;
    }
  }

  private async assertRead(principal: Principal, familyId: string): Promise<void> {
    const membership = await this.memberships.getMembership(familyId, principal.subject);
    const decision =
      membership === undefined
        ? authorize({ principal, action: "notifications.read", resourceFamilyId: familyId })
        : authorize({ principal, action: "notifications.read", resourceFamilyId: familyId, membership });
    if (!decision.allowed)
      throw new NotificationHttpError(
        decision.code === "NOT_FOUND_OR_NOT_VISIBLE" ? 404 : 403,
        decision.code,
        "Notifications are not visible.",
      );
  }
}

export function toNotificationHttpError(
  error: unknown,
  meta: NotificationHttpMeta,
): { status: number; body: { error: { code: string; message: string; retryable: boolean }; meta: NotificationHttpMeta } } {
  if (error instanceof NotificationHttpError)
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, retryable: error.retryable }, meta },
    };
  if (error instanceof NotificationValidationError)
    return {
      status: 422,
      body: { error: { code: error.code, message: "Notification input is invalid.", retryable: false }, meta },
    };
  return {
    status: 500,
    body: {
      error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", retryable: false },
      meta,
    },
  };
}

function success<T>(data: T, meta: NotificationHttpMeta): NotificationHttpSuccess<T> {
  return { data, meta };
}
