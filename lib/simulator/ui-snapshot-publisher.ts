export type SnapshotPublicationScheduler = {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
};

export type SnapshotPublisher<T extends { status: string }> = (snapshot: T, lowPriority: boolean) => void;

const RUNNING_UI_REFRESH_MS = 33;
const NAVIGATION_UI_REFRESH_MS = 100;

const browserScheduler: SnapshotPublicationScheduler = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (id) => window.clearTimeout(id),
};

/** Coalesces simulator frames before they trigger expensive editor-wide renders. */
export class LatestSimulatorSnapshotPublisher<T extends { status: string }> {
  private latest: T;
  private lastPublished: T;
  private lastPublishedAt: number;
  private timeoutId: number | null = null;
  private navigating = false;
  private disposed = false;

  constructor(
    initial: T,
    private readonly publish: SnapshotPublisher<T>,
    private readonly scheduler: SnapshotPublicationScheduler = browserScheduler,
  ) {
    this.latest = initial;
    this.lastPublished = initial;
    this.lastPublishedAt = scheduler.now();
  }

  receive = (snapshot: T) => {
    if (this.disposed) return;
    this.latest = snapshot;

    // Controls and stopped-state diagnostics should never wait for the running
    // simulation's visual refresh budget.
    if (snapshot.status !== this.lastPublished.status || snapshot.status !== "running") {
      this.flush(false);
      return;
    }
    this.schedule();
  };

  setNavigating = (navigating: boolean) => {
    if (this.disposed || this.navigating === navigating) return;
    this.navigating = navigating;
    if (navigating) this.schedule(true);
    else this.flush(false);
  };

  dispose = () => {
    this.disposed = true;
    this.cancelScheduled();
  };

  private schedule(replacePending = false) {
    if (this.latest.status !== "running") return;
    if (this.timeoutId !== null) {
      if (!replacePending) return;
      this.cancelScheduled();
    }

    const interval = this.navigating ? NAVIGATION_UI_REFRESH_MS : RUNNING_UI_REFRESH_MS;
    const delay = interval - (this.scheduler.now() - this.lastPublishedAt);
    if (delay <= 0) {
      this.flush(true);
      return;
    }

    this.timeoutId = this.scheduler.setTimeout(() => {
      this.timeoutId = null;
      this.flush(true);
    }, delay);
  }

  private flush(lowPriority: boolean) {
    this.cancelScheduled();
    if (this.latest === this.lastPublished) return;
    this.lastPublished = this.latest;
    this.lastPublishedAt = this.scheduler.now();
    this.publish(this.latest, lowPriority);
  }

  private cancelScheduled() {
    if (this.timeoutId === null) return;
    this.scheduler.clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }
}
