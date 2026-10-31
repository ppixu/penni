#!/usr/bin/env node
import { suorita } from './suorita.js';

const koodi = await suorita(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
process.exitCode = koodi;
