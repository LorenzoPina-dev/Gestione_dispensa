export type NotificationCategory = "REORDER" | "INVITE" | "SYSTEM";

export interface Notification {
  id: string;
  familyId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  readAt: Date | undefined;
  createdAt: Date;
}

export interface CreateNotificationCommand {
  familyId: string;
  category: NotificationCategory;
  title: string;
  body: string;
}

export interface NotificationRepository {
  createAtomic(input: CreateNotificationCommand & { id: string; createdAt: Date }): Promise<Notification>;
  listByFamily(familyId: string): Promise<Notification[]>;
  markReadAtomic(input: { familyId: string; id: string; readAt: Date }): Promise<Notification | undefined>;
}

export interface NotificationIdGenerator {
  next(): string;
}

export class NotificationValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";

  public constructor(issues: readonly string[]) {
    super(`Notification command is invalid: ${issues.join("; ")}`);
    this.name = "NotificationValidationError";
  }
}

export class NotificationNotFoundError extends Error {
  public readonly code = "NOT_FOUND_OR_NOT_VISIBLE";

  public constructor() {
    super("Notification is not visible.");
    this.name = "NotificationNotFoundError";
  }
}

/**
 * Notification *delivery* only — listing and marking read. There is deliberately no generic
 * "generate a notification for any reason" trigger system here: today the only producer wired
 * up is `NotificationService.notifyLowStock`, called from InventoryService when a movement
 * leaves a stock item at or below its reorder point (see inventory/service.ts). Extending this
 * to other triggers (invite accepted, shopping list shared, ...) means adding more explicit
 * calls at the point the event happens, the same way — not a generic event bus.
 */
export class NotificationService {
  private readonly repository: NotificationRepository;
  private readonly ids: NotificationIdGenerator;

  public constructor(repository: NotificationRepository, ids: NotificationIdGenerator) {
    this.repository = repository;
    this.ids = ids;
  }

  public async create(command: CreateNotificationCommand): Promise<Notification> {
    const issues: string[] = [];
    if (!command.familyId.trim()) issues.push("familyId is required");
    if (!command.title.trim() || command.title.length > 200) issues.push("title is invalid");
    if (!command.body.trim() || command.body.length > 2000) issues.push("body is invalid");
    if (issues.length > 0) throw new NotificationValidationError(issues);
    return this.repository.createAtomic({ ...command, id: this.ids.next(), createdAt: new Date() });
  }

  public async list(familyId: string): Promise<Notification[]> {
    if (!familyId.trim()) throw new NotificationValidationError(["familyId is required"]);
    return this.repository.listByFamily(familyId);
  }

  public async markRead(familyId: string, id: string): Promise<Notification> {
    const updated = await this.repository.markReadAtomic({ familyId, id, readAt: new Date() });
    if (updated === undefined) throw new NotificationNotFoundError();
    return updated;
  }

  /** Called by InventoryService after a movement drops a stock item to/below its reorder point. */
  public async notifyLowStock(input: {
    familyId: string;
    productName: string;
    quantity: number;
    unit: string;
    reorderPoint: number;
  }): Promise<void> {
    await this.create({
      familyId: input.familyId,
      category: "REORDER",
      title: `Scorte basse: ${input.productName}`,
      body: `Hai ${input.quantity} ${input.unit}. Soglia minima: ${input.reorderPoint} ${input.unit}.`,
    });
  }
}
