#!/usr/bin/env node
/**
 * Offline NSL Sequence Classifier Trainer
 *
 * Trains the on-device neural NSL model from either:
 *   1. An exported JSON dataset from the /collect Data Studio
 *   2. Directly from the shared Supabase Postgres team dataset (--supabase)
 *
 * Usage:
 *   npm run train:nsl -- path/to/signbridge-nsl-dataset.json [output-model.json]
 *   npm run train:nsl -- --supabase [output-model.json]
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

function loadEnvFiles() {
  for (const filename of ['.env.local', '.env']) {
    const filePath = path.join(REPO_ROOT, filename);
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const useSupabase = args.includes('--supabase');
  const positional = args.filter((arg) => arg !== '--supabase');

  if (!useSupabase && positional.length === 0) {
    console.error(
      'Usage:\n  node scripts/train-nsl-model.mjs <dataset.json> [public/models/nsl-model.json]\n  node scripts/train-nsl-model.mjs --supabase [public/models/nsl-model.json]'
    );
    process.exit(1);
  }

  const outputArg = useSupabase ? positional[0] : positional[1];
  const outputPath = path.resolve(
    process.cwd(),
    outputArg || path.join(REPO_ROOT, 'public', 'models', 'nsl-model.json')
  );

  const { parseImportedDatasetJson, countSamplesByLabel, normalizeSignerTag } = loadTsModule(
    path.join(REPO_ROOT, 'src', 'lib', 'nslDataset.ts')
  );
  const { trainNslModel, serializeModelJson } = loadTsModule(
    path.join(REPO_ROOT, 'src', 'lib', 'nslModel.ts')
  );

  let samples;
  if (useSupabase) {
    loadEnvFiles();
    const { isCloudDatasetConfigured, fetchAllCloudNslSamples } = loadTsModule(
      path.join(REPO_ROOT, 'src', 'lib', 'supabaseNsl.ts')
    );
    if (!isCloudDatasetConfigured()) {
      console.error(
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in environment or .env.local).'
      );
      process.exit(1);
    }
    console.log('Fetching team NSL clips from Supabase...');
    const fetched = await fetchAllCloudNslSamples();
    samples = fetched.samples;
  } else {
    const inputPath = path.resolve(process.cwd(), positional[0]);
    if (!fs.existsSync(inputPath)) {
      console.error(`Dataset file not found: ${inputPath}`);
      process.exit(1);
    }
    const rawJson = fs.readFileSync(inputPath, 'utf8');
    const parsed = parseImportedDatasetJson(rawJson);
    if (!parsed.ok) {
      console.error(`Invalid dataset: ${parsed.error}`);
      process.exit(1);
    }
    samples = parsed.dataset.samples;
  }

  const counts = countSamplesByLabel(samples);
  const uniqueSigners = new Set(
    samples.map((sample) => normalizeSignerTag(sample.signerTag).toLowerCase())
  );
  console.log(
    `Loaded ${samples.length} sample(s) across ${Object.keys(counts).length} label(s) from ${uniqueSigners.size} signer(s):`
  );
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
    `  Split (${model.metrics.splitStrategy ?? 'stratified-clip'}): ${model.metrics.trainCount} train / ${model.metrics.valCount} val (augmented 4x during training)`
  );
  console.log(
    `  Train Acc: ${(model.metrics.trainAccuracy * 100).toFixed(1)}% | Val Acc: ${(
      model.metrics.valAccuracy * 100
    ).toFixed(1)}% | Final Loss: ${model.metrics.finalLoss}`
  );
  console.log(`  Saved model weights -> ${outputPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
