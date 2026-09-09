import {
  ResilientSearch,
  SearchProjection,
  type AuthoritativeSearch,
  type SearchProjectionEvent,
  type SearchResult,
} from "./index.js";

export interface ProjectionEventStore {
  listEvents(): Promise<readonly SearchProjectionEvent[]>;
  appendEvent(event: SearchProjectionEvent): Promise<void>;
}

export class SearchProjectionRuntime {
  private readonly projection: SearchProjection;
  private readonly events: ProjectionEventStore;
  private readonly resilient: ResilientSearch;

  public constructor(events: ProjectionEventStore, authoritative: AuthoritativeSearch) {
    this.projection = new SearchProjection();
    this.events = events;
    this.resilient = new ResilientSearch(this.projection, authoritative);
  }

  public async rebuild(): Promise<void> {
    this.projection.rebuild(await this.events.listEvents());
  }

  public async consume(event: SearchProjectionEvent): Promise<void> {
    await this.events.appendEvent(event);
    this.projection.apply(event);
  }

  public setAvailable(available: boolean): void {
    this.resilient.setProjectionAvailable(available);
  }

  public search(familyId: string, query: string): Promise<readonly SearchResult[]> {
    return this.resilient.search(familyId, query);
  }

  public lag(now: number): number | undefined {
    return this.projection.projectionLag(now);
  }
}
