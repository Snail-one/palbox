import { test } from 'node:test';
import { coreCases } from '../shared/core-cases.js';

for (const { name, run } of coreCases()) test(name, run);
