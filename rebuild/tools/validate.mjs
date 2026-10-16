// Publication and merge gate: validate the committed output without rebuilding it.
import {checkKit} from './check.mjs';
import {requireNode} from './integrity.mjs';
requireNode();
const result = await checkKit();
for (const message of result.errors) console.error('Error: ' + message);
for (const message of result.warnings) console.warn('Warning: ' + message);
if (result.errors.length || result.facts.out_of_date?.length) process.exitCode = 1;
else console.log('Committed view/ passes integrity and freshness checks.');
