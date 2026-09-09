export type FamilyUnitSystem = "METRIC" | "IMPERIAL";
export type FamilyStatus = "ACTIVE" | "SUSPENDED" | "ERASED";

export interface CreateFamilyCommand {
  displayName: string;
  locale: string;
  timezone: string;
  unitSystem: FamilyUnitSystem;
  creatorUserId: string;
  traceId: string;
}

export interface Family {
  id: string;
  displayName: string;
  creatorUserId: string;
  locale: string;
  timezone: string;
  unitSystem: FamilyUnitSystem;
  status: FamilyStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FamilyMembership {
  id: string;
  familyId: string;
  userId: string;
  role: "OWNER";
  status: "ACTIVE";
  joinedAt: Date;
  version: number;
}

export interface FamilyCreatedEvent {
  eventId: string;
  eventType: "family.created";
  eventVersion: 1;
  aggregateType: "family";
  aggregateId: string;
  familyId: string;
  actorId: string;
  traceId: string;
  payload: {
    familyId: string;
    creatorMembershipId: string;
    locale: string;
    timezone: string;
  };
}

export interface FamilyAuditEvent {
  familyId: string;
  actorId: string;
  action: "family.created";
  resourceType: "family";
  resourceId: string;
  outcome: "SUCCESS";
  traceId: string;
}

export interface FamilyCreationResult {
  family: Family;
  membership: FamilyMembership;
  audit: FamilyAuditEvent;
  event: FamilyCreatedEvent;
}

export interface FamilyRepository {
  createFamilyAtomic(input: {
    family: Family;
    membership: FamilyMembership;
    audit: FamilyAuditEvent;
    event: FamilyCreatedEvent;
  }): Promise<FamilyCreationResult>;
}

export interface FamilyIdGenerator {
  next(): string;
}

export interface FamilyClock {
  now(): Date;
}

export class FamilyValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Family command is invalid: ${issues.join("; ")}`);
    this.name = "FamilyValidationError";
    this.issues = issues;
  }
}

export class FamilyService {
  private readonly repository: FamilyRepository;
  private readonly ids: FamilyIdGenerator;
  private readonly clock: FamilyClock;

  public constructor(repository: FamilyRepository, ids: FamilyIdGenerator, clock: FamilyClock) {
    this.repository = repository;
    this.ids = ids;
    this.clock = clock;
  }

  public async createFamily(command: CreateFamilyCommand): Promise<FamilyCreationResult> {
    const displayName = command.displayName.trim();
    const issues = validate(command, displayName);
    if (issues.length > 0) {
      throw new FamilyValidationError(issues);
    }

    const familyId = this.ids.next();
    const membershipId = this.ids.next();
    const eventId = this.ids.next();
    const now = this.clock.now();
    const family: Family = {
      id: familyId,
      displayName,
      creatorUserId: command.creatorUserId,
      locale: command.locale,
      timezone: command.timezone,
      unitSystem: command.unitSystem,
      status: "ACTIVE",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const membership: FamilyMembership = {
      id: membershipId,
      familyId,
      userId: command.creatorUserId,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: now,
      version: 1,
    };

    return this.repository.createFamilyAtomic({
      family,
      membership,
      audit: {
        familyId,
        actorId: command.creatorUserId,
        action: "family.created",
        resourceType: "family",
        resourceId: familyId,
        outcome: "SUCCESS",
        traceId: command.traceId,
      },
      event: {
        eventId,
        eventType: "family.created",
        eventVersion: 1,
        aggregateType: "family",
        aggregateId: familyId,
        familyId,
        actorId: command.creatorUserId,
        traceId: command.traceId,
        payload: {
          familyId,
          creatorMembershipId: membershipId,
          locale: command.locale,
          timezone: command.timezone,
        },
      },
    });
  }
}

function validate(command: CreateFamilyCommand, displayName: string): string[] {
  const issues: string[] = [];
  if (displayName.length < 1 || displayName.length > 120)
    issues.push("displayName must be 1-120 characters");
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(command.locale))
    issues.push("locale must be a valid locale");
  if (command.timezone.trim().length < 1 || command.timezone.length > 80)
    issues.push("timezone is invalid");
  if (command.unitSystem !== "METRIC" && command.unitSystem !== "IMPERIAL")
    issues.push("unitSystem is invalid");
  if (command.creatorUserId.trim().length < 1) issues.push("creatorUserId is required");
  if (command.traceId.trim().length < 16) issues.push("traceId is required");
  return issues;
}
