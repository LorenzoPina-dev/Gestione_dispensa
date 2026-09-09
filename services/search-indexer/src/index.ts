export interface SearchDocument {
  readonly id: string;
  readonly familyId: string;
  readonly type: "PRODUCT" | "INVENTORY" | "SHOPPING";
  readonly text: string;
  readonly updatedAt: string;
  readonly sourceVersion: number;
}

export interface SearchProjectionEvent {
  readonly eventId: string;
  readonly familyId: string;
  readonly document: SearchDocument;
  readonly occurredAt: string;
}

export interface SearchResult {
  readonly document: SearchDocument;
  readonly score: number;
}

export interface AuthoritativeSearch {
  search(familyId: string, query: string): Promise<readonly SearchResult[]>;
}

export class SearchProjection {
  private readonly documents = new Map<string, SearchDocument>();
  private lastEventAt: number | undefined;

  public apply(event: SearchProjectionEvent): void {
    if (event.document.familyId !== event.familyId) {
      throw new Error("Search event family scope does not match its document.");
    }
    const current = this.documents.get(key(event.familyId, event.document.id));
    if (current !== undefined && current.sourceVersion >= event.document.sourceVersion) {
      return;
    }
    this.documents.set(key(event.familyId, event.document.id), event.document);
    this.lastEventAt = Date.parse(event.occurredAt);
  }

  public rebuild(events: readonly SearchProjectionEvent[]): void {
    this.documents.clear();
    this.lastEventAt = undefined;
    for (const event of [...events].sort((left, right) =>
      left.eventId.localeCompare(right.eventId),
    )) {
      this.apply(event);
    }
  }

  public search(familyId: string, query: string): readonly SearchResult[] {
    const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
    if (!familyId.trim() || !normalizedQuery) return [];
    return [...this.documents.values()]
      .filter(
        (document) =>
          document.familyId === familyId &&
          document.text.toLocaleLowerCase("en-US").includes(normalizedQuery),
      )
      .map((document) => ({
        document,
        score: document.text.length === normalizedQuery.length ? 1 : 0.5,
      }))
      .sort(
        (left, right) =>
          right.score - left.score || left.document.id.localeCompare(right.document.id),
      );
  }

  public projectionLag(now: number): number | undefined {
    return this.lastEventAt === undefined ? undefined : Math.max(0, now - this.lastEventAt);
  }
}

export class ResilientSearch {
  private readonly projection: SearchProjection;
  private readonly authoritative: AuthoritativeSearch;
  private projectionAvailable = true;

  public constructor(projection: SearchProjection, authoritative: AuthoritativeSearch) {
    this.projection = projection;
    this.authoritative = authoritative;
  }

  public setProjectionAvailable(available: boolean): void {
    this.projectionAvailable = available;
  }

  public async search(familyId: string, query: string): Promise<readonly SearchResult[]> {
    if (!this.projectionAvailable) {
      return this.authoritative.search(familyId, query);
    }
    return this.projection.search(familyId, query);
  }
}

function key(familyId: string, documentId: string): string {
  return `${familyId}:${documentId}`;
}
