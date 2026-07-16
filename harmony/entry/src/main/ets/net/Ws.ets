import { webSocket } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';

// WebSocket to the relay. Messages arrive as strings and are handed straight to
// onText. The caller owns reconnection; this wrapper only reports open/close.
export class Ws {
  private sock: webSocket.WebSocket | null = null;
  private closedByUs: boolean = false;

  constructor(
    private url: string,
    private onOpen: () => void,
    private onText: (text: string) => void,
    private onClosed: () => void
  ) {
  }

  connect(): void {
    this.closedByUs = false;
    const sock: webSocket.WebSocket = webSocket.createWebSocket();
    this.sock = sock;

    sock.on('open', (err: BusinessError, value: Object) => {
      if (!this.closedByUs) {
        this.onOpen();
      }
    });

    sock.on('message', (err: BusinessError, value: string | ArrayBuffer) => {
      if (typeof value === 'string') {
        this.onText(value as string);
      }
    });

    sock.on('close', (err: BusinessError, value: Object) => {
      if (!this.closedByUs) {
        this.onClosed();
      }
    });

    sock.on('error', (err: BusinessError) => {
      if (!this.closedByUs) {
        this.onClosed();
      }
    });

    sock.connect(this.url, (err: BusinessError, ok: boolean) => {
      if (err && !this.closedByUs) {
        this.onClosed();
      }
    });
  }

  send(text: string): void {
    const sock: webSocket.WebSocket | null = this.sock;
    if (sock === null) {
      return;
    }
    sock.send(text, (err: BusinessError, ok: boolean) => {
      // fire-and-forget; a failed send surfaces via the close/error handler
    });
  }

  close(): void {
    this.closedByUs = true;
    const sock: webSocket.WebSocket | null = this.sock;
    if (sock !== null) {
      try {
        sock.off('message');
        sock.off('open');
        sock.off('close');
        sock.off('error');
        sock.close();
      } catch (e) {
        // ignore
      }
    }
    this.sock = null;
  }
}
