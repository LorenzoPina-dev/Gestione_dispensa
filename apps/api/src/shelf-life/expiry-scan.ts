import type { ShelfLifeEstimationService, StorageKind } from "./service.js";

export interface ExpiringLot {
  readonly lotId: string;
  readonly familyId: string;
  readonly productName: string;
  readonly category: string | undefined;
  readonly storageKind: StorageKind;
  readonly quantity: number;
  readonly unit: string;
  readonly expiresAt: Date;
}

export interface ExpiryScanRepository {
  /** Active lots with a known, not-yet-notified expires_at within a wide lookahead window. */
  findCandidateLots(now: Date, horizonDays: number): Promise<readonly ExpiringLot[]>;
  markNotified(lotId: string, notifiedAt: Date): Promise<void>;
}

export interface ExpiryNotifier {
  notifyExpiringStock(input: {
    familyId: string;
    productName: string;
    quantity: number;
    unit: string;
    expiresAt: Date;
  }): Promise<void>;
}

export interface ExpiryScanResult {
  scanned: number;
  notified: number;
}

/**
 * Backs the EXPIRY_SCAN task placeholder already declared in
 * services/scheduler/src/scheduler.ts (TASK_TYPES). Wired here as a directly callable service
 * (see server.ts) rather than through the full distributed Scheduler/SchedulerRepository
 * machinery, which adds Postgres-backed cross-instance locking -- worth adopting once this API
 * runs more than one replica, but not required for a single instance to notify families
 * reliably today. A future composition root can drop this same `scan` method straight into a
 * `SchedulerTask` for TASK_TYPES.EXPIRY_SCAN without changing anything here.
 *
 * Pulls a wide window of candidates (`horizonDays`, default 30) and filters in application code
 * because how many days before expiry to warn varies per category (via
 * ShelfLifeEstimationService.notifyDaysBefore), which isn't practical to express in a single SQL
 * WHERE clause.
 */
export class ExpiryScanService {
  private readonly repository: ExpiryScanRepository;
  private readonly shelfLife: ShelfLifeEstimationService;
  private readonly notifier: ExpiryNotifier;
  private readonly horizonDays: number;

  public constructor(
    repository: ExpiryScanRepository,
    shelfLife: ShelfLifeEstimationService,
    notifier: ExpiryNotifier,
    horizonDays = 30,
  ) {
    this.repository = repository;
    this.shelfLife = shelfLife;
    this.notifier = notifier;
    this.horizonDays = horizonDays;
  }

  public async scan(now: Date = new Date()): Promise<ExpiryScanResult> {
    const candidates = await this.repository.findCandidateLots(now, this.horizonDays);
    let notified = 0;
    for (const lot of candidates) {
      const notifyDaysBefore = await this.shelfLife.notifyDaysBefore({
        category: lot.category,
        storageKind: lot.storageKind,
      });
      const daysUntilExpiry = Math.ceil(
        (lot.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (daysUntilExpiry > notifyDaysBefore) continue;

      await this.notifier.notifyExpiringStock({
        familyId: lot.familyId,
        productName: lot.productName,
        quantity: lot.quantity,
        unit: lot.unit,
        expiresAt: lot.expiresAt,
      });
      await this.repository.markNotified(lot.lotId, now);
      notified += 1;
    }
    return { scanned: candidates.length, notified };
  }
}
