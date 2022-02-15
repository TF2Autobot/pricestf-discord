import Currencies from '@tf2autobot/tf2-currencies';
import PricesTfSocketManager from './prices-tf-socket-manager';
import IPricer, {
    GetItemPriceResponse,
    GetPricelistResponse,
    Item,
    PricerOptions,
    RequestCheckResponse
} from '../../../classes/IPricer';
import PricesTfApi, { PricesTfItem, PricesTfItemMessageEvent } from './prices-tf-api';
import log from '../../logger';

export default class PricesTfPricer implements IPricer {
    private socketManager: PricesTfSocketManager;

    public constructor(private api: PricesTfApi) {
        this.socketManager = new PricesTfSocketManager(api);
    }

    getOptions(): PricerOptions {
        return this.api.getOptions();
    }

    async getPrice(sku: string): Promise<GetItemPriceResponse> {
        const response = await this.api.getPrice(sku);
        return this.parsePrices2Item(response);
    }

    async getPricelist(): Promise<GetPricelistResponse> {
        try {
            const pricelist = await PricesTfApi.apiRequest(
                'GET',
                '/json/pricelist-array',
                {},
                {},
                'https://autobot.tf'
            );

            return pricelist;
        } catch (err) {
            log.error('Failed to get pricelist from autobot.tf: ', err);
        }

        // If failed, get from prices.tf
        let prices: PricesTfItem[] = [];
        let currentPage = 1;
        let totalPages = 0;

        let delay = 0;
        const minDelay = 200;

        do {
            await new Promise(resolve => setTimeout(resolve, delay));
            const start = new Date().getTime();
            log.debug('Getting page ' + currentPage.toString() + ' of ' + totalPages.toString());
            const response = await this.api.getPricelistPage(currentPage);
            currentPage++;
            totalPages = response.meta.totalPages;
            prices = prices.concat(response.items);
            const time = new Date().getTime() - start;

            delay = Math.max(0, minDelay - time);
        } while (currentPage < totalPages);

        const parsed: Item[] = prices.map(v => this.parseItem(this.parsePrices2Item(v)));
        return { items: parsed };
    }

    async requestCheck(sku: string): Promise<RequestCheckResponse> {
        const r = await this.api.requestCheck(sku);
        if (r.enqueued) {
            return {
                sku: sku
            };
        } else {
            return {
                sku: null
            };
        }
    }

    shutdown(): void {
        this.socketManager.shutDown();
    }

    connect(): void {
        this.socketManager.connect();
    }

    init(): Promise<void> {
        return this.socketManager.init();
    }

    parsePricesTfMessageEvent(raw: string): PricesTfItemMessageEvent {
        return JSON.parse(raw) as PricesTfItemMessageEvent;
    }

    parsePrices2Item(item: PricesTfItem): GetItemPriceResponse {
        return {
            sku: item.sku,
            buy: new Currencies({
                keys: item.buyKeys,
                metal: Currencies.toRefined(item.buyHalfScrap / 2)
            }),
            sell: new Currencies({
                keys: item.sellKeys,
                metal: Currencies.toRefined(item.sellHalfScrap / 2)
            }),
            source: 'bptf',
            time: Math.floor(new Date(item.updatedAt).getTime() / 1000)
        };
    }

    parseItem(r: GetItemPriceResponse): Item {
        return {
            buy: r.buy,
            sell: r.sell,
            sku: r.sku,
            source: r.source,
            time: r.time
        };
    }

    parsePriceUpdatedData(e: PricesTfItemMessageEvent): Item {
        return this.parseItem(this.parsePrices2Item(e.data));
    }

    bindHandlePriceEvent(onPriceChange: (item: GetItemPriceResponse) => void): void {
        this.socketManager.on('message', (message: MessageEvent) => {
            try {
                const data = this.parsePricesTfMessageEvent(message.data);
                if (data.type === 'AUTH_REQUIRED') {
                    // might be nicer to put this elsewhere

                    log.debug('prices.tf re-authorization required');
                    void this.api.setupToken().then(() => {
                        this.socketManager.send(
                            JSON.stringify({
                                type: 'AUTH',
                                data: {
                                    accessToken: this.api.token
                                }
                            })
                        );
                    });
                } else if (data.type === 'PRICE_UPDATED') {
                    const item = this.parsePriceUpdatedData(data);
                    onPriceChange(item);
                }
            } catch (e) {
                log.error(e as Error);
            }
        });
    }
}
