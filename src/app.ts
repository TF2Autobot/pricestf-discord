const { version: BOT_VERSION } = require('../package.json');
process.env.BOT_VERSION = BOT_VERSION as string;

import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

import SocketManager from './classes/SocketManager';
import { Pricelist, PriceUpdateQueue } from './classes/Webhook';
import SchemaManager from '@tf2autobot/tf2-schema';
import PricerApi, { GetItemPriceResponse, Pricer } from './classes/Pricer';

interface Currency {
    keys: number;
    metal: number;
}

interface Prices {
    buy: Currency;
    sell: Currency;
}

const socketManger = new SocketManager('https://api.prices.tf');
const schemaManager = new SchemaManager({ apiKey: process.env.STEAM_API_KEY });
const pricer = new PricerApi();
// const datas: { sku: string; name: string; prices: Prices; time: number }[] = [];

const urls = JSON.parse(process.env.MAIN_WEBHOOK_URL) as string[];
PriceUpdateQueue.setURL(urls);

schemaManager.init(err => {
    if (err) {
        console.warn('Fail to get schema');
        process.exit(1);
    }

    const pricelist = new Pricelist(schemaManager.schema);

    console.log('Getting pricelist from prices.tf...');

    pricer.getPricelist('bptf').then(pricestfPricelist => {
        pricelist.setPricelist(pricestfPricelist.items);

        console.log('Initiating socket to prices.tf...');

        socketManger.init().then(() => {
            socketManger.on('price', (data: GetItemPriceResponse) => {
                console.log('Data receieved for: ', { sku: data.sku });

                if (data.sku === '5021;6') {
                    pricelist.sendWebhookKeyUpdate({
                        sku: data.sku,
                        name: data.name,
                        prices: { buy: data.buy, sell: data.sell },
                        time: data.time
                    });
                }

                if (data.buy !== null) {
                    pricelist.sendWebHookPriceUpdateV1({
                        sku: data.sku,
                        name: data.name,
                        prices: { buy: data.buy, sell: data.sell },
                        time: data.time
                    });

                    // datas.push({
                    //     sku: data.sku,
                    //     name: data.name,
                    //     prices: { buy: data.buy, sell: data.sell },
                    //     time: data.time
                    // });

                    // if (datas.length > 2) {
                    //     pricelist.sendWebHookPriceUpdateV2(datas);
                    //     datas.length = 0;
                    // }
                }
            });

            if (process.env.ENABLE_PRICECHECK === 'true') {
                const pricecheck = new Pricecheck(pricer);

                console.log('Getting overall items from prices.tf...');

                pricer
                    .getOverall()
                    .then(overall => {
                        pricecheck.setSkusToCheck(overall);
                        pricecheck.startPriceCheck();
                    })
                    .catch(err => {
                        console.error('Failed to get overall items from prices.tf', err);
                        console.log('Retrying in 10 minutes...');

                        setTimeout(() => {
                            retryGetOverall(pricer, pricecheck);
                        }, 10 * 60 * 1000);
                    });
            }
        });
    });
});

function retryGetOverall(pricer: Pricer, pricecheck: Pricecheck) {
    pricer
        .getOverall()
        .then(overall => {
            pricecheck.setSkusToCheck(overall);
            pricecheck.startPriceCheck();
        })
        .catch(err => {
            console.error('Failed to get overall items from prices.tf', err);
            console.log('Retrying in 10 minutes...');

            setTimeout(() => {
                retryGetOverall(pricer, pricecheck);
            }, 10 * 60 * 1000);
        });
}

import ON_DEATH from 'death';
import * as inspect from 'util';
import { Pricecheck } from './classes/Pricecheck';

ON_DEATH({ uncaughtException: true })((signalOrErr, origin) => {
    const crashed = signalOrErr !== 'SIGINT';

    if (crashed) {
        console.error(
            [
                'Price update bot' + ' crashed! Please create an issue with the following log:',
                `package.version: ${process.env.BOT_VERSION || undefined}; node: ${process.version} ${
                    process.platform
                } ${process.arch}}`,
                'Stack trace:',
                inspect.inspect(origin)
            ].join('\r\n')
        );
    } else {
        console.warn('Received kill signal `' + (signalOrErr as string) + '`');
    }

    socketManger.shutDown();
    process.exit(1);
});
