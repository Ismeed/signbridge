#!/usr/bin/env node
/**
 * Offline NSL Sequence Classifier Trainer
 *
 * Trains the on-device neural NSL model on any dataset JSON exported from
 * Settings -> NSL Training Dataset -> Export JSON.
 *
 * Usage:
 *   npm run train:nsl -- path/to/signbridge-nsl-dataset.json [output-model.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const requireFromRepo = createRequire(path.join(REPO_ROOT, 'package.json'));
const ts = requireFromRepo('typescript');

const moduleCache = new Map();

function resolveTsFile(specifier, parentFile) {
  let candidateBase;
  if (specifier.startsWith('@/')) {
    candidateBase = path.join(REPO_ROOT, 'src', specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    candidateBase = path.resolve(path.dirname(parentFile), specifier);
  } else {
    return null;
  }

  for (const full of [
    candidateBase,
    `${candidateBase}.ts`,
    `${candidateBase}.tsx`,
    path.join(candidateBase, 'index.ts'),
  ]) {
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return full;
    }
  }
  throw new Error(`Unable to resolve module "${specifier}" from ${parentFile}`);
}

function loadTsModule(filePath) {
  const normalized = path.resolve(filePath);
  if (moduleCache.has(normalized)) {
    return moduleCache.get(normalized).exports;
  }

  const source = fs.readFileSync(normalized, 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: normalized,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const mod = { exports: {} };
  moduleCache.set(normalized, mod);

  const localRequire = (spec) => {
    const resolved = resolveTsFile(spec, normalized);
    return resolved ? loadTsModule(resolved) : requireFromRepo(spec);
  };

  const fn = vm.runInThisContext(
    `(function(exports, require, module, __filename, __dirname) {\n${compiled}\n})`,
    { filename: normalized }
  );
  fn(mod.exports, localRequire, mod, normalized, path.dirname(normalized));
  return mod.exports;
}

function main() {
  const [, , inputArg, outputArg] = process.argv;
  if (!inputArg) {
    console.error(
      'Usage: node scripts/train-nsl-model.mjs <dataset.json> [public/models/nsl-model.json]'
    );
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  if (!fs.existsSync(inputPath)) {
    console.error(`Dataset file not found: ${inputPath}`);
    process.exit(1);
  }

  const outputPath = path.resolve(
    process.cwd(),
    outputArg || path.join(REPO_ROOT, 'public', 'models', 'nsl-model.json')
  );

  const { parseImportedDatasetJson, countSamplesByLabel } = loadTsModule(
    path.join(REPO_ROOT, 'src', 'lib', 'nslDataset.ts')
  );
  const { trainNslModel, serializeModelJson } = loadTsModule(
    path.join(REPO_ROOT, 'src', 'lib', 'nslModel.ts')
  );

  const rawJson = fs.readFileSync(inputPath, 'utf8');
  const parsed = parseImportedDatasetJson(rawJson);
  if (!parsed.ok) {
    console.error(`Invalid dataset: ${parsed.error}`);
    process.exit(1);
  }

  const { samples } = parsed.dataset;
  const counts = countSamplesByLabel(samples);
  console.log(`Loaded ${samples.length} sample(s) across ${Object.keys(counts).length} label(s):`);
  for (const [labelId, count] of Object.entries(counts)) {
    console.log(`  - ${labelId}: ${count} clip(s)`);
  }

  const startMs = Date.now();
  const trained = trainNslModel(samples);
  if (!trained.ok) {
    console.error(`Training failed: ${trained.error}`);
    process.exit(1);
  }

  const { model } = trained;
  const elapsedMs = Date.now() - startMs;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serializeModelJson(model), 'utf8');

  console.log(`\nTraining succeeded in ${elapsedMs}ms:`);
  console.log(`  Classes (${model.classes.length}): ${model.classes.map((c) => c.name).join(', ')}`);
  console.log(
    `  Split: ${model.metrics.trainCount} train / ${model.metrics.valCount} val (augmented 4x during training)`
  );
  console.log(
    `  Train Acc: ${(model.metrics.trainAccuracy * 100).toFixed(1)}% | Val Acc: ${(
      model.metrics.valAccuracy * 100
    ).toFixed(1)}% | Final Loss: ${model.metrics.finalLoss}`
  );
  console.log(`  Saved model weights -> ${outputPath}`);
}

main();
