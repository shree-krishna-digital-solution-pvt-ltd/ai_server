// In-memory event hub for SSE real-time log distribution

export type LogListener<T = unknown> = (data: T) => void;

class EventHub<T = unknown> {
  private listeners: Set<LogListener<T>> = new Set();

  subscribe(listener: LogListener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(data: T): void {
    for (const listener of this.listeners) {
      try {
        listener(data);
      } catch (err) {
        console.error("Error dispatching log event to subscriber:", err);
      }
    }
  }

  subscriberCount(): number {
    return this.listeners.size;
  }
}

export const logEvents = new EventHub<unknown>();
