#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function fail(message) {
  console.error(`Context validation failed: ${message}`);
  process.exit(1);
}

function readJson(relPath) {
  const absPath = path.join(root, relPath);
  if (!fs.existsSync(absPath)) fail(`Missing file: ${relPath}`);
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (error) {
    fail(`Invalid JSON in ${relPath}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function validateDomainDoc(doc, relPath) {
  const required = ['id', 'version', 'title', 'status', 'owners', 'verified_from', 'content'];
  for (const key of required) {
    assert(Object.prototype.hasOwnProperty.call(doc, key), `${relPath} missing required key '${key}'`);
  }

  assert(typeof doc.id === 'string' && doc.id.length > 0, `${relPath} id must be non-empty string`);
  assert(Number.isInteger(doc.version) && doc.version >= 1, `${relPath} version must be integer >= 1`);
  assert(Array.isArray(doc.owners) && doc.owners.length > 0, `${relPath} owners must be non-empty array`);
  assert(Array.isArray(doc.verified_from) && doc.verified_from.length > 0, `${relPath} verified_from must be non-empty array`);

  for (const ref of doc.verified_from) {
    assert(typeof ref.path === 'string' && ref.path.length > 0, `${relPath} verified_from.path is required`);
    const sourcePath = path.join(root, ref.path);
    assert(fs.existsSync(sourcePath), `${relPath} verified_from path does not exist: ${ref.path}`);
  }
}

function main() {
  const contextManifest = readJson('context/manifest.json');
  assert(Array.isArray(contextManifest.artifacts), 'context/manifest.json artifacts must be an array');

  const domainDir = path.join(root, 'context/domains');
  assert(fs.existsSync(domainDir), 'context/domains directory is missing');

  const domainFiles = fs.readdirSync(domainDir).filter((f) => f.endsWith('.json'));
  assert(domainFiles.length > 0, 'context/domains must contain at least one domain document');

  for (const file of domainFiles) {
    const relPath = `context/domains/${file}`;
    const doc = readJson(relPath);
    validateDomainDoc(doc, relPath);
  }

  const generatedDir = path.join(root, 'context/generated');
  const generatedFiles = fs.readdirSync(generatedDir).filter((f) => f.endsWith('.json'));
  assert(generatedFiles.length >= 5, 'Expected at least 5 generated context files');

  for (const file of generatedFiles) {
    readJson(`context/generated/${file}`);
  }

  readJson('context/links/graph.json');

  console.log('Context validation passed.');
}

main();
