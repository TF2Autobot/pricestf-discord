const { version: BOT_VERSION } = require('../package.json');
process.env.BOT_VERSION = BOT_VERSION as string;

import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

import { Pricelist, PriceUpdateQueue } from './classes/Webhook';
import SchemaManager from '@tf2autobot/tf2-schema';
import PricesTfPricer from './lib/pricer/pricestf/prices-tf-pricer';
import PricesTfApi from './lib/pricer/pricestf/prices-tf-api';

const api = new PricesTfApi();

const schemaManager = new SchemaManager({ apiKey: process.env.STEAM_API_KEY });
const pricer = new PricesTfPricer(api);

const urls = JSON.parse(process.env.MAIN_WEBHOOK_URL) as string[];
PriceUpdateQueue.setURL(urls);

pricer.init().then(() => {
    schemaManager.init(err => {
        if (err) {
            console.warn('Fail to get schema');
            process.exit(1);
        }

        const pricelist = new Pricelist(schemaManager.schema, pricer);

        pricelist.init().then(() => {
            console.info('Connecting to socket server...');
            pricer.connect();
        });
    });
});

import ON_DEATH from 'death';
import * as inspect from 'util';

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

    pricer.shutdown();
    process.exit(1);
});
