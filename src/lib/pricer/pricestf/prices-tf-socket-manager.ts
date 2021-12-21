import ReconnectingWebSocket from 'reconnecting-websocket';
import WS from 'ws';
import * as Events from 'reconnecting-websocket/events';
import PricesTfApi from './prices-tf-api';

export default class PricesTfSocketManager {
    private readonly socketClass;

    constructor(private api: PricesTfApi) {
        // https://stackoverflow.com/questions/28784375/nested-es6-classes
        this.socketClass = class WebSocket extends WS {
            constructor(url, protocols) {
                super(url, protocols, {
                    headers: {
                        Authorization: 'Bearer ' + api.token
                    }
                });
            }
        };
    }

    private ws: ReconnectingWebSocket;

    private socketDisconnected() {
        return () => {
            console.debug('Disconnected from socket server');
        };
    }

    private socketConnect() {
        return () => {
            console.debug('Connected to socket server');
        };
    }

    init(): Promise<void> {
        return new Promise(resolve => {
            this.shutDown();
            this.ws = new ReconnectingWebSocket('wss://ws.prices.tf', [], {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                WebSocket: this.socketClass,
                maxEnqueuedMessages: 0,
                startClosed: true
            });

            this.ws.addEventListener('open', this.socketConnect());

            this.ws.addEventListener('error', err => {
                if (err.message === 'Unexpected server response: 401') {
                    console.log('JWT expired');
                    void this.api.setupToken().then(() => this.ws.reconnect());
                } else {
                    console.error(err.error);
                }
            });

            this.ws.addEventListener('close', this.socketDisconnected());

            return resolve();
        });
    }

    connect(): void {
        this.ws.reconnect();
    }

    shutDown(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = undefined;
        }
    }

    on<T extends keyof Events.WebSocketEventListenerMap>(name: T, handler: Events.WebSocketEventListenerMap[T]): void {
        this.ws.addEventListener(name, handler);
    }
}
